import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  applyPantryQuantityDelta,
  auditFixedChargesRatio,
  buildInitialMonthlyBudgetRollover,
  calculateHaversineDistanceKm,
  computeBudgetGaugeState,
  computeDaily5kmBasketComparison,
  computeInvoiceFingerprint,
  computeRealDisposableIncome,
  computeSmartDepletionPrediction,
  computeSuggestedBudgetSplits,
  detectCategorySpendingDrift,
  encodeGeohash,
  extractYearMonthFromDate,
  formatCurrencyAmount,
  getHistoricalYearMonthsRange,
  normalizeSemanticProductKey,
  predictEndOfMonthLanding,
  shiftYearMonth,
} from '../index';

describe('Epic 1 — Cycle Mensuel Automatisé, Navigation Inter-Mois & Jauges Budget', () => {
  it('US 1.5 : calcule les jauges Vert (<75%), Orange (75-99%) et Rouge (>=100%)', () => {
    assert.deepEqual(computeBudgetGaugeState(200, 400), {
      percentage: 50,
      gaugeState: 'HEALTHY',
    });
    assert.deepEqual(computeBudgetGaugeState(320, 400), {
      percentage: 80,
      gaugeState: 'WARNING',
    });
    assert.deepEqual(computeBudgetGaugeState(410, 400), {
      percentage: 102.5,
      gaugeState: 'CRITICAL',
    });
  });

  it('US 1.3 : génère automatiquement le budget du 1er du mois ("Zéro Ressaisie") et débite les charges fixes', () => {
    const rollover = buildInitialMonthlyBudgetRollover({
      yearMonth: '2026-11',
      defaultMonthlyIncome: 2500,
      nowISO: '2026-11-01T00:01:00.000Z',
      templates: [
        {
          id: 'tpl_loyer',
          name: 'Loyer',
          icon: 'home',
          colorHex: '#0F766E',
          defaultLimit: 800,
          type: 'CHARGE_FIXE',
          isRecurring: true,
          autoDebitOnFirstDay: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
        {
          id: 'tpl_alim',
          name: 'Alimentation',
          icon: 'cart',
          colorHex: '#10B981',
          defaultLimit: 450,
          type: 'VARIABLE',
          isRecurring: true,
          autoDebitOnFirstDay: false,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });

    assert.equal(rollover.monthlyBudget.yearMonth, '2026-11');
    assert.equal(rollover.monthlyBudget.status, 'OPEN');
    assert.equal(rollover.monthlyBudget.totalFixedCharges, 800);
    assert.equal(rollover.monthlyBudget.totalVariableSpent, 0);
    assert.equal(rollover.monthlyBudget.realDisposableIncome, 1700);
    assert.equal(rollover.autoTransactions.length, 1);
    assert.equal(rollover.autoTransactions[0].amount, 800);
    assert.equal(
      computeRealDisposableIncome(2500, 800, 200),
      1500
    );
  });

  it('US 1.4 & US 5.1 : navigue entre les mois (< M-1 | M | M+1 >) et génère les plages 3M/6M/12M', () => {
    assert.equal(shiftYearMonth('2026-11', -1), '2026-10');
    assert.equal(shiftYearMonth('2026-11', 2), '2027-01');
    assert.deepEqual(getHistoricalYearMonthsRange('2026-11', 3), [
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
  });
});

describe('Epic 2 — Gestion de la Réserve Domestique ("1-Tap Use") & Smart Depletion', () => {
  it('US 2.2 & US 2.3 : décrémente en 1 clic (-1), bloque à 0 et déclenche l’alerte à Quantité = 1', () => {
    const initialItem = {
      id: 'item_lait',
      name: 'Lait Demi-Écrémé 1L',
      normalizedProductKey: 'lait_demi_ecreme_1l',
      eanBarcode: '3560070123456',
      category: 'ALIMENTAIRE' as const,
      currentQuantity: 2,
      unit: 'L' as const,
      alertThreshold: 1,
      needsRestock: false,
      lastUpdatedAt: '2026-10-30T10:00:00.000Z',
    };

    const res1 = applyPantryQuantityDelta({
      item: initialItem,
      delta: -1,
      yearMonth: '2026-11',
      source: 'MANUAL',
      nowISO: '2026-11-02T08:00:00.000Z',
    });

    assert.equal(res1.updatedItem.currentQuantity, 1);
    assert.equal(res1.updatedItem.needsRestock, true);
    assert.equal(res1.triggeredLowStockAlert, true);
    assert.equal(res1.movement.yearMonth, '2026-11');
    assert.equal(res1.movement.type, 'CONSUMPTION');
  });

  it('IA-05 & IA-07 : calcule la durée moyenne de consommation (Smart Depletion) et normalise les clés sémantiques', () => {
    assert.equal(
      normalizeSemanticProductKey('HUILE TOURN. 100CL'),
      normalizeSemanticProductKey('Huile de Tournesol 1L')
    );

    const depletion = computeSmartDepletionPrediction({
      item: {
        id: 'item_lait',
        name: 'Lait 1L',
        normalizedProductKey: 'lait_1l',
        category: 'ALIMENTAIRE',
        currentQuantity: 2,
        unit: 'L',
        alertThreshold: 1,
        needsRestock: false,
        lastUpdatedAt: '2026-11-09T08:00:00.000Z',
      },
      consumptionTimestampsISO: [
        '2026-11-01T08:00:00.000Z',
        '2026-11-05T08:00:00.000Z',
        '2026-11-09T08:00:00.000Z',
      ],
      referenceDateISO: '2026-11-09T08:00:00.000Z',
    });

    assert.equal(depletion.averageConsumptionDays, 4);
    assert.equal(depletion.daysUntilStockout, 8);
    assert.equal(depletion.predictedStockoutDateISO, '2026-11-17');
  });
});

describe('Epic 3 & Epic 6 — Comparateur 5 km (Geohash/Haversine) & Coach Financier IA', () => {
  it('US 3.1, US 3.2, US 3.3 & IA-04 : filtre à <= 5 km et compare Prix Min par Article vs Magasin Unique', () => {
    const homeLat = 48.8566;
    const homeLng = 2.3522;
    const geohash = encodeGeohash(homeLat, homeLng);
    assert.equal(geohash.length, 7);

    const distNear = calculateHaversineDistanceKm(homeLat, homeLng, 48.865, 2.365);
    assert.ok(distNear <= 5.0);

    const result = computeDaily5kmBasketComparison({
      yearMonth: '2026-11',
      userLat: homeLat,
      userLng: homeLng,
      maxRadiusKm: 5.0,
      isBudgetTight: true,
      lowStockItems: [
        {
          id: 'item_huile',
          name: 'Huile Tournesol 1L',
          normalizedProductKey: 'huile_tournesol_1l',
          category: 'ALIMENTAIRE',
          currentQuantity: 1,
          unit: 'L',
          alertThreshold: 1,
          needsRestock: true,
          lastUpdatedAt: '2026-11-01',
        },
      ],
      stores: [
        {
          id: 'store_leclerc',
          name: 'E.Leclerc Drive 2km',
          brand: 'LECLERC',
          address: 'Paris',
          lat: 48.865,
          lng: 2.365,
          geohash,
          updatedAt: '2026-11-01',
        },
        {
          id: 'store_far',
          name: 'Hypermarché 12km (Hors Zone)',
          brand: 'CARREFOUR',
          address: 'Banlieue',
          lat: 48.96,
          lng: 2.48,
          geohash: 'u09tvw0',
          updatedAt: '2026-11-01',
        },
      ],
      storePrices: [
        {
          id: 'p1',
          storeId: 'store_leclerc',
          storeName: 'E.Leclerc Drive 2km',
          geohash,
          lat: 48.865,
          lng: 2.365,
          normalizedProductKey: 'huile_tournesol_1l',
          rawProductLabel: 'Huile Tournesol 1L Marque Nationale',
          unitPrice: 2.45,
          unit: 'L',
          observedAt: '2026-11-01',
          source: 'PDF_INVOICE',
        },
        {
          id: 'p2',
          storeId: 'store_leclerc',
          storeName: 'E.Leclerc Drive 2km',
          geohash,
          lat: 48.865,
          lng: 2.365,
          normalizedProductKey: 'huile_tournesol_1l',
          rawProductLabel: 'Huile Tournesol 1L Eco+ (Marque Distributeur)',
          unitPrice: 1.75,
          unit: 'L',
          isStoreBrandAlternative: true,
          observedAt: '2026-11-01',
          source: 'PDF_INVOICE',
        },
        {
          id: 'p_far',
          storeId: 'store_far',
          storeName: 'Hypermarché 12km (Hors Zone)',
          geohash: 'u09tvw0',
          lat: 48.96,
          lng: 2.48,
          normalizedProductKey: 'huile_tournesol_1l',
          rawProductLabel: 'Huile 1L',
          unitPrice: 0.99, // Doit être ignoré car > 5 km !
          unit: 'L',
          observedAt: '2026-11-01',
          source: 'PDF_INVOICE',
        },
      ],
    });

    assert.equal(result.itemsCount, 1);
    assert.equal(result.bestPerItemView.items[0].bestOffer.storeId, 'store_leclerc');
    assert.equal(result.bestPerItemView.items[0].bestOffer.unitPrice, 2.45);
    assert.ok(result.bestPerItemView.items[0].aiEconomyAlternative);
    assert.equal(
      result.bestPerItemView.items[0].aiEconomyAlternative?.unitPrice,
      1.75
    );
    assert.equal(result.bestSingleStoreView?.storeId, 'store_leclerc');
  });

  it('IA-01, IA-02, IA-03 : prédit l’atterrissage fin de mois, détecte les fuites et audite les charges fixes', () => {
    const forecast = predictEndOfMonthLanding({
      yearMonth: '2026-11',
      currentDayOfMonth: 15,
      allocatedLimit: 450,
      currentSpent: 300,
    });
    assert.equal(forecast.dailyVelocity, 20);
    assert.equal(forecast.projectedTotalSpent, 600);
    assert.equal(forecast.willOverflow, true);
    assert.equal(forecast.projectedOverflowDay, 23);

    const drift = detectCategorySpendingDrift({
      categoryName: 'Loisirs',
      currentMonthSpent: 264,
      historicalMonthlySpends: [200, 195, 205],
    });
    assert.equal(drift.hasSignificantDrift, true);
    assert.equal(drift.driftPercentage, 32);

    const audit = auditFixedChargesRatio(1350, 2500);
    assert.equal(audit.ratioPercentage, 54);
    assert.equal(audit.healthState, 'TIGHT');
    assert.equal(audit.excessAbove50Percent, 100);
  });

  it('US 4.3 & US 0.4 : vérifie l’empreinte anti-doublon PDF, la ventilation et le formatage multi-devises', () => {
    assert.equal(extractYearMonthFromDate('2026-11-14T18:22:00Z'), '2026-11');

    const fp1 = computeInvoiceFingerprint({
      storeName: 'E.Leclerc Drive',
      purchaseDateISO: '2026-11-14',
      totalAmountTTC: 105.0,
      invoiceNumber: 'FAC-2026-998',
    });
    const fp2 = computeInvoiceFingerprint({
      storeName: 'e leclerc drive',
      purchaseDateISO: '2026-11-14T10:00:00Z',
      totalAmountTTC: 105.0,
      invoiceNumber: 'fac-2026-998',
    });
    assert.equal(fp1, fp2);

    const splits = computeSuggestedBudgetSplits([
      {
        rawLabel: 'Lait 6x1L',
        normalizedLabel: 'Lait 1L',
        normalizedProductKey: 'lait_1l',
        quantity: 6,
        unit: 'L',
        unitPrice: 1.15,
        discountAmount: 0,
        lineTotalTTC: 6.9,
        categoryType: 'ALIMENTAIRE',
        addToPantry: true,
      },
      {
        rawLabel: 'Lessive 2L',
        normalizedLabel: 'Lessive Liquide 2L',
        normalizedProductKey: 'lessive_liquide_2l',
        quantity: 1,
        unit: 'L',
        unitPrice: 8.5,
        discountAmount: 0,
        lineTotalTTC: 8.5,
        categoryType: 'ENTRETIEN_HYGIENE',
        addToPantry: true,
      },
    ]);
    assert.equal(splits.length, 2);
    assert.ok(formatCurrencyAmount(1500, 'EUR', 'fr').includes('1'));
  });
});
