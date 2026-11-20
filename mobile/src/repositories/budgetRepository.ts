import {
  BudgetCategory,
  BudgetTransaction,
  CategoryTemplate,
  MonthlyBudget,
  YearMonth,
  buildInitialMonthlyBudgetRollover,
  computeBudgetGaugeState,
  computeRealDisposableIncome,
  extractYearMonthFromDate,
} from '@depense/shared';

export type CategoryUpdateScope = 'MONTH_ONLY' | 'MONTH_AND_FUTURE_TEMPLATES';

export interface MobileBudgetStoragePort {
  getMonthlyBudget(userId: string, yearMonth: YearMonth): Promise<MonthlyBudget | null>;
  getMonthCategories(userId: string, yearMonth: YearMonth): Promise<BudgetCategory[]>;
  getCategoryTemplates(userId: string): Promise<CategoryTemplate[]>;
  saveMonthlyRolloverAtomic(params: {
    userId: string;
    monthlyBudget: MonthlyBudget;
    categories: BudgetCategory[];
    autoTransactions: BudgetTransaction[];
  }): Promise<void>;
  saveTransactionAndRecalculateAtomic(params: {
    userId: string;
    yearMonth: YearMonth;
    transaction: BudgetTransaction;
    updatedCategory: BudgetCategory;
    updatedMonthlyBudget: MonthlyBudget;
  }): Promise<void>;
  updateCategoryLimitWithScopeAtomic(params: {
    userId: string;
    yearMonth: YearMonth;
    updatedCategory: BudgetCategory;
    updatedTemplate?: CategoryTemplate;
  }): Promise<void>;
}

/**
 * Repository Mobile de Gestion Budgétaire Mensuelle (Epic 1 — US 1.1 à US 1.6)
 */
export class BudgetRepository {
  constructor(private readonly port: MobileBudgetStoragePort) {}

  /**
   * US 1.3 (Critère 1) — Lazy Init à l'ouverture de l'application :
   * Si la page de budget du mois courant (`YYYY-MM`) n'existe pas encore le 1er du mois,
   * la génère immédiatement avec ses modèles récurrents et ses charges fixes auto-débitées.
   */
  public async ensureMonthPageExistsLazyInit(params: {
    userId: string;
    yearMonth: YearMonth;
    defaultMonthlyIncome: number;
  }): Promise<MonthlyBudget> {
    const existing = await this.port.getMonthlyBudget(params.userId, params.yearMonth);
    if (existing) {
      return existing;
    }

    const templates = await this.port.getCategoryTemplates(params.userId);
    const rollover = buildInitialMonthlyBudgetRollover({
      yearMonth: params.yearMonth,
      defaultMonthlyIncome: params.defaultMonthlyIncome,
      templates,
    });

    await this.port.saveMonthlyRolloverAtomic({
      userId: params.userId,
      monthlyBudget: rollover.monthlyBudget,
      categories: rollover.categories,
      autoTransactions: rollover.autoTransactions,
    });

    return rollover.monthlyBudget;
  }

  /**
   * US 1.5 — Ajout d'une dépense quotidienne rattachée automatiquement au mois `YYYY-MM` de sa date
   * et recalcul immédiat de la jauge (Vert <75%, Orange 75-99%, Rouge >=100%) et du Reste à vivre réel.
   */
  public async addExpenseToDateMonth(params: {
    userId: string;
    amount: number;
    categoryId: string;
    dateISO: string;
    label: string;
    note?: string;
    defaultMonthlyIncome: number;
  }): Promise<{
    targetYearMonth: YearMonth;
    transaction: BudgetTransaction;
    updatedCategory: BudgetCategory;
    updatedMonthlyBudget: MonthlyBudget;
  }> {
    const targetYearMonth = extractYearMonthFromDate(params.dateISO);
    const monthlyBudget = await this.ensureMonthPageExistsLazyInit({
      userId: params.userId,
      yearMonth: targetYearMonth,
      defaultMonthlyIncome: params.defaultMonthlyIncome,
    });

    const categories = await this.port.getMonthCategories(params.userId, targetYearMonth);
    const category = categories.find((c) => c.id === params.categoryId);
    if (!category) {
      throw new Error(
        `Poste budgétaire "${params.categoryId}" introuvable pour le mois ${targetYearMonth}`
      );
    }

    const newCategorySpent = Math.round((category.spentAmount + params.amount) * 100) / 100;
    const { percentage, gaugeState } = computeBudgetGaugeState(
      newCategorySpent,
      category.allocatedLimit
    );

    const updatedCategory: BudgetCategory = {
      ...category,
      spentAmount: newCategorySpent,
      consumptionPercentage: percentage,
      gaugeState,
    };

    const isFixed = category.type === 'CHARGE_FIXE';
    const newTotalFixed = isFixed
      ? Math.round((monthlyBudget.totalFixedCharges + params.amount) * 100) / 100
      : monthlyBudget.totalFixedCharges;
    const newTotalVariable = !isFixed
      ? Math.round((monthlyBudget.totalVariableSpent + params.amount) * 100) / 100
      : monthlyBudget.totalVariableSpent;

    const updatedMonthlyBudget: MonthlyBudget = {
      ...monthlyBudget,
      totalFixedCharges: newTotalFixed,
      totalVariableSpent: newTotalVariable,
      realDisposableIncome: computeRealDisposableIncome(
        monthlyBudget.globalAllocated,
        newTotalFixed,
        newTotalVariable
      ),
      updatedAt: new Date().toISOString(),
    };

    const transaction: BudgetTransaction = {
      id: `tx_${targetYearMonth}_${Date.now()}`,
      yearMonth: targetYearMonth,
      categoryId: category.id,
      categoryName: category.name,
      amount: params.amount,
      type: category.type,
      date: params.dateISO,
      label: params.label,
      note: params.note,
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
    };

    await this.port.saveTransactionAndRecalculateAtomic({
      userId: params.userId,
      yearMonth: targetYearMonth,
      transaction,
      updatedCategory,
      updatedMonthlyBudget,
    });

    return {
      targetYearMonth,
      transaction,
      updatedCategory,
      updatedMonthlyBudget,
    };
  }

  /**
   * US 1.6 — Ajustement du plafond d'un poste sans altérer les mois passés :
   * Permet de choisir entre `MONTH_ONLY` (mois affiché uniquement) et
   * `MONTH_AND_FUTURE_TEMPLATES` (mois affiché + modèle permanent pour les mois futurs).
   */
  public async updateCategoryLimit(params: {
    userId: string;
    yearMonth: YearMonth;
    category: BudgetCategory;
    newLimit: number;
    scope: CategoryUpdateScope;
    existingTemplate?: CategoryTemplate;
  }): Promise<BudgetCategory> {
    const { percentage, gaugeState } = computeBudgetGaugeState(
      params.category.spentAmount,
      params.newLimit
    );

    const updatedCategory: BudgetCategory = {
      ...params.category,
      allocatedLimit: params.newLimit,
      consumptionPercentage: percentage,
      gaugeState,
    };

    const updatedTemplate =
      params.scope === 'MONTH_AND_FUTURE_TEMPLATES' && params.existingTemplate
        ? {
            ...params.existingTemplate,
            defaultLimit: params.newLimit,
            updatedAt: new Date().toISOString(),
          }
        : undefined;

    await this.port.updateCategoryLimitWithScopeAtomic({
      userId: params.userId,
      yearMonth: params.yearMonth,
      updatedCategory,
      updatedTemplate,
    });

    return updatedCategory;
  }
}
