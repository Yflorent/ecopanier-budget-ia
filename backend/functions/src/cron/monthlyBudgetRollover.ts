import {
  BudgetCategory,
  BudgetTransaction,
  CategoryTemplate,
  MonthlyBudget,
  UserProfile,
  YearMonth,
  buildInitialMonthlyBudgetRollover,
  getCurrentYearMonth,
  shiftYearMonth,
} from '@depense/shared';

export interface MonthlyRolloverPersistencePort {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  listActiveUsers(): Promise<UserProfile[]>;
  getMonthlyBudget(userId: string, yearMonth: YearMonth): Promise<MonthlyBudget | null>;
  listCategoryTemplates(userId: string): Promise<CategoryTemplate[]>;
  executeRolloverBatch(params: {
    userId: string;
    previousMonthToClose?: YearMonth;
    newMonthlyBudget: MonthlyBudget;
    categories: BudgetCategory[];
    autoTransactions: BudgetTransaction[];
  }): Promise<void>;
}

/**
 * US 1.3 — Création automatique d'une nouvelle page de budget chaque 1er du mois à 00h01
 * (Exécuté par le Cron Mensuel ET par la vérification Lazy Init à l'ouverture de l'app).
 *
 * 1. Clôture le mois M-1 (`status: 'CLOSED'`) s'il était encore `'OPEN'`.
 * 2. Crée le document maître `users/{userId}/monthlyBudgets/{YYYY-MM}`.
 * 3. Clone tous les modèles récurrents (`isRecurring == true`) avec `spentAmount = 0`.
 * 4. Génère immédiatement les transactions de charges fixes (`autoDebitOnFirstDay == true`) datées du 1er du mois.
 */
export async function ensureUserMonthlyBudgetRollover(
  port: MonthlyRolloverPersistencePort,
  userId: string,
  targetYearMonth: YearMonth = getCurrentYearMonth()
): Promise<{
  created: boolean;
  monthlyBudget: MonthlyBudget;
  categoriesCount: number;
  autoTransactionsCount: number;
}> {
  const existingBudget = await port.getMonthlyBudget(userId, targetYearMonth);
  if (existingBudget) {
    return {
      created: false,
      monthlyBudget: existingBudget,
      categoriesCount: 0,
      autoTransactionsCount: 0,
    };
  }

  const userProfile = await port.getUserProfile(userId);
  if (!userProfile) {
    throw new Error(`Profil utilisateur introuvable pour l'initialisation mensuelle : ${userId}`);
  }

  const previousYearMonth = shiftYearMonth(targetYearMonth, -1);
  const previousBudget = await port.getMonthlyBudget(userId, previousYearMonth);
  const previousMonthToClose =
    previousBudget && previousBudget.status === 'OPEN' ? previousYearMonth : undefined;

  let templates = await port.listCategoryTemplates(userId);
  if (!templates || templates.length === 0) {
    const nowISO = new Date().toISOString();
    templates = [
      { id: 'cat_loyer', name: 'Loyer & Charges', icon: '🏠', colorHex: '#4F46E5', defaultLimit: 750, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_energie', name: 'Électricité & Fibre', icon: '⚡', colorHex: '#F59E0B', defaultLimit: 140, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_abonnements', name: 'Abonnements & Cloud', icon: '📱', colorHex: '#06B6D4', defaultLimit: 95, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_assurances', name: 'Assurances & Mutuelle', icon: '🛡️', colorHex: '#10B981', defaultLimit: 80, type: 'CHARGE_FIXE', isRecurring: true, autoDebitOnFirstDay: true, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_alimentation', name: 'Alimentation & Réserve', icon: '🛒', colorHex: '#059669', defaultLimit: 450, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_transport', name: 'Transport & Carburant', icon: '🚗', colorHex: '#3B82F6', defaultLimit: 120, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_loisirs', name: 'Loisirs & Sorties', icon: '☕', colorHex: '#EC4899', defaultLimit: 150, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
      { id: 'cat_sante', name: 'Santé & Hygiène', icon: '💊', colorHex: '#8B5CF6', defaultLimit: 60, type: 'VARIABLE', isRecurring: true, autoDebitOnFirstDay: false, createdAt: nowISO, updatedAt: nowISO },
    ];
  }
  const rollover = buildInitialMonthlyBudgetRollover({
    yearMonth: targetYearMonth,
    defaultMonthlyIncome: userProfile.defaultMonthlyIncome,
    templates,
  });

  await port.executeRolloverBatch({
    userId,
    previousMonthToClose,
    newMonthlyBudget: rollover.monthlyBudget,
    categories: rollover.categories,
    autoTransactions: rollover.autoTransactions,
  });

  return {
    created: true,
    monthlyBudget: rollover.monthlyBudget,
    categoriesCount: rollover.categories.length,
    autoTransactionsCount: rollover.autoTransactions.length,
  };
}

/**
 * Handler du Cron Mensuel planifié (1er de chaque mois à 00h01 : `1 0 1 * *`)
 */
export async function runMonthlyCronForAllUsers(
  port: MonthlyRolloverPersistencePort,
  targetYearMonth: YearMonth = getCurrentYearMonth()
): Promise<{ processedUsers: number; newlyCreatedBudgets: number }> {
  const users = await port.listActiveUsers();
  let newlyCreatedBudgets = 0;
  const batchSize = 20;

  for (let i = 0; i < users.length; i += batchSize) {
    const chunk = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((user) => ensureUserMonthlyBudgetRollover(port, user.uid, targetYearMonth))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.created) {
        newlyCreatedBudgets++;
      }
    }
  }

  return {
    processedUsers: users.length,
    newlyCreatedBudgets,
  };
}
