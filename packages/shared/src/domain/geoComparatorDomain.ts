import {
  DailyBasketComparisonResult,
  LocalStore,
  PantryItem,
  ProductPriceComparison,
  StorePriceRecord,
  YearMonth,
} from '../models';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode une coordonnée GPS (`lat`, `lng`) en Geohash (précision 7 par défaut ~150m)
 * Utilisé pour l'indexation spatiale Firestore des magasins dans les 5 km (US 3.1).
 */
export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const lngMid = (lngMin + lngMax) / 2;
      if (lng >= lngMid) {
        idx = idx * 2 + 1;
        lngMin = lngMid;
      } else {
        idx = idx * 2;
        lngMax = lngMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;

    if (++bit === 5) {
      geohash += BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

/**
 * Calcule la distance orthodromique (formule de Haversine) en kilomètres entre deux points GPS (US 3.1).
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Rayon moyen de la Terre en km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Filtre les magasins situés strictement dans le rayon `maxRadiusKm` (5.0 km par défaut — US 3.1).
 */
export function filterStoresWithinRadiusKm(
  userLat: number,
  userLng: number,
  stores: LocalStore[],
  maxRadiusKm = 5.0
): Array<LocalStore & { distanceKm: number }> {
  return stores
    .map((store) => ({
      ...store,
      distanceKm: calculateHaversineDistanceKm(userLat, userLng, store.lat, store.lng),
    }))
    .filter((s) => s.distanceKm <= maxRadiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * US 3.2 & US 3.3 — Moteur du Comparateur Quotidien dans un rayon de 5 km
 * Génère la double vue :
 * 1. "Meilleur prix par article" (optimisation maximale article par article)
 * 2. "Meilleur magasin unique pour tout le panier" (optimisation en un seul trajet <= 5 km)
 * Et intègre les alternatives économiques IA-04 (marques distributeurs) si le budget est sous tension.
 */
export function computeDaily5kmBasketComparison(params: {
  yearMonth: YearMonth;
  userLat: number;
  userLng: number;
  maxRadiusKm?: number;
  lowStockItems: PantryItem[]; // Articles avec currentQuantity <= 1
  stores: LocalStore[];
  storePrices: StorePriceRecord[];
  isBudgetTight?: boolean; // Si vrai, active les substitutions IA-04
  nowISO?: string;
}): DailyBasketComparisonResult {
  const radiusKm = params.maxRadiusKm ?? 5.0;
  const nowISO = params.nowISO ?? new Date().toISOString();

  const nearbyStores = filterStoresWithinRadiusKm(
    params.userLat,
    params.userLng,
    params.stores,
    radiusKm
  );
  const nearbyStoreMap = new Map(nearbyStores.map((s) => [s.id, s]));

  // Ne conserve que les prix relevés dans les magasins situés à <= 5.0 km
  const validPrices = params.storePrices.filter((p) => nearbyStoreMap.has(p.storeId));

  const perItemComparisons: ProductPriceComparison[] = [];
  let totalBestPerItemCost = 0;
  let totalBestPerItemSavings = 0;

  for (const item of params.lowStockItems) {
    const qtyToBuy = Math.max(1, (item.alertThreshold ?? 1) + 1 - item.currentQuantity);

    const matchingPrices = validPrices.filter((p) => {
      if (item.eanBarcode && p.eanBarcode && item.eanBarcode === p.eanBarcode) {
        return !p.isStoreBrandAlternative;
      }
      return (
        p.normalizedProductKey === item.normalizedProductKey && !p.isStoreBrandAlternative
      );
    });

    if (matchingPrices.length === 0) {
      continue;
    }

    const effectiveUnitPrice = (p: StorePriceRecord) => p.promoPrice ?? p.unitPrice;
    const avgUnitPrice =
      matchingPrices.reduce((acc, p) => acc + effectiveUnitPrice(p), 0) /
      matchingPrices.length;

    const sortedOffers = [...matchingPrices].sort(
      (a, b) => effectiveUnitPrice(a) - effectiveUnitPrice(b)
    );
    const best = sortedOffers[0];
    const bestStore = nearbyStoreMap.get(best.storeId)!;
    const bestUnit = effectiveUnitPrice(best);
    const lineTotal = Math.round(bestUnit * qtyToBuy * 100) / 100;
    const lineSaving = Math.max(
      0,
      Math.round((avgUnitPrice - bestUnit) * qtyToBuy * 100) / 100
    );

    totalBestPerItemCost = Math.round((totalBestPerItemCost + lineTotal) * 100) / 100;
    totalBestPerItemSavings =
      Math.round((totalBestPerItemSavings + lineSaving) * 100) / 100;

    // Recherche d'une substitution économique IA-04 (marque distributeur)
    let aiEconomyAlternative: ProductPriceComparison['aiEconomyAlternative'];
    if (params.isBudgetTight) {
      const storeBrandAlternatives = validPrices
        .filter(
          (p) =>
            p.normalizedProductKey === item.normalizedProductKey &&
            p.isStoreBrandAlternative &&
            effectiveUnitPrice(p) < bestUnit
        )
        .sort((a, b) => effectiveUnitPrice(a) - effectiveUnitPrice(b));

      if (storeBrandAlternatives.length > 0) {
        const alt = storeBrandAlternatives[0];
        const altUnit = effectiveUnitPrice(alt);
        aiEconomyAlternative = {
          label: alt.rawProductLabel,
          storeId: alt.storeId,
          storeName: alt.storeName,
          unitPrice: altUnit,
          immediateSaving: Math.round((bestUnit - altUnit) * qtyToBuy * 100) / 100,
        };
      }
    }

    perItemComparisons.push({
      pantryItemId: item.id,
      productName: item.name,
      normalizedProductKey: item.normalizedProductKey,
      eanBarcode: item.eanBarcode,
      quantityToBuy: qtyToBuy,
      bestOffer: {
        storeId: best.storeId,
        storeName: bestStore.name,
        distanceKm: bestStore.distanceKm,
        unitPrice: bestUnit,
        totalPrice: lineTotal,
        savingVsAverage: lineSaving,
      },
      aiEconomyAlternative,
    });
  }

  // Vue 2 : Évaluation du meilleur magasin unique pour tout le panier dans les 5 km
  let bestSingleStoreView: DailyBasketComparisonResult['bestSingleStoreView'] = null;

  for (const store of nearbyStores) {
    const storeBasketItems: NonNullable<
      DailyBasketComparisonResult['bestSingleStoreView']
    >['items'] = [];
    let basketTotal = 0;
    let basketAverageTotal = 0;

    for (const item of params.lowStockItems) {
      const qtyToBuy = Math.max(1, (item.alertThreshold ?? 1) + 1 - item.currentQuantity);
      const allOffersForItem = validPrices.filter(
        (p) =>
          (item.eanBarcode && p.eanBarcode === item.eanBarcode) ||
          p.normalizedProductKey === item.normalizedProductKey
      );
      if (allOffersForItem.length === 0) continue;

      const avgPrice =
        allOffersForItem.reduce((acc, p) => acc + (p.promoPrice ?? p.unitPrice), 0) /
        allOffersForItem.length;

      const storeOffers = allOffersForItem
        .filter((p) => p.storeId === store.id)
        .sort((a, b) => (a.promoPrice ?? a.unitPrice) - (b.promoPrice ?? b.unitPrice));

      if (storeOffers.length > 0) {
        const chosen = storeOffers[0];
        const unitPrice = chosen.promoPrice ?? chosen.unitPrice;
        const subtotal = Math.round(unitPrice * qtyToBuy * 100) / 100;
        basketTotal = Math.round((basketTotal + subtotal) * 100) / 100;
        basketAverageTotal =
          Math.round((basketAverageTotal + avgPrice * qtyToBuy) * 100) / 100;
        storeBasketItems.push({
          pantryItemId: item.id,
          productName: item.name,
          unitPrice,
          quantity: qtyToBuy,
          subtotal,
        });
      }
    }

    if (storeBasketItems.length === 0) continue;

    const candidate = {
      storeId: store.id,
      storeName: store.name,
      distanceKm: store.distanceKm,
      totalBasketCost: basketTotal,
      totalSavingsVsAverage: Math.max(
        0,
        Math.round((basketAverageTotal - basketTotal) * 100) / 100
      ),
      coverageCount: storeBasketItems.length,
      items: storeBasketItems,
    };

    if (
      !bestSingleStoreView ||
      candidate.coverageCount > bestSingleStoreView.coverageCount ||
      (candidate.coverageCount === bestSingleStoreView.coverageCount &&
        candidate.totalBasketCost < bestSingleStoreView.totalBasketCost)
    ) {
      bestSingleStoreView = candidate;
    }
  }

  return {
    generatedAt: nowISO,
    yearMonth: params.yearMonth,
    radiusKm,
    itemsCount: perItemComparisons.length,
    bestPerItemView: {
      totalCost: totalBestPerItemCost,
      totalSavingsVsAverage: totalBestPerItemSavings,
      items: perItemComparisons,
    },
    bestSingleStoreView,
  };
}
