import {
  BudgetCategory,
  MonthlyBudget,
  PantryMovement,
  SupportedLocale,
  YearMonth,
  formatYearMonthLabel,
} from '@depense/shared';

export interface MultiMonthChartSeries {
  /** Graphique 1 (US 5.1) : Courbe / Histogramme mensuel comparatif Budget Alloué vs Dépensé */
  budgetVsSpentSeries: Array<{
    yearMonth: YearMonth;
    monthLabel: string;
    allocated: number;
    totalSpent: number;
    savedViaComparator: number;
  }>;
  /** Graphique 2 (US 5.1) : Donut de répartition par poste pour le mois sélectionné */
  categoryDonutSlices: Array<{
    categoryId: string;
    name: string;
    colorHex: string;
    spentAmount: number;
    percentageOfTotal: number;
  }>;
  /** Graphique 3 (US 5.2) : Histogramme des économies mensuelles 5 km & volume d'articles consommés */
  pantryAndSavingsSeries: Array<{
    yearMonth: YearMonth;
    monthLabel: string;
    itemsConsumedCount: number;
    restockSpentAmount: number;
    savedViaComparator: number;
  }>;
  /** Graphique 4 (US 5.2) : Courbe d'inflation personnelle d'un produit sur 6 mois */
  productPriceEvolutionSeries: Array<{
    dateISO: string;
    yearMonth: YearMonth;
    unitPricePaid: number;
    storeName?: string;
  }>;
}

/**
 * Service d'Agrégation Graphique & Évolutions Multi-Mois (Epic 5 — US 5.1 & US 5.2 — STITCH-08)
 */
export function buildMultiMonthAnalyticsSeries(params: {
  locale: SupportedLocale;
  monthlyBudgets: MonthlyBudget[]; // Triés par yearMonth croissant (3M, 6M ou 12M)
  selectedMonthCategories: BudgetCategory[];
  pantryMovements: PantryMovement[];
  selectedProductForInflationId?: string;
}): MultiMonthChartSeries {
  const budgetVsSpentSeries = params.monthlyBudgets.map((mb) => {
    const totalSpent =
      Math.round((mb.totalFixedCharges + mb.totalVariableSpent) * 100) / 100;
    return {
      yearMonth: mb.yearMonth,
      monthLabel: formatYearMonthLabel(mb.yearMonth, params.locale),
      allocated: mb.globalAllocated,
      totalSpent,
      savedViaComparator: mb.totalSavedViaComparator,
    };
  });

  const totalSelectedMonthSpent = params.selectedMonthCategories.reduce(
    (acc, c) => acc + c.spentAmount,
    0
  );

  const categoryDonutSlices = params.selectedMonthCategories.map((cat) => ({
    categoryId: cat.id,
    name: cat.name,
    colorHex: cat.colorHex,
    spentAmount: cat.spentAmount,
    percentageOfTotal:
      totalSelectedMonthSpent > 0
        ? Math.round((cat.spentAmount / totalSelectedMonthSpent) * 10000) / 100
        : 0,
  }));

  const pantryAndSavingsSeries = params.monthlyBudgets.map((mb) => {
    const monthMovements = params.pantryMovements.filter(
      (m) => m.yearMonth === mb.yearMonth
    );
    const itemsConsumedCount = monthMovements
      .filter((m) => m.type === 'CONSUMPTION')
      .reduce((acc, m) => acc + Math.abs(m.quantityDelta), 0);

    const restockSpentAmount = monthMovements
      .filter((m) => m.type === 'RESTOCK')
      .reduce(
        (acc, m) => acc + (m.unitPricePaid ?? 0) * Math.max(0, m.quantityDelta),
        0
      );

    return {
      yearMonth: mb.yearMonth,
      monthLabel: formatYearMonthLabel(mb.yearMonth, params.locale),
      itemsConsumedCount,
      restockSpentAmount: Math.round(restockSpentAmount * 100) / 100,
      savedViaComparator: mb.totalSavedViaComparator,
    };
  });

  const productPriceEvolutionSeries = params.selectedProductForInflationId
    ? params.pantryMovements
        .filter(
          (m) =>
            m.itemId === params.selectedProductForInflationId &&
            m.type === 'RESTOCK' &&
            typeof m.unitPricePaid === 'number'
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map((m) => ({
          dateISO: m.timestamp.slice(0, 10),
          yearMonth: m.yearMonth,
          unitPricePaid: m.unitPricePaid!,
          storeName: m.storeName,
        }))
    : [];

  return {
    budgetVsSpentSeries,
    categoryDonutSlices,
    pantryAndSavingsSeries,
    productPriceEvolutionSeries,
  };
}
