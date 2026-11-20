import {
  BudgetCategory,
  BudgetTransaction,
  DailyBasketComparisonResult,
  MonthlyBudget,
  PantryItem,
  PantryMovement,
  YearMonth,
  applyPantryQuantityDelta,
  computeBudgetGaugeState,
  computeRealDisposableIncome,
  getCurrentYearMonth,
} from '@depense/shared';

export interface MobilePantryStoragePort {
  savePantryItemDeltaAtomic(params: {
    userId: string;
    updatedItem: PantryItem;
    movement: PantryMovement;
  }): Promise<void>;
  commitComparatorPurchaseWriteBatch(params: {
    userId: string;
    yearMonth: YearMonth;
    updatedPantryItems: PantryItem[];
    movements: PantryMovement[];
    transaction: BudgetTransaction;
    updatedFoodCategory: BudgetCategory;
    updatedMonthlyBudget: MonthlyBudget;
  }): Promise<void>;
  triggerLocalLowStockAlertNotification(item: PantryItem): Promise<void>;
}

/**
 * Repository Mobile de Gestion de la Réserve Domestique & Passerelle d'Achat (Epic 2 & US 4.1)
 */
export class PantryRepository {
  constructor(private readonly port: MobilePantryStoragePort) {}

  /**
   * US 2.2 & US 2.3 — Décrémentation rapide en 1 clic ("1-Tap Use" : -1) ou ajout (+1)
   * Journalise le mouvement dans `pantryMovements` rattaché au mois actif (`yearMonth`)
   * et déclenche immédiatement la notification locale dès que `currentQuantity <= 1`.
   */
  public async decrementOrIncrementOneTap(params: {
    userId: string;
    item: PantryItem;
    delta: -1 | 1;
    yearMonth?: YearMonth;
  }): Promise<{
    updatedItem: PantryItem;
    movement: PantryMovement;
    triggeredLowStockAlert: boolean;
  }> {
    const yearMonth = params.yearMonth ?? getCurrentYearMonth();
    const result = applyPantryQuantityDelta({
      item: params.item,
      delta: params.delta,
      yearMonth,
      source: 'MANUAL',
    });

    await this.port.savePantryItemDeltaAtomic({
      userId: params.userId,
      updatedItem: result.updatedItem,
      movement: result.movement,
    });

    if (result.triggeredLowStockAlert) {
      await this.port.triggerLocalLowStockAlertNotification(result.updatedItem);
    }

    return result;
  }

  /**
   * US 4.1 — Validation d'achat du comparateur 5 km rattachée au budget du mois en cours (`WriteBatch` atomique)
   * 1. Incrémente les quantités dans `pantryItems` et remet `needsRestock = false`.
   * 2. Enregistre les mouvements `RESTOCK` dans `pantryMovements` avec l'économie réalisée.
   * 3. Crée la dépense sur le poste "Alimentation" dans `monthlyBudgets/{currentYearMonth}/transactions`.
   * 4. Met à jour `totalSavedViaComparator` et le Reste à vivre réel du mois.
   */
  public async validate5kmComparatorPurchaseAtomic(params: {
    userId: string;
    yearMonth: YearMonth;
    comparison: DailyBasketComparisonResult;
    mode: 'BEST_PER_ITEM' | 'SINGLE_STORE';
    pantryItemsMap: Map<string, PantryItem>;
    foodCategory: BudgetCategory;
    monthlyBudget: MonthlyBudget;
  }): Promise<{
    transaction: BudgetTransaction;
    updatedPantryItems: PantryItem[];
    updatedMonthlyBudget: MonthlyBudget;
  }> {
    const nowISO = new Date().toISOString();
    const updatedPantryItems: PantryItem[] = [];
    const movements: PantryMovement[] = [];

    const totalCost =
      params.mode === 'SINGLE_STORE' && params.comparison.bestSingleStoreView
        ? params.comparison.bestSingleStoreView.totalBasketCost
        : params.comparison.bestPerItemView.totalCost;

    const totalSavings =
      params.mode === 'SINGLE_STORE' && params.comparison.bestSingleStoreView
        ? params.comparison.bestSingleStoreView.totalSavingsVsAverage
        : params.comparison.bestPerItemView.totalSavingsVsAverage;

    const storeName =
      params.mode === 'SINGLE_STORE' && params.comparison.bestSingleStoreView
        ? params.comparison.bestSingleStoreView.storeName
        : 'Panier Optimisé Multi-Enseignes (<= 5 km)';

    const transactionId = `tx_comp5km_${params.yearMonth}_${Date.now()}`;

    for (const compItem of params.comparison.bestPerItemView.items) {
      const existing = params.pantryItemsMap.get(compItem.pantryItemId);
      if (!existing) continue;

      const { updatedItem, movement } = applyPantryQuantityDelta({
        item: existing,
        delta: compItem.quantityToBuy,
        yearMonth: params.yearMonth,
        source: 'COMPARATOR_5KM',
        nowISO,
        unitPricePaid: compItem.bestOffer.unitPrice,
        savedAmount: compItem.bestOffer.savingVsAverage,
        storeId: compItem.bestOffer.storeId,
        storeName: compItem.bestOffer.storeName,
        transactionId,
      });

      updatedPantryItems.push(updatedItem);
      movements.push(movement);
    }

    const newCategorySpent =
      Math.round((params.foodCategory.spentAmount + totalCost) * 100) / 100;
    const { percentage, gaugeState } = computeBudgetGaugeState(
      newCategorySpent,
      params.foodCategory.allocatedLimit
    );

    const updatedFoodCategory: BudgetCategory = {
      ...params.foodCategory,
      spentAmount: newCategorySpent,
      consumptionPercentage: percentage,
      gaugeState,
    };

    const newVariableSpent =
      Math.round((params.monthlyBudget.totalVariableSpent + totalCost) * 100) / 100;
    const newTotalSaved =
      Math.round((params.monthlyBudget.totalSavedViaComparator + totalSavings) * 100) / 100;

    const updatedMonthlyBudget: MonthlyBudget = {
      ...params.monthlyBudget,
      totalVariableSpent: newVariableSpent,
      totalSavedViaComparator: newTotalSaved,
      realDisposableIncome: computeRealDisposableIncome(
        params.monthlyBudget.globalAllocated,
        params.monthlyBudget.totalFixedCharges,
        newVariableSpent
      ),
      updatedAt: nowISO,
    };

    const transaction: BudgetTransaction = {
      id: transactionId,
      yearMonth: params.yearMonth,
      categoryId: params.foodCategory.id,
      categoryName: params.foodCategory.name,
      amount: totalCost,
      type: 'VARIABLE',
      date: nowISO,
      label: `Courses Réserve — ${storeName}`,
      source: 'COMPARATOR_5KM',
      storeName,
      savedAmountViaComparator: totalSavings,
      createdAt: nowISO,
    };

    await this.port.commitComparatorPurchaseWriteBatch({
      userId: params.userId,
      yearMonth: params.yearMonth,
      updatedPantryItems,
      movements,
      transaction,
      updatedFoodCategory,
      updatedMonthlyBudget,
    });

    return {
      transaction,
      updatedPantryItems,
      updatedMonthlyBudget,
    };
  }
}
