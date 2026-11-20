import {
  BudgetCategory,
  DailyBasketComparisonResult,
  LocalStore,
  PantryItem,
  StorePriceRecord,
  UserProfile,
  YearMonth,
  computeDaily5kmBasketComparison,
  getCurrentYearMonth,
} from '@depense/shared';
import {
  PushNotificationPayload,
  buildDaily5kmComparatorNotification,
} from '../services/notificationService';

export interface DailyComparatorPort {
  listUsersWithLocation(): Promise<UserProfile[]>;
  getLowStockPantryItems(userId: string): Promise<PantryItem[]>;
  getActiveMonthCategories(userId: string, yearMonth: YearMonth): Promise<BudgetCategory[]>;
  getStoresNearGeohash(lat: number, lng: number, radiusKm: number): Promise<LocalStore[]>;
  getStorePricesForStores(storeIds: string[]): Promise<StorePriceRecord[]>;
  saveDailyComparisonResult(userId: string, result: DailyBasketComparisonResult): Promise<void>;
  sendPushNotification(payload: PushNotificationPayload): Promise<void>;
}

/**
 * US 3.2, US 3.3 & IA-04 — Exécute le comparateur quotidien dans un rayon de 5 km pour un utilisateur donné
 * 1. Sélectionne tous les articles en réserve où `currentQuantity <= 1` (`needsRestock == true`).
 * 2. Filtre les magasins situés à `<= 5.0 km` (Haversine + Geohash).
 * 3. Vérifie si le poste Alimentation du mois actif est sous tension (`WARNING` ou `CRITICAL`) pour activer les substitutions IA-04.
 * 4. Calcule les deux vues : "Meilleur prix par article" vs "Meilleur magasin unique pour tout le panier".
 * 5. Envoie la notification push FCM multilingue.
 */
export async function runUserDaily5kmPriceComparison(
  port: DailyComparatorPort,
  user: UserProfile,
  yearMonth: YearMonth = getCurrentYearMonth()
): Promise<DailyBasketComparisonResult | null> {
  if (!user.location) {
    return null;
  }

  const lowStockItems = (await port.getLowStockPantryItems(user.uid)).filter(
    (item) => item.currentQuantity <= (item.alertThreshold ?? 1)
  );

  if (lowStockItems.length === 0) {
    return null;
  }

  const radiusKm = user.location.searchRadiusKm ?? 5.0;
  const stores = await port.getStoresNearGeohash(
    user.location.lat,
    user.location.lng,
    radiusKm
  );

  const storeIds = stores.map((s) => s.id);
  const storePrices = storeIds.length > 0 ? await port.getStorePricesForStores(storeIds) : [];

  const categories = await port.getActiveMonthCategories(user.uid, yearMonth);
  const isBudgetTight = categories.some(
    (c) => c.gaugeState === 'WARNING' || c.gaugeState === 'CRITICAL'
  );

  const comparison = computeDaily5kmBasketComparison({
    yearMonth,
    userLat: user.location.lat,
    userLng: user.location.lng,
    maxRadiusKm: radiusKm,
    lowStockItems,
    stores,
    storePrices,
    isBudgetTight,
  });

  await port.saveDailyComparisonResult(user.uid, comparison);

  if (user.fcmTokens && user.fcmTokens.length > 0) {
    const notification = buildDaily5kmComparatorNotification({
      userId: user.uid,
      fcmTokens: user.fcmTokens,
      locale: user.locale,
      currency: user.currency,
      comparison,
    });
    if (notification) {
      await port.sendPushNotification(notification);
    }
  }

  return comparison;
}

/**
 * Handler du Cron Quotidien de 17h30 (`30 17 * * *` — US 3.2)
 */
export async function runDaily1730ComparatorBatch(
  port: DailyComparatorPort,
  yearMonth: YearMonth = getCurrentYearMonth()
): Promise<{ scannedUsers: number; notificationsSent: number }> {
  const users = await port.listUsersWithLocation();
  let notificationsSent = 0;
  const batchSize = 20;

  for (let i = 0; i < users.length; i += batchSize) {
    const chunk = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((user) => runUserDaily5kmPriceComparison(port, user, yearMonth))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.itemsCount > 0) {
        notificationsSent++;
      }
    }
  }

  return {
    scannedUsers: users.length,
    notificationsSent,
  };
}
