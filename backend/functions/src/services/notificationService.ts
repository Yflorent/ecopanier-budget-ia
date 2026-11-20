import {
  DailyBasketComparisonResult,
  PantryItem,
  SupportedCurrency,
  SupportedLocale,
  formatCurrencyAmount,
} from '@depense/shared';

export interface PushNotificationPayload {
  userId: string;
  fcmTokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}

/**
 * Construit la notification push immédiate lorsqu'un article passe à Quantité <= 1 (US 2.3, US 0.4)
 */
export function buildLowStockImmediateNotification(params: {
  userId: string;
  fcmTokens: string[];
  locale: SupportedLocale;
  item: PantryItem;
}): PushNotificationPayload {
  const isEn = params.locale === 'en';
  const title = isEn
    ? '⚠️ Low Pantry Stock Alert'
    : '⚠️ Alerte Réserve Domestique';
  const body = isEn
    ? `Warning, you only have ${params.item.currentQuantity} ${params.item.name} left in your pantry.`
    : `Attention, il ne vous reste plus que ${params.item.currentQuantity} ${params.item.name} en réserve.`;

  return {
    userId: params.userId,
    fcmTokens: params.fcmTokens,
    title,
    body,
    data: {
      type: 'LOW_STOCK_ALERT',
      targetScreen: 'STITCH-06',
      pantryItemId: params.item.id,
    },
  };
}

/**
 * Construit la notification push quotidienne de 17h30 recommandant le magasin le moins cher à <= 5 km (US 3.3, US 0.4)
 */
export function buildDaily5kmComparatorNotification(params: {
  userId: string;
  fcmTokens: string[];
  locale: SupportedLocale;
  currency: SupportedCurrency;
  comparison: DailyBasketComparisonResult;
}): PushNotificationPayload | null {
  if (params.comparison.itemsCount === 0 || !params.comparison.bestSingleStoreView) {
    return null;
  }

  const bestStore = params.comparison.bestSingleStoreView;
  const formattedTotal = formatCurrencyAmount(
    bestStore.totalBasketCost,
    params.currency,
    params.locale
  );
  const formattedSaving = formatCurrencyAmount(
    bestStore.totalSavingsVsAverage,
    params.currency,
    params.locale
  );

  const isEn = params.locale === 'en';
  const title = isEn
    ? `🛒 Best 5km Basket: ${bestStore.storeName} (${bestStore.distanceKm} km)`
    : `🛒 Meilleur panier 5 km : ${bestStore.storeName} (${bestStore.distanceKm} km)`;

  const body = isEn
    ? `${params.comparison.itemsCount} restock item(s) for ${formattedTotal} (Save ${formattedSaving} today).`
    : `${params.comparison.itemsCount} produit(s) à réapprovisionner pour ${formattedTotal} (Économie : ${formattedSaving}).`;

  return {
    userId: params.userId,
    fcmTokens: params.fcmTokens,
    title,
    body,
    data: {
      type: 'DAILY_5KM_COMPARATOR',
      targetScreen: 'STITCH-07',
      yearMonth: params.comparison.yearMonth,
      storeId: bestStore.storeId,
    },
  };
}
