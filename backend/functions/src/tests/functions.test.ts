import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  commitPrevalidatedInvoice,
  ensureUserMonthlyBudgetRollover,
  generateMonthlyFinancialCoachInsights,
  parseAndPrepareInvoiceForValidation,
  runUserDaily5kmPriceComparison,
} from '../index';
import {
  BudgetCategory,
  BudgetTransaction,
  CategoryTemplate,
  MonthlyBudget,
  PantryItem,
  UserProfile,
  YearMonth,
} from '@depense/shared';

describe('Cloud Functions Backend — Cron Mensuel, Comparateur 5 km, Parser PDF Gemini & Coach IA', () => {
  it('Cron Mensuel & Lazy Init (US 1.3) : clôture M-1 et instancie YYYY-MM avec charges fixes débitées', async () => {
    const budgets = new Map<YearMonth, MonthlyBudget>([
      [
        '2026-10',
        {
          yearMonth: '2026-10',
          status: 'OPEN',
          globalAllocated: 2500,
          totalFixedCharges: 900,
          totalVariableSpent: 1200,
          totalSavedViaComparator: 45,
          realDisposableIncome: 400,
          createdAt: '2026-10-01',
          updatedAt: '2026-10-31',
        },
      ],
    ]);

    let closedPrevMonth: YearMonth | undefined;
    let savedCategories: BudgetCategory[] = [];
    let savedAutoTx: BudgetTransaction[] = [];

    const result = await ensureUserMonthlyBudgetRollover(
      {
        async getUserProfile(uid) {
          return {
            uid,
            email: 'user@ecopanier.fr',
            displayName: 'Alex',
            locale: 'fr',
            currency: 'EUR',
            defaultMonthlyIncome: 2500,
            dailyNotificationTime: '17:30',
            createdAt: '2026-01-01',
            updatedAt: '2026-10-01',
          };
        },
        async listActiveUsers() {
          return [];
        },
        async getMonthlyBudget(_uid, ym) {
          return budgets.get(ym) ?? null;
        },
        async listCategoryTemplates(): Promise<CategoryTemplate[]> {
          return [
            {
              id: 'cat_loyer',
              name: 'Loyer & Charges',
              icon: 'home',
              colorHex: '#0F766E',
              defaultLimit: 900,
              type: 'CHARGE_FIXE',
              isRecurring: true,
              autoDebitOnFirstDay: true,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
            {
              id: 'cat_courses',
              name: 'Alimentation & Réserve',
              icon: 'cart',
              colorHex: '#10B981',
              defaultLimit: 450,
              type: 'VARIABLE',
              isRecurring: true,
              autoDebitOnFirstDay: false,
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ];
        },
        async executeRolloverBatch(batch) {
          closedPrevMonth = batch.previousMonthToClose;
          budgets.set(batch.newMonthlyBudget.yearMonth, batch.newMonthlyBudget);
          savedCategories = batch.categories;
          savedAutoTx = batch.autoTransactions;
        },
      },
      'user_123',
      '2026-11'
    );

    assert.equal(result.created, true);
    assert.equal(closedPrevMonth, '2026-10');
    assert.equal(result.monthlyBudget.realDisposableIncome, 1600);
    assert.equal(savedCategories.length, 2);
    assert.equal(savedAutoTx.length, 1);
    assert.equal(savedAutoTx[0].amount, 900);
  });

  it('Parser Multimodal PDF Gemini (US 4.3, IA-06) : extrait, détecte les doublons et valide par WriteBatch', async () => {
    const pantry: PantryItem[] = [
      {
        id: 'p_lait',
        name: 'Lait Demi-Écrémé 1L',
        normalizedProductKey: 'lait_demi_ecreme_1l',
        eanBarcode: '3560070123456',
        category: 'ALIMENTAIRE',
        currentQuantity: 1,
        unit: 'L',
        alertThreshold: 1,
        needsRestock: true,
        lastUpdatedAt: '2026-11-01',
      },
    ];

    let committedPantry: PantryItem[] = [];
    let committedTx: BudgetTransaction[] = [];

    const persistencePort = {
      async hasExistingInvoiceFingerprint() {
        return false;
      },
      async listUserPantryItems() {
        return pantry;
      },
      async commitValidatedInvoiceAtomicBatch(batch: {
        transactions: BudgetTransaction[];
        updatedPantryItems: PantryItem[];
      }) {
        committedTx = batch.transactions;
        committedPantry = batch.updatedPantryItems;
      },
    };

    const preview = await parseAndPrepareInvoiceForValidation({
      userId: 'user_123',
      fileStorageUri: 'gs://bucket/users/user_123/invoices/2026-11/leclerc.pdf',
      mimeType: 'application/pdf',
      locale: 'fr',
      defaultCurrency: 'EUR',
      persistencePort,
      geminiPort: {
        async extractInvoiceFromDocument() {
          return {
            storeName: 'E.Leclerc Drive',
            purchaseDateISO: '2026-11-15',
            invoiceNumber: 'DRV-2026-1115',
            totalAmountTTC: 15.4,
            totalLoyaltyDiscounts: 1.2,
            currency: 'EUR',
            rawItems: [
              {
                rawLabel: 'LAIT 1/2 ECREME 6X1L',
                normalizedLabel: 'Lait Demi-Écrémé 1L',
                eanBarcode: '3560070123456',
                quantity: 6,
                unit: 'L',
                unitPrice: 1.15,
                lineTotalTTC: 6.9,
                categoryType: 'ALIMENTAIRE',
              },
              {
                rawLabel: 'LESSIVE LIQUIDE 2L',
                normalizedLabel: 'Lessive Liquide 2L',
                quantity: 1,
                unit: 'L',
                unitPrice: 8.5,
                lineTotalTTC: 8.5,
                categoryType: 'ENTRETIEN_HYGIENE',
              },
            ],
          };
        },
      },
    });

    assert.equal(preview.targetYearMonth, '2026-11');
    assert.equal(preview.isDuplicate, false);
    assert.equal(preview.lineItems.length, 2);
    assert.equal(preview.suggestedBudgetSplits.length, 2);

    const committed = await commitPrevalidatedInvoice({
      persistencePort,
      userId: 'user_123',
      invoiceFileUrl: 'https://storage.googleapis.com/bucket/leclerc.pdf',
      source: 'PDF_INVOICE',
      payload: preview,
      validatedBudgetSplits: [
        { categoryId: 'cat_alim', categoryName: 'Alimentation', amount: 6.9 },
        { categoryId: 'cat_hygiene', categoryName: 'Entretien & Hygiène', amount: 8.5 },
      ],
      storeLocation: {
        storeId: 'store_leclerc',
        geohash: 'u09tvw0',
        lat: 48.86,
        lng: 2.35,
      },
    });

    assert.equal(committed.yearMonth, '2026-11');
    assert.equal(committedTx.length, 2);
    assert.equal(committedPantry.length, 2);
    assert.equal(committedPantry[0].currentQuantity, 7); // 1 en stock + 6 achetés
    assert.equal(committedPantry[0].needsRestock, false);
  });

  it('Cron Quotidien 17h30 (US 3.2, US 3.3) & Coach IA (Epic 6) : notifie le panier 5 km et génère les insights IA-01..05', async () => {
    let sentPushTitle = '';
    const user: UserProfile = {
      uid: 'user_123',
      email: 'alex@ecopanier.fr',
      displayName: 'Alex',
      locale: 'fr',
      currency: 'EUR',
      defaultMonthlyIncome: 2500,
      dailyNotificationTime: '17:30',
      fcmTokens: ['token_abc'],
      location: {
        lat: 48.8566,
        lng: 2.3522,
        geohash: 'u09tunq',
        searchRadiusKm: 5.0,
      },
      createdAt: '2026-01-01',
      updatedAt: '2026-11-01',
    };

    const comp = await runUserDaily5kmPriceComparison(
      {
        async listUsersWithLocation() {
          return [user];
        },
        async getLowStockPantryItems() {
          return [
            {
              id: 'p_huile',
              name: 'Huile Tournesol 1L',
              normalizedProductKey: 'huile_tournesol_1l',
              category: 'ALIMENTAIRE',
              currentQuantity: 1,
              unit: 'L',
              alertThreshold: 1,
              needsRestock: true,
              lastUpdatedAt: '2026-11-10',
            },
          ];
        },
        async getActiveMonthCategories() {
          return [];
        },
        async getStoresNearGeohash() {
          return [
            {
              id: 's_lidl',
              name: 'Lidl Proximité',
              brand: 'LIDL',
              address: 'Paris',
              lat: 48.86,
              lng: 2.355,
              geohash: 'u09tunr',
              updatedAt: '2026-11-01',
            },
          ];
        },
        async getStorePricesForStores() {
          return [
            {
              id: 'sp_1',
              storeId: 's_lidl',
              storeName: 'Lidl Proximité',
              geohash: 'u09tunr',
              lat: 48.86,
              lng: 2.355,
              normalizedProductKey: 'huile_tournesol_1l',
              rawProductLabel: 'Huile 1L',
              unitPrice: 1.89,
              unit: 'L',
              observedAt: '2026-11-10',
              source: 'PDF_INVOICE',
            },
          ];
        },
        async saveDailyComparisonResult() {},
        async sendPushNotification(payload) {
          sentPushTitle = payload.title;
        },
      },
      user,
      '2026-11'
    );

    assert.ok(comp);
    assert.ok(sentPushTitle.includes('Lidl Proximité'));

    const insights = generateMonthlyFinancialCoachInsights({
      yearMonth: '2026-11',
      currentDayOfMonth: 15,
      locale: 'fr',
      currency: 'EUR',
      monthlyBudget: {
        yearMonth: '2026-11',
        status: 'OPEN',
        globalAllocated: 2000,
        totalFixedCharges: 1150, // 57.5% -> TIGHT
        totalVariableSpent: 400,
        totalSavedViaComparator: 25,
        realDisposableIncome: 450,
        createdAt: '2026-11-01',
        updatedAt: '2026-11-15',
      },
      categories: [
        {
          id: 'c_loisirs',
          yearMonth: '2026-11',
          name: 'Loisirs',
          icon: 'game',
          colorHex: '#F59E0B',
          type: 'VARIABLE',
          allocatedLimit: 200,
          spentAmount: 150,
          consumptionPercentage: 75,
          gaugeState: 'WARNING',
        },
      ],
      historicalCategorySpends: {
        c_loisirs: [100, 110, 105],
      },
      pantryItems: [],
      pantryConsumptionHistory: {},
    });

    assert.ok(insights.some((i) => i.code === 'IA-01_FORECAST'));
    assert.ok(insights.some((i) => i.code === 'IA-02_ANOMALY'));
    assert.ok(insights.some((i) => i.code === 'IA-03_FIXED_CHARGES'));
  });
});
