import * as admin from 'firebase-admin';
import {
  BudgetCategory,
  buildInitialMonthlyBudgetRollover,
  encodeGeohash,
} from '@depense/shared';
import { generateMonthlyFinancialCoachInsights } from './index';

async function seedRemoteFirestore() {
  const projectId = process.env.GCLOUD_PROJECT || 'depense-reserve-ia';
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();
  const nowISO = '2026-11-01T08:00:00.000Z';

  const homeLat = 48.8566;
  const homeLng = 2.3522;
  const homeGeohash = encodeGeohash(homeLat, homeLng);

  // 1. Magasins locaux dans un rayon de 5 km (`stores/{storeId}`)
  const stores = [
    {
      id: 'store_leclerc_drive_2km',
      name: 'E.Leclerc Drive & Hypermarché',
      brand: 'LECLERC' as const,
      address: '14 Avenue de la République, 75011 Paris (2,1 km)',
      lat: 48.865,
      lng: 2.365,
      geohash: encodeGeohash(48.865, 2.365),
      updatedAt: nowISO,
    },
    {
      id: 'store_lidl_proximite_1km',
      name: 'Lidl Proximité',
      brand: 'LIDL' as const,
      address: '82 Rue de Rivoli, 75004 Paris (1,2 km)',
      lat: 48.859,
      lng: 2.358,
      geohash: encodeGeohash(48.859, 2.358),
      updatedAt: nowISO,
    },
    {
      id: 'store_carrefour_3km',
      name: 'Carrefour Market',
      brand: 'CARREFOUR' as const,
      address: '45 Boulevard Saint-Germain, 75005 Paris (2,8 km)',
      lat: 48.85,
      lng: 2.345,
      geohash: encodeGeohash(48.85, 2.345),
      updatedAt: nowISO,
    },
  ];

  const batch = db.batch();

  for (const s of stores) {
    batch.set(db.collection('stores').doc(s.id), s);
  }

  // 2. Relevés de prix géolocalisés (`storePrices/{priceId}`)
  const storePrices = [
    {
      id: 'price_leclerc_lait_1l',
      storeId: 'store_leclerc_drive_2km',
      storeName: 'E.Leclerc Drive & Hypermarché',
      geohash: stores[0].geohash,
      lat: stores[0].lat,
      lng: stores[0].lng,
      eanBarcode: '3560070123456',
      normalizedProductKey: 'lait_demi_ecreme_1l',
      rawProductLabel: 'Lait Demi-Écrémé 1L',
      unitPrice: 1.09,
      unit: 'L' as const,
      isStoreBrandAlternative: false,
      observedAt: nowISO,
      source: 'PDF_INVOICE' as const,
    },
    {
      id: 'price_leclerc_huile_1l',
      storeId: 'store_leclerc_drive_2km',
      storeName: 'E.Leclerc Drive & Hypermarché',
      geohash: stores[0].geohash,
      lat: stores[0].lat,
      lng: stores[0].lng,
      eanBarcode: '3250390987654',
      normalizedProductKey: 'huile_tournesol_1l',
      rawProductLabel: 'Huile de Tournesol 1L Marque Repère',
      unitPrice: 1.79,
      unit: 'L' as const,
      isStoreBrandAlternative: true,
      observedAt: nowISO,
      source: 'PDF_INVOICE' as const,
    },
    {
      id: 'price_carrefour_huile_1l',
      storeId: 'store_carrefour_3km',
      storeName: 'Carrefour Market',
      geohash: stores[2].geohash,
      lat: stores[2].lat,
      lng: stores[2].lng,
      eanBarcode: '3250390987654',
      normalizedProductKey: 'huile_tournesol_1l',
      rawProductLabel: 'Huile de Tournesol 1L',
      unitPrice: 2.35,
      unit: 'L' as const,
      isStoreBrandAlternative: false,
      observedAt: nowISO,
      source: 'PDF_INVOICE' as const,
    },
  ];

  for (const sp of storePrices) {
    batch.set(db.collection('storePrices').doc(sp.id), sp);
  }

  // 3. Profil Utilisateur de démonstration (`users/demo_foyer_2026`)
  const userId = 'demo_foyer_2026';
  const userRef = db.collection('users').doc(userId);
  batch.set(userRef, {
    uid: userId,
    email: 'florentbamis@gmail.com',
    displayName: 'Foyer EcoPanier',
    locale: 'fr',
    currency: 'EUR',
    defaultMonthlyIncome: 2500,
    dailyNotificationTime: '17:30',
    location: {
      lat: homeLat,
      lng: homeLng,
      geohash: homeGeohash,
      addressLabel: 'Domicile (Rayon 5,0 km)',
      searchRadiusKm: 5.0,
    },
    createdAt: nowISO,
    updatedAt: nowISO,
  });

  // 4. Modèles de postes récurrents "Zéro Ressaisie" (`categoryTemplates`)
  const templates = [
    {
      id: 'tpl_loyer',
      name: 'Loyer & Charges',
      icon: 'home',
      colorHex: '#0F766E',
      defaultLimit: 750,
      type: 'CHARGE_FIXE' as const,
      isRecurring: true,
      autoDebitOnFirstDay: true,
      createdAt: nowISO,
      updatedAt: nowISO,
    },
    {
      id: 'tpl_energie_fibre',
      name: 'Électricité & Fibre',
      icon: 'bolt',
      colorHex: '#0284C7',
      defaultLimit: 140,
      type: 'CHARGE_FIXE' as const,
      isRecurring: true,
      autoDebitOnFirstDay: true,
      createdAt: nowISO,
      updatedAt: nowISO,
    },
    {
      id: 'tpl_alimentation',
      name: 'Alimentation & Réserve',
      icon: 'shopping-cart',
      colorHex: '#10B981',
      defaultLimit: 450,
      type: 'VARIABLE' as const,
      isRecurring: true,
      autoDebitOnFirstDay: false,
      createdAt: nowISO,
      updatedAt: nowISO,
    },
    {
      id: 'tpl_loisirs',
      name: 'Loisirs & Sorties',
      icon: 'sparkles',
      colorHex: '#F59E0B',
      defaultLimit: 200,
      type: 'VARIABLE' as const,
      isRecurring: true,
      autoDebitOnFirstDay: false,
      createdAt: nowISO,
      updatedAt: nowISO,
    },
  ];

  for (const tpl of templates) {
    batch.set(userRef.collection('categoryTemplates').doc(tpl.id), tpl);
  }

  // 5. Génération de l'instance mensuelle `monthlyBudgets/2026-11` & historique `2026-10` (CLOSED)
  const octRollover = buildInitialMonthlyBudgetRollover({
    yearMonth: '2026-10',
    defaultMonthlyIncome: 2500,
    templates,
    nowISO: '2026-10-01T00:01:00.000Z',
  });
  batch.set(userRef.collection('monthlyBudgets').doc('2026-10'), {
    ...octRollover.monthlyBudget,
    status: 'CLOSED',
    totalVariableSpent: 610,
    totalSavedViaComparator: 38.5,
    realDisposableIncome: 2500 - 890 - 610,
    closedAt: '2026-11-01T00:01:00.000Z',
  });

  const novRollover = buildInitialMonthlyBudgetRollover({
    yearMonth: '2026-11',
    defaultMonthlyIncome: 2500,
    templates,
    nowISO,
  });
  const novRef = userRef.collection('monthlyBudgets').doc('2026-11');
  batch.set(novRef, novRollover.monthlyBudget);

  for (const cat of novRollover.categories) {
    batch.set(novRef.collection('categories').doc(cat.id), cat);
  }
  for (const tx of novRollover.autoTransactions) {
    batch.set(novRef.collection('transactions').doc(tx.id), tx);
  }

  // 6. Articles en réserve domestique (`pantryItems`) & Mouvements (`pantryMovements`)
  const pantryItems = [
    {
      id: 'pantry_lait_1l',
      name: 'Lait Demi-Écrémé 1L',
      normalizedProductKey: 'lait_demi_ecreme_1l',
      eanBarcode: '3560070123456',
      category: 'ALIMENTAIRE' as const,
      budgetCategoryId: 'tpl_alimentation',
      currentQuantity: 1,
      unit: 'L' as const,
      alertThreshold: 1,
      needsRestock: true,
      averageConsumptionDays: 4,
      predictedStockoutDate: '2026-11-05',
      lastPricePaid: 1.09,
      lastUpdatedAt: nowISO,
    },
    {
      id: 'pantry_huile_1l',
      name: 'Huile de Tournesol 1L',
      normalizedProductKey: 'huile_tournesol_1l',
      eanBarcode: '3250390987654',
      category: 'ALIMENTAIRE' as const,
      budgetCategoryId: 'tpl_alimentation',
      currentQuantity: 1,
      unit: 'L' as const,
      alertThreshold: 1,
      needsRestock: true,
      averageConsumptionDays: 14,
      predictedStockoutDate: '2026-11-15',
      lastPricePaid: 1.79,
      lastUpdatedAt: nowISO,
    },
    {
      id: 'pantry_pates_500g',
      name: 'Pâtes Penne Rigate 500g',
      normalizedProductKey: 'pates_penne_rigate_500g',
      category: 'ALIMENTAIRE' as const,
      budgetCategoryId: 'tpl_alimentation',
      currentQuantity: 3,
      unit: 'pack' as const,
      alertThreshold: 1,
      needsRestock: false,
      averageConsumptionDays: 5,
      predictedStockoutDate: '2026-11-16',
      lastPricePaid: 1.15,
      lastUpdatedAt: nowISO,
    },
  ];

  for (const item of pantryItems) {
    batch.set(userRef.collection('pantryItems').doc(item.id), item);
  }

  batch.set(userRef.collection('pantryMovements').doc('mov_2026_11_init_1'), {
    id: 'mov_2026_11_init_1',
    itemId: 'pantry_lait_1l',
    itemName: 'Lait Demi-Écrémé 1L',
    yearMonth: '2026-11',
    timestamp: nowISO,
    type: 'CONSUMPTION',
    source: 'MANUAL',
    quantityDelta: -1,
    quantityAfter: 1,
  });

  // 7. Insights du Coach Financier IA (`aiInsights`)
  const insights = generateMonthlyFinancialCoachInsights({
    yearMonth: '2026-11',
    currentDayOfMonth: 15,
    locale: 'fr',
    currency: 'EUR',
    monthlyBudget: novRollover.monthlyBudget,
    categories: novRollover.categories.map((c: BudgetCategory) =>
      c.id === 'tpl_alimentation' ? { ...c, spentAmount: 310, consumptionPercentage: 68.89 } : c
    ),
    historicalCategorySpends: {
      tpl_alimentation: [240, 250, 245],
    },
    pantryItems,
    pantryConsumptionHistory: {
      pantry_lait_1l: ['2026-10-24T08:00:00Z', '2026-10-28T08:00:00Z', '2026-11-01T08:00:00Z'],
    },
    nowISO,
  });

  for (const insight of insights) {
    batch.set(novRef.collection('aiInsights').doc(insight.id), insight);
  }

  await batch.commit();
  console.log(
    `✅ Firestore initialisé avec succès sur le projet "${projectId}" (stores, storePrices, users/${userId}, categoryTemplates, monthlyBudgets/2026-10 & 2026-11, pantryItems, pantryMovements, aiInsights).`
  );
}

seedRemoteFirestore().catch((err) => {
  console.error('Erreur lors du seed Firestore :', err);
  process.exit(1);
});
