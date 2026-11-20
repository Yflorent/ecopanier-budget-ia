import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  BudgetRepository,
  PantryRepository,
  STITCH_SCREEN_ARCHITECTURAL_REGISTRY,
  TemporalBudgetStore,
  buildMultiMonthAnalyticsSeries,
  translate,
} from '../index';
import { BudgetCategory, MonthlyBudget, PantryItem } from '@depense/shared';

describe('Socle Mobile React Native (@depense/mobile) — Store Temporel YYYY-MM, Repositories & Analytics', () => {
  it('US 1.4 & US 0.4 : navigue entre les mois (< M-1 | M | M+1 >), verrouille les mois passés et traduit FR/EN', () => {
    const store = new TemporalBudgetStore('2026-11');
    assert.equal(store.getState().selectedYearMonth, '2026-11');
    assert.equal(store.getState().isHistoricalMonthReadOnly, false);

    store.navigateMonth(-1);
    assert.equal(store.getState().selectedYearMonth, '2026-10');
    assert.equal(store.getState().isHistoricalMonthReadOnly, true);

    const navLabels = store.getMonthNavigationBarLabels();
    assert.equal(navLabels.previousMonth.yearMonth, '2026-09');
    assert.equal(navLabels.selectedMonth.yearMonth, '2026-10');
    assert.equal(navLabels.nextMonth.yearMonth, '2026-11');

    assert.equal(translate('fr', 'budget.realDisposableIncome'), 'Reste à vivre réel');
    assert.equal(translate('en', 'budget.realDisposableIncome'), 'Real Disposable Income');
  });

  it('US 1.5 & US 1.6 : ajoute une dépense rattachée au mois de sa date et recalcule la jauge + portée de modification', async () => {
    let savedTxAmount = 0;
    let savedGauge = '';

    const repo = new BudgetRepository({
      async getMonthlyBudget(): Promise<MonthlyBudget> {
        return {
          yearMonth: '2026-11',
          status: 'OPEN',
          globalAllocated: 2500,
          totalFixedCharges: 900,
          totalVariableSpent: 300,
          totalSavedViaComparator: 10,
          realDisposableIncome: 1300,
          createdAt: '2026-11-01',
          updatedAt: '2026-11-10',
        };
      },
      async getMonthCategories(): Promise<BudgetCategory[]> {
        return [
          {
            id: 'cat_alim',
            yearMonth: '2026-11',
            name: 'Alimentation',
            icon: 'cart',
            colorHex: '#10B981',
            type: 'VARIABLE',
            allocatedLimit: 400,
            spentAmount: 300,
            consumptionPercentage: 75,
            gaugeState: 'WARNING',
          },
        ];
      },
      async getCategoryTemplates() {
        return [];
      },
      async saveMonthlyRolloverAtomic() {},
      async saveTransactionAndRecalculateAtomic(payload) {
        savedTxAmount = payload.transaction.amount;
        savedGauge = payload.updatedCategory.gaugeState;
      },
      async updateCategoryLimitWithScopeAtomic() {},
    });

    const res = await repo.addExpenseToDateMonth({
      userId: 'u_1',
      amount: 110,
      categoryId: 'cat_alim',
      dateISO: '2026-11-18T12:30:00Z',
      label: 'Courses Supermarché',
      defaultMonthlyIncome: 2500,
    });

    assert.equal(res.targetYearMonth, '2026-11');
    assert.equal(savedTxAmount, 110);
    assert.equal(savedGauge, 'CRITICAL'); // 410 / 400 = 102.5% >= 100%
    assert.equal(res.updatedMonthlyBudget.realDisposableIncome, 1190);
  });

  it('US 2.2, US 2.3 & US 5.1/5.2 : décrémente en 1 clic (-1), déclenche l’alerte locale et agrège les graphiques multi-mois', async () => {
    let lowStockNotified = false;
    const pantryRepo = new PantryRepository({
      async savePantryItemDeltaAtomic() {},
      async commitComparatorPurchaseWriteBatch() {},
      async triggerLocalLowStockAlertNotification() {
        lowStockNotified = true;
      },
    });

    const item: PantryItem = {
      id: 'item_huile',
      name: 'Huile 1L',
      normalizedProductKey: 'huile_1l',
      category: 'ALIMENTAIRE',
      currentQuantity: 2,
      unit: 'L',
      alertThreshold: 1,
      needsRestock: false,
      lastUpdatedAt: '2026-11-01',
    };

    const oneTap = await pantryRepo.decrementOrIncrementOneTap({
      userId: 'u_1',
      item,
      delta: -1,
      yearMonth: '2026-11',
    });

    assert.equal(oneTap.updatedItem.currentQuantity, 1);
    assert.equal(lowStockNotified, true);

    const chartData = buildMultiMonthAnalyticsSeries({
      locale: 'fr',
      monthlyBudgets: [
        {
          yearMonth: '2026-10',
          status: 'CLOSED',
          globalAllocated: 2500,
          totalFixedCharges: 900,
          totalVariableSpent: 1100,
          totalSavedViaComparator: 38,
          realDisposableIncome: 500,
          createdAt: '2026-10-01',
          updatedAt: '2026-10-31',
        },
        {
          yearMonth: '2026-11',
          status: 'OPEN',
          globalAllocated: 2500,
          totalFixedCharges: 900,
          totalVariableSpent: 850,
          totalSavedViaComparator: 44,
          realDisposableIncome: 750,
          createdAt: '2026-11-01',
          updatedAt: '2026-11-20',
        },
      ],
      selectedMonthCategories: [
        {
          id: 'cat_alim',
          yearMonth: '2026-11',
          name: 'Alimentation',
          icon: 'cart',
          colorHex: '#10B981',
          type: 'VARIABLE',
          allocatedLimit: 450,
          spentAmount: 350,
          consumptionPercentage: 77.78,
          gaugeState: 'WARNING',
        },
      ],
      pantryMovements: [oneTap.movement],
      selectedProductForInflationId: 'item_huile',
    });

    assert.equal(chartData.budgetVsSpentSeries.length, 2);
    assert.equal(chartData.categoryDonutSlices[0].percentageOfTotal, 100);
    assert.equal(chartData.pantryAndSavingsSeries[1].itemsConsumedCount, 1);
    assert.equal(Object.keys(STITCH_SCREEN_ARCHITECTURAL_REGISTRY).length, 10);
  });
});
