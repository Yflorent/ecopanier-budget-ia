import {
  AIInsight,
  BudgetCategory,
  BudgetTransaction,
  CategoryTemplate,
  DailyBasketComparisonResult,
  MonthlyBudget,
  PantryItem,
  PantryMovement,
  SupportedCurrency,
  SupportedLocale,
  UserProfile,
  YearMonth,
  formatYearMonthLabel,
  getCurrentYearMonth,
  shiftYearMonth,
} from '@depense/shared';

/**
 * État Réactif Centralisé — Centré sur `selectedYearMonth` (Section 3.1 & US 1.4 du PRD)
 * Lors d'un changement de `selectedYearMonth` (< Mois M-1 | Mois M | Mois M+1 >),
 * toutes les sous-collections rattachées au mois (jauges, transactions, factures PDF,
 * mouvements de réserve, économies 5 km et insights IA) sont synchronisées.
 */
export interface TemporalAppStoreState {
  currentUser: UserProfile | null;
  locale: SupportedLocale;
  currency: SupportedCurrency;
  selectedYearMonth: YearMonth;
  currentRealYearMonth: YearMonth;
  isHistoricalMonthReadOnly: boolean;

  // Données permanentes de l'utilisateur
  categoryTemplates: CategoryTemplate[];
  pantryItems: PantryItem[];

  // Données strictement cloisonnées par `selectedYearMonth`
  activeMonthlyBudget: MonthlyBudget | null;
  activeMonthCategories: BudgetCategory[];
  activeMonthTransactions: BudgetTransaction[];
  activeMonthPantryMovements: PantryMovement[];
  activeMonthAIInsights: AIInsight[];
  activeDailyComparison5km: DailyBasketComparisonResult | null;
}

export type StateListener = (state: TemporalAppStoreState) => void;

export class TemporalBudgetStore {
  private state: TemporalAppStoreState;
  private listeners = new Set<StateListener>();

  constructor(initialYearMonth: YearMonth = getCurrentYearMonth()) {
    this.state = {
      currentUser: null,
      locale: 'fr',
      currency: 'EUR',
      selectedYearMonth: initialYearMonth,
      currentRealYearMonth: initialYearMonth,
      isHistoricalMonthReadOnly: false,
      categoryTemplates: [],
      pantryItems: [],
      activeMonthlyBudget: null,
      activeMonthCategories: [],
      activeMonthTransactions: [],
      activeMonthPantryMovements: [],
      activeMonthAIInsights: [],
      activeDailyComparison5km: null,
    };
  }

  public getState(): TemporalAppStoreState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<TemporalAppStoreState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * US 1.4 — Navigation temporelle vers un mois précis (`YYYY-MM`)
   */
  public selectYearMonth(targetYearMonth: YearMonth): void {
    const isPastMonth = targetYearMonth < this.state.currentRealYearMonth;
    this.setState({
      selectedYearMonth: targetYearMonth,
      isHistoricalMonthReadOnly: isPastMonth,
    });
  }

  /**
   * US 1.4 — Bascule `< Mois M-1 | Mois M | Mois M+1 >`
   */
  public navigateMonth(delta: -1 | 1): YearMonth {
    const nextMonth = shiftYearMonth(this.state.selectedYearMonth, delta);
    this.selectYearMonth(nextMonth);
    return nextMonth;
  }

  /**
   * Retourne les libellés formatés de la barre de navigation temporelle `< M-1 | M | M+1 >` (STITCH-03)
   */
  public getMonthNavigationBarLabels(): {
    previousMonth: { yearMonth: YearMonth; label: string };
    selectedMonth: { yearMonth: YearMonth; label: string; isClosed: boolean };
    nextMonth: { yearMonth: YearMonth; label: string };
  } {
    const prev = shiftYearMonth(this.state.selectedYearMonth, -1);
    const curr = this.state.selectedYearMonth;
    const next = shiftYearMonth(this.state.selectedYearMonth, 1);

    return {
      previousMonth: {
        yearMonth: prev,
        label: formatYearMonthLabel(prev, this.state.locale),
      },
      selectedMonth: {
        yearMonth: curr,
        label: formatYearMonthLabel(curr, this.state.locale),
        isClosed:
          this.state.activeMonthlyBudget?.status === 'CLOSED' ||
          curr < this.state.currentRealYearMonth,
      },
      nextMonth: {
        yearMonth: next,
        label: formatYearMonthLabel(next, this.state.locale),
      },
    };
  }

  /**
   * US 0.4 — Changement de langue et de devise à chaud
   */
  public setLocaleAndCurrency(
    locale: SupportedLocale,
    currency: SupportedCurrency
  ): void {
    this.setState({ locale, currency });
  }

  /**
   * Hydrate les données exclusives du mois sélectionné (`selectedYearMonth`)
   */
  public setMonthlyScopedData(payload: {
    yearMonth: YearMonth;
    monthlyBudget: MonthlyBudget | null;
    categories: BudgetCategory[];
    transactions: BudgetTransaction[];
    pantryMovements: PantryMovement[];
    aiInsights: AIInsight[];
    dailyComparison5km?: DailyBasketComparisonResult | null;
  }): void {
    if (payload.yearMonth !== this.state.selectedYearMonth) {
      return;
    }
    this.setState({
      activeMonthlyBudget: payload.monthlyBudget,
      activeMonthCategories: payload.categories,
      activeMonthTransactions: payload.transactions,
      activeMonthPantryMovements: payload.pantryMovements,
      activeMonthAIInsights: payload.aiInsights,
      activeDailyComparison5km:
        payload.dailyComparison5km ?? this.state.activeDailyComparison5km,
    });
  }

  public setPantryItems(items: PantryItem[]): void {
    this.setState({ pantryItems: items });
  }

  public setCategoryTemplates(templates: CategoryTemplate[]): void {
    this.setState({ categoryTemplates: templates });
  }
}
