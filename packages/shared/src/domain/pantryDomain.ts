import {
  AcquisitionSource,
  PantryItem,
  PantryMovement,
  YearMonth,
} from '../models';

/**
 * IA-07 — Normalisation sémantique d'un libellé produit inter-enseignes
 * Ex: "HUILE TOURN. 100CL" et "Huile de Tournesol 1L" -> "huile_tournesol_1l"
 */
export function normalizeSemanticProductKey(rawLabel: string): string {
  const stopWords = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'au', 'aux', 'et', 'en']);
  let cleaned = rawLabel
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
    .replace(/\b100\s*cl\b/g, '1l')
    .replace(/\b1000\s*ml\b/g, '1l')
    .replace(/\b1000\s*g\b/g, '1kg')
    .replace(/\btourn\b\.?/g, 'tournesol')
    .replace(/[^a-z0-9\s]/g, ' ');

  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0 && !stopWords.has(t));

  return tokens.join('_');
}

/**
 * US 2.2 & US 2.3 — Décrémentation rapide ("1-Tap Use" : -1) ou réapprovisionnement (+N)
 * Garantit que la quantité ne descend jamais sous 0, active `needsRestock` dès que
 * `currentQuantity <= alertThreshold` (1 par défaut) et génère le mouvement horodaté rattaché à `yearMonth`.
 */
export function applyPantryQuantityDelta(params: {
  item: PantryItem;
  delta: number; // ex: -1 pour 1-Tap Use, +2 pour réapprovisionnement
  yearMonth: YearMonth;
  source: AcquisitionSource;
  nowISO?: string;
  unitPricePaid?: number;
  savedAmount?: number;
  storeId?: string;
  storeName?: string;
  transactionId?: string;
}): {
  updatedItem: PantryItem;
  movement: PantryMovement;
  triggeredLowStockAlert: boolean;
} {
  const nowISO = params.nowISO ?? new Date().toISOString();
  const previousQty = params.item.currentQuantity;
  const newQuantity = Math.max(0, previousQty + params.delta);
  const actualDelta = newQuantity - previousQty;

  const threshold = params.item.alertThreshold ?? 1;
  const wasAlreadyLow = previousQty <= threshold;
  const needsRestock = newQuantity <= threshold;

  // Déclenche l'alerte immédiate US 2.3 lorsque le produit passe à Quantité <= 1 (ou 0)
  const triggeredLowStockAlert = params.delta < 0 && needsRestock && !wasAlreadyLow;

  const updatedItem: PantryItem = {
    ...params.item,
    currentQuantity: newQuantity,
    needsRestock,
    lastPricePaid: params.unitPricePaid ?? params.item.lastPricePaid,
    lastUpdatedAt: nowISO,
  };

  const movement: PantryMovement = {
    id: `mov_${Date.now()}_${params.item.id}`,
    itemId: params.item.id,
    itemName: params.item.name,
    yearMonth: params.yearMonth,
    timestamp: nowISO,
    type: actualDelta < 0 ? 'CONSUMPTION' : 'RESTOCK',
    source: params.source,
    quantityDelta: actualDelta,
    quantityAfter: newQuantity,
    unitPricePaid: params.unitPricePaid,
    savedAmount: params.savedAmount,
    storeId: params.storeId,
    storeName: params.storeName,
    transactionId: params.transactionId,
  };

  return {
    updatedItem,
    movement,
    triggeredLowStockAlert,
  };
}

/**
 * IA-05 — Prédiction de Rupture de Stock (Smart Depletion - US 6.4)
 * Analyse l'écart temporel entre les mouvements de consommation (`-1`) pour calculer
 * `averageConsumptionDays` et prédire la date théorique de rupture.
 */
export function computeSmartDepletionPrediction(params: {
  item: PantryItem;
  consumptionTimestampsISO: string[]; // Horodatages des clics -1 triés par ordre chronologique
  referenceDateISO?: string;
}): {
  averageConsumptionDays: number | null;
  predictedStockoutDateISO: string | null;
  daysUntilStockout: number | null;
  isApproachingStockout: boolean;
} {
  const sortedDates = params.consumptionTimestampsISO
    .map((ts) => new Date(ts).getTime())
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b);

  if (sortedDates.length < 2) {
    return {
      averageConsumptionDays: params.item.averageConsumptionDays ?? null,
      predictedStockoutDateISO: null,
      daysUntilStockout: null,
      isApproachingStockout: params.item.currentQuantity <= params.item.alertThreshold,
    };
  }

  const intervalsInDays: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const diffMs = sortedDates[i] - sortedDates[i - 1];
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 0) {
      intervalsInDays.push(diffDays);
    }
  }

  if (intervalsInDays.length === 0) {
    return {
      averageConsumptionDays: null,
      predictedStockoutDateISO: null,
      daysUntilStockout: null,
      isApproachingStockout: params.item.currentQuantity <= params.item.alertThreshold,
    };
  }

  const avgDays =
    Math.round(
      (intervalsInDays.reduce((acc, v) => acc + v, 0) / intervalsInDays.length) * 100
    ) / 100;

  const lastConsumptionMs = sortedDates[sortedDates.length - 1];
  const remainingUnits = Math.max(0, params.item.currentQuantity);
  const predictedStockoutMs =
    lastConsumptionMs + remainingUnits * avgDays * 24 * 60 * 60 * 1000;

  const refMs = params.referenceDateISO
    ? new Date(params.referenceDateISO).getTime()
    : Date.now();
  const daysUntilStockout =
    Math.round(((predictedStockoutMs - refMs) / (1000 * 60 * 60 * 24)) * 10) / 10;

  const predictedStockoutDateISO = new Date(predictedStockoutMs).toISOString().slice(0, 10);

  return {
    averageConsumptionDays: avgDays,
    predictedStockoutDateISO,
    daysUntilStockout,
    isApproachingStockout: daysUntilStockout <= 3 || remainingUnits <= params.item.alertThreshold,
  };
}
