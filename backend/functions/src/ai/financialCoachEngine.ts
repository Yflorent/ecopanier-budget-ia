import {
  AIInsight,
  BudgetCategory,
  MonthlyBudget,
  PantryItem,
  SupportedCurrency,
  SupportedLocale,
  YearMonth,
  auditFixedChargesRatio,
  computeSmartDepletionPrediction,
  detectCategorySpendingDrift,
  formatCurrencyAmount,
  predictEndOfMonthLanding,
} from '@depense/shared';

/**
 * Epic 6 (US 6.1 à US 6.4) — Moteur Analytique & Coach Financier IA
 * Génère les cartes d'insights IA rattachées au mois actif `monthlyBudgets/{yearMonth}/aiInsights` :
 * - IA-01 : Prédiction d'atterrissage de fin de mois (Budget Forecasting)
 * - IA-02 : Détection d'anomalies et fuites de budget (> 15% vs moyenne 3-6 mois)
 * - IA-03 : Audit du poids des charges fixes (> 50%)
 * - IA-04 : Propositions d'économies hybrides (Substitutions 5 km & Achat d'opportunité)
 * - IA-05 : Prédiction de rupture de stock (Smart Depletion)
 */
export function generateMonthlyFinancialCoachInsights(params: {
  yearMonth: YearMonth;
  currentDayOfMonth: number;
  locale: SupportedLocale;
  currency: SupportedCurrency;
  monthlyBudget: MonthlyBudget;
  categories: BudgetCategory[];
  historicalCategorySpends: Record<string, number[]>; // categoryId -> [M-3, M-2, M-1]
  pantryItems: PantryItem[];
  pantryConsumptionHistory: Record<string, string[]>; // itemId -> timestamps ISO des clics -1
  nowISO?: string;
}): AIInsight[] {
  const nowISO = params.nowISO ?? new Date().toISOString();
  const isEn = params.locale === 'en';
  const insights: AIInsight[] = [];

  // 1. IA-01 — Prédiction d'Atterrissage de Fin de Mois par Poste Variable
  for (const cat of params.categories.filter((c) => c.type === 'VARIABLE')) {
    const forecast = predictEndOfMonthLanding({
      yearMonth: params.yearMonth,
      currentDayOfMonth: params.currentDayOfMonth,
      allocatedLimit: cat.allocatedLimit,
      currentSpent: cat.spentAmount,
    });

    if (forecast.willOverflow && forecast.projectedOverflowDay) {
      const overflowAmt = Math.abs(forecast.projectedEndBalance);
      const formattedOverflow = formatCurrencyAmount(
        overflowAmt,
        params.currency,
        params.locale
      );
      insights.push({
        id: `ia01_${params.yearMonth}_${cat.id}`,
        yearMonth: params.yearMonth,
        code: 'IA-01_FORECAST',
        severity: 'WARNING',
        targetCategoryId: cat.id,
        title: isEn
          ? `Projected Overflow on ${cat.name}`
          : `Risque de dépassement sur ${cat.name}`,
        description: isEn
          ? `At your current pace, your ${cat.name} budget will be exceeded on day ${forecast.projectedOverflowDay} of the month by about ${formattedOverflow}.`
          : `Au rythme actuel, votre poste ${cat.name} sera dépassé dès le ${forecast.projectedOverflowDay} du mois d'environ ${formattedOverflow}.`,
        estimatedMonthlySaving: overflowAmt,
        suggestedAction: {
          type: 'SUBSTITUTE_PRODUCT_5KM',
          label: isEn
            ? 'Enable 5km Store-Brand Substitutions'
            : 'Activer les marques distributeurs à 5 km',
          payload: { categoryId: cat.id },
        },
        isApplied: false,
        createdAt: nowISO,
      });
    }
  }

  // 2. IA-02 — Détection d'Anomalies ("Fuites de budget" vs moyenne 3-6 mois)
  for (const cat of params.categories.filter((c) => c.type === 'VARIABLE')) {
    const history = params.historicalCategorySpends[cat.id] ?? [];
    const drift = detectCategorySpendingDrift({
      categoryName: cat.name,
      currentMonthSpent: cat.spentAmount,
      historicalMonthlySpends: history,
    });

    if (drift.hasSignificantDrift) {
      const diffAmt = Math.max(0, cat.spentAmount - drift.historicalAverage);
      insights.push({
        id: `ia02_${params.yearMonth}_${cat.id}`,
        yearMonth: params.yearMonth,
        code: 'IA-02_ANOMALY',
        severity: 'WARNING',
        targetCategoryId: cat.id,
        title: isEn
          ? `Budget Leak Detected: ${cat.name} (+${drift.driftPercentage}%)`
          : `Fuite de budget détectée : ${cat.name} (+${drift.driftPercentage} %)`,
        description: isEn
          ? `Your ${cat.name} spending is +${drift.driftPercentage}% above your 3-month rolling average.`
          : `Vos dépenses ${cat.name} ont augmenté de +${drift.driftPercentage} % ce mois-ci par rapport à votre moyenne des 3 derniers mois.`,
        estimatedMonthlySaving: Math.round(diffAmt * 100) / 100,
        isApplied: false,
        createdAt: nowISO,
      });
    }
  }

  // 3. IA-03 — Audit et Optimisation des Charges Fixes (Ratio > 50%)
  const fixedAudit = auditFixedChargesRatio(
    params.monthlyBudget.totalFixedCharges,
    params.monthlyBudget.globalAllocated
  );

  if (fixedAudit.healthState !== 'HEALTHY') {
    const formattedExcess = formatCurrencyAmount(
      fixedAudit.excessAbove50Percent,
      params.currency,
      params.locale
    );
    const annualGain = Math.round(fixedAudit.excessAbove50Percent * 12 * 100) / 100;
    const formattedAnnual = formatCurrencyAmount(
      annualGain,
      params.currency,
      params.locale
    );

    insights.push({
      id: `ia03_${params.yearMonth}_fixed_ratio`,
      yearMonth: params.yearMonth,
      code: 'IA-03_FIXED_CHARGES',
      severity: fixedAudit.healthState === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
      title: isEn
        ? `Fixed Charges Ratio: ${fixedAudit.ratioPercentage}% (${fixedAudit.healthState})`
        : `Poids des Charges Fixes : ${fixedAudit.ratioPercentage} % (${
            fixedAudit.healthState === 'CRITICAL' ? 'Critique' : 'Tendu'
          })`,
      description: isEn
        ? `Your fixed charges exceed the healthy 50% benchmark by ${formattedExcess}/month. Renegotiating subscriptions could free up ${formattedAnnual}/year.`
        : `Vos charges fixes dépassent le seuil sain de 50 % de ${formattedExcess}/mois. Renégocier vos abonnements libérerait ${formattedAnnual}/an de reste à vivre.`,
      estimatedMonthlySaving: fixedAudit.excessAbove50Percent,
      estimatedAnnualSaving: annualGain,
      suggestedAction: {
        type: 'RENEGOTIATE_FIXED_CHARGE',
        label: isEn ? 'Audit Fixed Subscriptions' : 'Auditer mes abonnements fixes',
        payload: { ratioPercentage: fixedAudit.ratioPercentage },
      },
      isApplied: false,
      createdAt: nowISO,
    });
  }

  // 4. IA-05 — Prédiction de Rupture de Stock (Smart Depletion)
  for (const item of params.pantryItems) {
    const timestamps = params.pantryConsumptionHistory[item.id] ?? [];
    const depletion = computeSmartDepletionPrediction({
      item,
      consumptionTimestampsISO: timestamps,
      referenceDateISO: nowISO,
    });

    if (
      depletion.isApproachingStockout &&
      depletion.predictedStockoutDateISO &&
      depletion.daysUntilStockout !== null &&
      depletion.daysUntilStockout <= 3
    ) {
      insights.push({
        id: `ia05_${params.yearMonth}_${item.id}`,
        yearMonth: params.yearMonth,
        code: 'IA-05_SMART_DEPLETION',
        severity: 'INFO',
        targetPantryItemId: item.id,
        title: isEn
          ? `Predicted Stockout: ${item.name}`
          : `Rupture imminente prédite : ${item.name}`,
        description: isEn
          ? `Based on your consumption every ${depletion.averageConsumptionDays} days, ${item.name} will run out around ${depletion.predictedStockoutDateISO}.`
          : `Selon votre rythme moyen (1 tous les ${depletion.averageConsumptionDays} j), ${item.name} sera épuisé vers le ${depletion.predictedStockoutDateISO}.`,
        isApplied: false,
        createdAt: nowISO,
      });
    }
  }

  return insights;
}
