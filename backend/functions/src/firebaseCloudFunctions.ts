import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  BudgetCategory,
  BudgetTransaction,
  CategoryTemplate,
  DailyBasketComparisonResult,
  LocalStore,
  MonthlyBudget,
  PantryItem,
  StorePriceRecord,
  UserProfile,
  YearMonth,
  getCurrentYearMonth,
} from '@depense/shared';
import {
  MonthlyRolloverPersistencePort,
  ensureUserMonthlyBudgetRollover,
  runMonthlyCronForAllUsers,
} from './cron/monthlyBudgetRollover';
import {
  DailyComparatorPort,
  runDaily1730ComparatorBatch,
  runUserDaily5kmPriceComparison,
} from './cron/dailyPriceComparator';
import { generateMonthlyFinancialCoachInsights } from './ai/financialCoachEngine';
import { GEMINI_INVOICE_PARSER_SYSTEM_PROMPT } from './ai/invoiceMultimodalParser';
import { PushNotificationPayload } from './services/notificationService';

function getDb(): admin.firestore.Firestore {
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
  return admin.firestore();
}

/**
 * Adaptateur Firestore de production pour le Cron Mensuel & Lazy Init (US 1.3)
 */
function createFirestoreRolloverPort(): MonthlyRolloverPersistencePort {
  const db = getDb();
  return {
    async getUserProfile(userId: string): Promise<UserProfile | null> {
      const snap = await db.collection('users').doc(userId).get();
      return snap.exists ? (snap.data() as UserProfile) : null;
    },
    async listActiveUsers(): Promise<UserProfile[]> {
      const users: UserProfile[] = [];
      const pageSize = 250;
      let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
      while (true) {
        let query = db
          .collection('users')
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty) break;
        for (const docSnap of snap.docs) {
          users.push(docSnap.data() as UserProfile);
        }
        if (snap.docs.length < pageSize) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }
      return users;
    },
    async getMonthlyBudget(
      userId: string,
      yearMonth: YearMonth
    ): Promise<MonthlyBudget | null> {
      const snap = await db
        .collection('users')
        .doc(userId)
        .collection('monthlyBudgets')
        .doc(yearMonth)
        .get();
      return snap.exists ? (snap.data() as MonthlyBudget) : null;
    },
    async listCategoryTemplates(userId: string): Promise<CategoryTemplate[]> {
      const snap = await db
        .collection('users')
        .doc(userId)
        .collection('categoryTemplates')
        .get();
      return snap.docs.map((d) => d.data() as CategoryTemplate);
    },
    async executeRolloverBatch(params: {
      userId: string;
      previousMonthToClose?: YearMonth;
      newMonthlyBudget: MonthlyBudget;
      categories: BudgetCategory[];
      autoTransactions: BudgetTransaction[];
    }): Promise<void> {
      const batch = db.batch();
      const userRef = db.collection('users').doc(params.userId);

      if (params.previousMonthToClose) {
        const prevRef = userRef
          .collection('monthlyBudgets')
          .doc(params.previousMonthToClose);
        batch.update(prevRef, {
          status: 'CLOSED',
          closedAt: new Date().toISOString(),
        });
      }

      const monthRef = userRef
        .collection('monthlyBudgets')
        .doc(params.newMonthlyBudget.yearMonth);
      batch.set(monthRef, params.newMonthlyBudget);

      for (const cat of params.categories) {
        batch.set(monthRef.collection('categories').doc(cat.id), cat);
      }

      for (const tx of params.autoTransactions) {
        batch.set(monthRef.collection('transactions').doc(tx.id), tx);
      }

      await batch.commit();
    },
  };
}

/**
 * Adaptateur Firestore + FCM de production pour le Comparateur Quotidien 5 km (US 3.2, US 3.3)
 */
function createFirestoreComparatorPort(): DailyComparatorPort {
  const db = getDb();
  return {
    async listUsersWithLocation(): Promise<UserProfile[]> {
      const users: UserProfile[] = [];
      const pageSize = 250;
      let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
      while (true) {
        let query = db
          .collection('users')
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);
        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty) break;
        for (const docSnap of snap.docs) {
          const u = docSnap.data() as UserProfile;
          if (u.location) {
            users.push(u);
          }
        }
        if (snap.docs.length < pageSize) break;
        lastDoc = snap.docs[snap.docs.length - 1];
      }
      return users;
    },
    async getLowStockPantryItems(userId: string): Promise<PantryItem[]> {
      const snap = await db
        .collection('users')
        .doc(userId)
        .collection('pantryItems')
        .where('needsRestock', '==', true)
        .get();
      return snap.docs.map((d) => d.data() as PantryItem);
    },
    async getActiveMonthCategories(
      userId: string,
      yearMonth: YearMonth
    ): Promise<BudgetCategory[]> {
      const snap = await db
        .collection('users')
        .doc(userId)
        .collection('monthlyBudgets')
        .doc(yearMonth)
        .collection('categories')
        .get();
      return snap.docs.map((d) => d.data() as BudgetCategory);
    },
    async getStoresNearGeohash(): Promise<LocalStore[]> {
      const snap = await db.collection('stores').get();
      return snap.docs.map((d) => d.data() as LocalStore);
    },
    async getStorePricesForStores(storeIds: string[]): Promise<StorePriceRecord[]> {
      if (storeIds.length === 0) return [];
      const chunkSize = 30;
      const chunks: string[][] = [];
      for (let i = 0; i < storeIds.length; i += chunkSize) {
        chunks.push(storeIds.slice(i, i + chunkSize));
      }
      const snaps = await Promise.all(
        chunks.map((chunk) =>
          db.collection('storePrices').where('storeId', 'in', chunk).get()
        )
      );
      const records: StorePriceRecord[] = [];
      for (const snap of snaps) {
        for (const d of snap.docs) {
          records.push(d.data() as StorePriceRecord);
        }
      }
      return records;
    },
    async saveDailyComparisonResult(
      userId: string,
      result: DailyBasketComparisonResult
    ): Promise<void> {
      await db
        .collection('users')
        .doc(userId)
        .collection('monthlyBudgets')
        .doc(result.yearMonth)
        .set({ latestDailyComparison5km: result }, { merge: true });
    },
    async sendPushNotification(payload: PushNotificationPayload): Promise<void> {
      if (payload.fcmTokens.length === 0) return;
      await admin.messaging().sendEachForMulticast({
        tokens: payload.fcmTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      });
    },
  };
}

/**
 * 1. Cron Mensuel (1er de chaque mois à 00h01 — US 1.3)
 */
export const cronMonthlyBudgetRollover = onSchedule(
  {
    schedule: '1 0 1 * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
  },
  async () => {
    const port = createFirestoreRolloverPort();
    await runMonthlyCronForAllUsers(port, getCurrentYearMonth());
  }
);

/**
 * 2. Callable Lazy Init du Budget Mensuel à l'ouverture de l'app (US 1.3)
 */
export const ensureMonthlyBudgetInitialized = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    }
    const yearMonth =
      (request.data?.yearMonth as YearMonth | undefined) ?? getCurrentYearMonth();
    const port = createFirestoreRolloverPort();
    return ensureUserMonthlyBudgetRollover(port, userId, yearMonth);
  }
);

/**
 * 3. Cron Quotidien à 17h30 — Comparateur de prix 5 km sur les articles à Quantité <= 1 (US 3.2, US 3.3)
 */
export const cronDaily1730PriceComparator = onSchedule(
  {
    schedule: '30 17 * * *',
    timeZone: 'Europe/Paris',
    region: 'europe-west1',
  },
  async () => {
    const port = createFirestoreComparatorPort();
    await runDaily1730ComparatorBatch(port, getCurrentYearMonth());
  }
);

/**
 * 4. Callable Comparateur 5 km à la demande (US 3.3)
 */
export const comparePantryBasket5km = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    }
    const db = getDb();
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'Profil utilisateur introuvable.');
    }
    const port = createFirestoreComparatorPort();
    return runUserDaily5kmPriceComparison(
      port,
      userSnap.data() as UserProfile,
      getCurrentYearMonth()
    );
  }
);

/**
 * 5. Callable Coach Financier IA (Génération des insights IA-01 à IA-05 pour un mois donné — Epic 6)
 */
export const generateMonthlyCoachAiInsights = onCall(
  { region: 'europe-west1' },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    }
    const yearMonth =
      (request.data?.yearMonth as YearMonth | undefined) ?? getCurrentYearMonth();
    const db = getDb();

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'Profil utilisateur introuvable.');
    }
    const user = userSnap.data() as UserProfile;

    const monthRef = db
      .collection('users')
      .doc(userId)
      .collection('monthlyBudgets')
      .doc(yearMonth);
    const monthSnap = await monthRef.get();
    if (!monthSnap.exists) {
      throw new HttpsError('not-found', `Page budget ${yearMonth} introuvable.`);
    }

    const categoriesSnap = await monthRef.collection('categories').get();
    const pantrySnap = await db
      .collection('users')
      .doc(userId)
      .collection('pantryItems')
      .get();

    // Construction de l'historique réel des dépenses par catégorie sur les mois précédents (IA-02)
    const historicalCategorySpends: Record<string, number[]> = {};
    const allBudgetsSnap = await db
      .collection('users')
      .doc(userId)
      .collection('monthlyBudgets')
      .get();
    const pastMonths = allBudgetsSnap.docs
      .map((d) => d.id)
      .filter((ym) => ym < yearMonth)
      .sort()
      .slice(-3);

    for (const pastYm of pastMonths) {
      const pastCatsSnap = await db
        .collection('users')
        .doc(userId)
        .collection('monthlyBudgets')
        .doc(pastYm)
        .collection('categories')
        .get();
      for (const cDoc of pastCatsSnap.docs) {
        const cData = cDoc.data() as BudgetCategory;
        if (!historicalCategorySpends[cData.id]) {
          historicalCategorySpends[cData.id] = [];
        }
        historicalCategorySpends[cData.id].push(Number(cData.spentAmount) || 0);
      }
    }

    // Construction de l'historique réel de consommation de la réserve (IA-05)
    const pantryConsumptionHistory: Record<string, string[]> = {};
    const movementsSnap = await db
      .collection('users')
      .doc(userId)
      .collection('pantryMovements')
      .where('type', '==', 'CONSUMPTION')
      .get();
    for (const mDoc of movementsSnap.docs) {
      const mData = mDoc.data() as { itemId?: string; timestamp?: string };
      if (mData.itemId && mData.timestamp) {
        if (!pantryConsumptionHistory[mData.itemId]) {
          pantryConsumptionHistory[mData.itemId] = [];
        }
        pantryConsumptionHistory[mData.itemId].push(mData.timestamp);
      }
    }

    const insights = generateMonthlyFinancialCoachInsights({
      yearMonth,
      currentDayOfMonth: new Date().getDate(),
      locale: user.locale,
      currency: user.currency,
      monthlyBudget: monthSnap.data() as MonthlyBudget,
      categories: categoriesSnap.docs.map((d) => d.data() as BudgetCategory),
      historicalCategorySpends,
      pantryItems: pantrySnap.docs.map((d) => d.data() as PantryItem),
      pantryConsumptionHistory,
    });

    const batch = db.batch();
    for (const insight of insights) {
      batch.set(monthRef.collection('aiInsights').doc(insight.id), insight);
    }
    await batch.commit();

    return { yearMonth, insightsCount: insights.length, insights };
  }
);

/**
 * 6. Callable Extraction Multimodale de Factures PDF & Photos de Tickets via Clé API Gemini (US 4.2, US 4.3, IA-06)
 * Utilise la clé `GEMINI_API_KEY` avec chaîne de repli automatique sur les modèles Gemini 2.0 / 1.5 Flash
 * (`gemini-2.0-flash` -> `gemini-2.0-flash-lite` -> `gemini-1.5-flash`).
 */
export const parseInvoicePdfOrImage = onCall(
  {
    region: 'europe-west1',
    cors: true,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    }

    const base64Data = request.data?.base64Data as string | undefined;
    const mimeType =
      (request.data?.mimeType as string | undefined) ?? 'application/pdf';
    if (!base64Data) {
      throw new HttpsError(
        'invalid-argument',
        'Le champ base64Data (PDF ou image de ticket) est requis.'
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'La clé GEMINI_API_KEY n’est pas configurée.'
      );
    }

    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const candidateModels = Array.from(
      new Set([
        preferredModel,
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
      ])
    );

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{ text: GEMINI_INVOICE_PARSER_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `Extrais toutes les informations comptables et les lignes d'articles de cette facture ou ticket en JSON strict avec les clés exactes :
{
  "storeName": "Nom de l'enseigne ou émetteur",
  "purchaseDateISO": "YYYY-MM-DD",
  "totalAmountTTC": 0.00,
  "currency": "EUR",
  "rawItems": [
    {
      "rawLabel": "Libellé brut",
      "normalizedLabel": "Libellé propre",
      "quantity": 1,
      "unit": "unit",
      "unitPrice": 0.00,
      "lineTotalTTC": 0.00,
      "categoryType": "ALIMENTAIRE"
    }
  ]
}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            storeName: { type: 'STRING' },
            purchaseDateISO: { type: 'STRING' },
            totalAmountTTC: { type: 'NUMBER' },
            currency: { type: 'STRING' },
            rawItems: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  rawLabel: { type: 'STRING' },
                  normalizedLabel: { type: 'STRING' },
                  quantity: { type: 'NUMBER' },
                  unit: { type: 'STRING' },
                  unitPrice: { type: 'NUMBER' },
                  lineTotalTTC: { type: 'NUMBER' },
                  categoryType: { type: 'STRING' },
                },
                required: ['normalizedLabel', 'quantity', 'unitPrice', 'lineTotalTTC'],
              },
            },
          },
          required: ['storeName', 'purchaseDateISO', 'totalAmountTTC', 'rawItems'],
        },
      },
    });

    let lastStatus = 500;
    let lastErrorText = '';

    for (const model of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.ok) {
        const json = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string; thought?: boolean }>;
            };
          }>;
        };
        const parts = json.candidates?.[0]?.content?.parts ?? [];
        const textPart =
          parts.find((p) => !p.thought && typeof p.text === 'string') ??
          parts.find((p) => typeof p.text === 'string');
        const rawText = (textPart?.text ?? '{}')
          .replace(/^```json\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        return JSON.parse(rawText);
      }

      lastStatus = response.status;
      lastErrorText = await response.text();
      // Si 404 (modèle déprécié) ou 503/429 (surcharge temporaire), on tente immédiatement le modèle Flash suivant
      if (lastStatus !== 404 && lastStatus !== 503 && lastStatus !== 429) {
        break;
      }
    }

    throw new HttpsError(
      'internal',
      `Erreur API Gemini (${lastStatus}): ${lastErrorText}`
    );
  }
);

/**
 * 7. Callable Chef Réserve IA Générative (ACT-20)
 * Génère des recettes 0 € personnalisées à partir du stock réel, des DLC proches et du prompt libre utilisateur.
 */
export const generateCustomChefRecipes = onCall(
  {
    region: 'europe-west1',
    cors: true,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError('unauthenticated', 'Authentification requise.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'La clé GEMINI_API_KEY n’est pas configurée.'
      );
    }

    const rawItems = Array.isArray(request.data?.pantryItems)
      ? (request.data.pantryItems as Array<{
          id?: string;
          name?: string;
          currentQuantity?: number;
          unit?: string;
          expirationDate?: string | null;
        }>)
      : [];
    const cuisineFilter = String(request.data?.cuisineFilter || 'ALL');
    const customPrompt = String(request.data?.customPrompt || '').trim();

    const stockDescription = rawItems
      .filter((i) => (Number(i.currentQuantity) || 0) > 0)
      .slice(0, 50)
      .map(
        (i) =>
          `- [ID:${i.id}] ${i.name} (Qté: ${i.currentQuantity} ${i.unit || 'u'}${
            i.expirationDate ? `, DLC: ${i.expirationDate}` : ''
          })`
      )
      .join('\n');

    const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const candidateModels = Array.from(
      new Set([
        preferredModel,
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
      ])
    );

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `Tu es le Chef Réserve IA anti-gaspillage d'EcoPanier.
Tu crées des recettes savoureuses à 0 € en utilisant PRIORITAIREMENT les produits réellement présents dans la réserve de l'utilisateur et surtout ceux dont la DLC est proche.
Respecte scrupuleusement la consigne libre de l'utilisateur (régime, temps, matériel, enfants, etc.) et la cuisine demandée (FRANCAISE, CAMEROUNAISE, MAGHREBINE, ASIATIQUE, ou variées si ALL).`,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Voici les produits actuellement en stock dans la réserve :
${stockDescription || 'Stock standard de base'}

Filtre cuisine : ${cuisineFilter}
Consigne / Prompt utilisateur : "${customPrompt || 'Recettes rapides, gourmandes et anti-gaspillage'}"

Génère 4 recettes réalistes et détaillées au format JSON strict.`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            recipes: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  id: { type: 'STRING' },
                  cuisine: { type: 'STRING' },
                  title: { type: 'STRING' },
                  icon: { type: 'STRING' },
                  servings: { type: 'STRING' },
                  prepTime: { type: 'STRING' },
                  cookTime: { type: 'STRING' },
                  savedEuros: { type: 'NUMBER' },
                  calories: { type: 'STRING' },
                  usedItemIds: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  missingLabels: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  pantryStaples: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  steps: { type: 'STRING' },
                  fullSteps: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  chefTips: { type: 'STRING' },
                },
                required: [
                  'id',
                  'cuisine',
                  'title',
                  'icon',
                  'servings',
                  'prepTime',
                  'cookTime',
                  'savedEuros',
                  'calories',
                  'usedItemIds',
                  'steps',
                  'fullSteps',
                ],
              },
            },
          },
          required: ['recipes'],
        },
      },
    });

    let lastStatus = 500;
    let lastErrorText = '';

    for (const model of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      });

      if (response.ok) {
        const json = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string; thought?: boolean }>;
            };
          }>;
        };
        const parts = json.candidates?.[0]?.content?.parts ?? [];
        const textPart =
          parts.find((p) => !p.thought && typeof p.text === 'string') ??
          parts.find((p) => typeof p.text === 'string');
        const rawText = (textPart?.text ?? '{"recipes":[]}')
          .replace(/^```json\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        return JSON.parse(rawText);
      }

      lastStatus = response.status;
      lastErrorText = await response.text();
      if (lastStatus !== 404 && lastStatus !== 503 && lastStatus !== 429) {
        break;
      }
    }

    throw new HttpsError(
      'internal',
      `Erreur API Gemini Chef IA (${lastStatus}): ${lastErrorText}`
    );
  }
);

