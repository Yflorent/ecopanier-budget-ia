import {
  BudgetCategory,
  BudgetGaugeState,
  BudgetTransaction,
  CategoryTemplate,
  FixedChargesHealthState,
  MonthlyBudget,
  YearMonth,
} from '../models';

/**
 * Calcule l'état de la jauge budgétaire d'un poste selon la règle US 1.5 :
 * - Vert (HEALTHY) : < 75%
 * - Orange (WARNING) : 75% à 99.99%
 * - Rouge (CRITICAL) : >= 100%
 */
export function computeBudgetGaugeState(
  spentAmount: number,
  allocatedLimit: number
): { percentage: number; gaugeState: BudgetGaugeState } {
  if (allocatedLimit <= 0) {
    const gaugeState: BudgetGaugeState = spentAmount > 0 ? 'CRITICAL' : 'HEALTHY';
    return { percentage: spentAmount > 0 ? 100 : 0, gaugeState };
  }
  const percentage = Math.round((spentAmount / allocatedLimit) * 10000) / 100;
  let gaugeState: BudgetGaugeState = 'HEALTHY';
  if (percentage >= 100) {
    gaugeState = 'CRITICAL';
  } else if (percentage >= 75) {
    gaugeState = 'WARNING';
  }
  return { percentage, gaugeState };
}

/**
 * Calcule le "Reste à vivre réel" (US 1.3) :
 * Plafond Global Alloué - Total Charges Fixes Prélevées - Total Dépenses Variables
 */
export function computeRealDisposableIncome(
  globalAllocated: number,
  totalFixedCharges: number,
  totalVariableSpent: number
): number {
  return Math.round((globalAllocated - totalFixedCharges - totalVariableSpent) * 100) / 100;
}

/**
 * Évalue le poids des charges fixes par rapport au budget global (IA-03 / US 6.3) :
 * - Sain (HEALTHY) : < 50%
 * - Tendu (TIGHT) : 50% à 60%
 * - Critique (CRITICAL) : > 60%
 */
export function auditFixedChargesRatio(
  totalFixedCharges: number,
  globalAllocated: number
): { ratioPercentage: number; healthState: FixedChargesHealthState; excessAbove50Percent: number } {
  if (globalAllocated <= 0) {
    return {
      ratioPercentage: totalFixedCharges > 0 ? 100 : 0,
      healthState: totalFixedCharges > 0 ? 'CRITICAL' : 'HEALTHY',
      excessAbove50Percent: totalFixedCharges,
    };
  }
  const ratioPercentage = Math.round((totalFixedCharges / globalAllocated) * 10000) / 100;
  let healthState: FixedChargesHealthState = 'HEALTHY';
  if (ratioPercentage > 60) {
    healthState = 'CRITICAL';
  } else if (ratioPercentage >= 50) {
    healthState = 'TIGHT';
  }
  const maxHealthyAmount = globalAllocated * 0.5;
  const excessAbove50Percent = Math.max(
    0,
    Math.round((totalFixedCharges - maxHealthyAmount) * 100) / 100
  );
  return { ratioPercentage, healthState, excessAbove50Percent };
}

/**
 * Génère automatiquement la nouvelle instance de budget mensuel `YYYY-MM` à partir des modèles récurrents
 * ("Zéro Ressaisie" — US 1.2 & US 1.3) et crée les transactions d'auto-débit du 1er du mois.
 */
export function buildInitialMonthlyBudgetRollover(params: {
  yearMonth: YearMonth;
  defaultMonthlyIncome: number;
  templates: CategoryTemplate[];
  nowISO?: string;
}): {
  monthlyBudget: MonthlyBudget;
  categories: BudgetCategory[];
  autoTransactions: BudgetTransaction[];
} {
  const nowISO = params.nowISO ?? new Date().toISOString();
  const firstDayDateISO = `${params.yearMonth}-01T00:01:00.000Z`;

  const activeRecurringTemplates = params.templates.filter(
    (tpl) => tpl.isRecurring && !tpl.isArchived
  );

  let totalFixedCharges = 0;
  const categories: BudgetCategory[] = [];
  const autoTransactions: BudgetTransaction[] = [];

  for (const tpl of activeRecurringTemplates) {
    const isFixed =
      tpl.type === 'CHARGE_FIXE' ||
      (tpl.type as string) === 'FIXE' ||
      (tpl.type as string) === 'FIXED' ||
      tpl.autoDebitOnFirstDay === true;
    const shouldAutoDebit = isFixed && tpl.autoDebitOnFirstDay !== false;
    const initialSpent = shouldAutoDebit ? tpl.defaultLimit : 0;

    if (shouldAutoDebit) {
      totalFixedCharges = Math.round((totalFixedCharges + tpl.defaultLimit) * 100) / 100;
      autoTransactions.push({
        id: `auto_${params.yearMonth}_${tpl.id}`,
        yearMonth: params.yearMonth,
        categoryId: tpl.id,
        categoryName: tpl.name,
        amount: tpl.defaultLimit,
        type: 'CHARGE_FIXE',
        date: firstDayDateISO,
        label: `Prélèvement automatique 1er du mois — ${tpl.name}`,
        source: 'AUTO_FIXED_CHARGE',
        createdAt: nowISO,
      });
    }

    const { percentage, gaugeState } = computeBudgetGaugeState(initialSpent, tpl.defaultLimit);
    categories.push({
      id: tpl.id,
      templateId: tpl.id,
      yearMonth: params.yearMonth,
      name: tpl.name,
      icon: tpl.icon,
      colorHex: tpl.colorHex,
      type: isFixed ? 'CHARGE_FIXE' : tpl.type,
      allocatedLimit: tpl.defaultLimit,
      spentAmount: initialSpent,
      consumptionPercentage: percentage,
      gaugeState,
      autoDebited: shouldAutoDebit,
    });
  }

  const realDisposableIncome = computeRealDisposableIncome(
    params.defaultMonthlyIncome,
    totalFixedCharges,
    0
  );

  const monthlyBudget: MonthlyBudget = {
    yearMonth: params.yearMonth,
    status: 'OPEN',
    globalAllocated: params.defaultMonthlyIncome,
    totalFixedCharges,
    totalVariableSpent: 0,
    totalSavedViaComparator: 0,
    realDisposableIncome,
    projectedEndOfMonthBalance: realDisposableIncome,
    createdAt: nowISO,
    updatedAt: nowISO,
  };

  return { monthlyBudget, categories, autoTransactions };
}

/**
 * IA-01 — Prédiction d'Atterrissage de Fin de Mois (Budget Forecasting - US 6.1)
 * Calcule la vélocité quotidienne d'un poste ou du budget global et prédit le solde au dernier jour du mois
 * ainsi que la date exacte de dépassement potentiel.
 */
export function predictEndOfMonthLanding(params: {
  yearMonth: YearMonth;
  currentDayOfMonth: number;
  allocatedLimit: number;
  currentSpent: number;
}): {
  dailyVelocity: number;
  daysInMonth: number;
  projectedTotalSpent: number;
  projectedEndBalance: number;
  willOverflow: boolean;
  projectedOverflowDay?: number;
  projectedOverflowDateISO?: string;
} {
  const [yearStr, monthStr] = params.yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const elapsedDays = Math.max(1, Math.min(params.currentDayOfMonth, daysInMonth));
  const remainingDays = Math.max(0, daysInMonth - elapsedDays);

  const dailyVelocity = Math.round((params.currentSpent / elapsedDays) * 100) / 100;
  const projectedTotalSpent =
    Math.round((params.currentSpent + dailyVelocity * remainingDays) * 100) / 100;
  const projectedEndBalance =
    Math.round((params.allocatedLimit - projectedTotalSpent) * 100) / 100;
  const willOverflow = projectedTotalSpent > params.allocatedLimit && dailyVelocity > 0;

  let projectedOverflowDay: number | undefined;
  let projectedOverflowDateISO: string | undefined;

  if (willOverflow) {
    const exactDay = Math.ceil(params.allocatedLimit / dailyVelocity);
    projectedOverflowDay = Math.max(1, Math.min(daysInMonth, exactDay));
    const dayPadded = String(projectedOverflowDay).padStart(2, '0');
    projectedOverflowDateISO = `${params.yearMonth}-${dayPadded}`;
  }

  return {
    dailyVelocity,
    daysInMonth,
    projectedTotalSpent,
    projectedEndBalance,
    willOverflow,
    projectedOverflowDay,
    projectedOverflowDateISO,
  };
}

/**
 * IA-02 — Détection des dérives budgétaires ("Fuites de budget" - US 6.2)
 * Compare les dépenses du mois M avec la moyenne glissante des 3 à 6 derniers mois.
 */
export function detectCategorySpendingDrift(params: {
  categoryName: string;
  currentMonthSpent: number;
  historicalMonthlySpends: number[]; // 3 à 6 derniers mois
  microTransactionsCount?: number;
}): {
  hasSignificantDrift: boolean;
  driftPercentage: number;
  historicalAverage: number;
} {
  if (params.historicalMonthlySpends.length === 0) {
    return { hasSignificantDrift: false, driftPercentage: 0, historicalAverage: 0 };
  }
  const sum = params.historicalMonthlySpends.reduce((acc, v) => acc + v, 0);
  const historicalAverage = Math.round((sum / params.historicalMonthlySpends.length) * 100) / 100;
  if (historicalAverage <= 0) {
    return { hasSignificantDrift: false, driftPercentage: 0, historicalAverage: 0 };
  }
  const driftPercentage =
    Math.round(((params.currentMonthSpent - historicalAverage) / historicalAverage) * 10000) / 100;

  return {
    hasSignificantDrift: driftPercentage > 15,
    driftPercentage,
    historicalAverage,
  };
}
