/**
 * Modèles de Données Partagés — Cloud Firestore & Vertex AI Gemini
 * Conforme au PRD v3.1 (Section 3.2 & Section 4)
 */

export type SupportedLocale = 'fr' | 'en' | 'es';
export type SupportedCurrency = 'EUR' | 'XAF' | 'USD' | 'CAD';
export type YearMonth = `${number}-${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12'}`;

export type CategoryType = 'VARIABLE' | 'CHARGE_FIXE';
export type MonthlyBudgetStatus = 'OPEN' | 'CLOSED';
export type BudgetGaugeState = 'HEALTHY' | 'WARNING' | 'CRITICAL';
export type FixedChargesHealthState = 'HEALTHY' | 'TIGHT' | 'CRITICAL';

export type PantryUnit = 'unit' | 'kg' | 'g' | 'L' | 'mL' | 'pack';
export type PantryMovementType = 'CONSUMPTION' | 'RESTOCK';
export type AcquisitionSource =
  | 'MANUAL'
  | 'BARCODE'
  | 'PHOTO_OCR'
  | 'PDF_INVOICE'
  | 'COMPARATOR_5KM';

export type AIInsightCode =
  | 'IA-01_FORECAST'
  | 'IA-02_ANOMALY'
  | 'IA-03_FIXED_CHARGES'
  | 'IA-04_HYBRID_SAVINGS'
  | 'IA-05_SMART_DEPLETION';

/**
 * 1. Profil Utilisateur : `users/{userId}` (US 0.1, US 0.3, US 0.4, US 3.1)
 */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  locale: SupportedLocale;
  currency: SupportedCurrency;
  defaultMonthlyIncome: number;
  dailyNotificationTime: string; // Format "HH:mm", ex: "17:30"
  fcmTokens?: string[];
  location?: {
    lat: number;
    lng: number;
    geohash: string;
    addressLabel?: string;
    searchRadiusKm: number; // 5.0 par défaut
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 2. Modèle Permanent de Poste Budgétaire : `users/{userId}/categoryTemplates/{templateId}` (US 1.2, US 1.6)
 */
export interface CategoryTemplate {
  id: string;
  name: string;
  icon: string;
  colorHex: string;
  defaultLimit: number;
  type: CategoryType;
  isRecurring: boolean;
  autoDebitOnFirstDay: boolean;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 3. Document Maître Mensuel : `users/{userId}/monthlyBudgets/{yearMonth}` (US 1.3, US 1.4)
 */
export interface MonthlyBudget {
  yearMonth: YearMonth; // ex: "2026-11"
  status: MonthlyBudgetStatus; // OPEN | CLOSED
  globalAllocated: number;
  totalFixedCharges: number;
  totalVariableSpent: number;
  totalSavedViaComparator: number;
  realDisposableIncome: number; // Reste à vivre réel
  projectedEndOfMonthBalance?: number; // IA-01
  createdAt: string;
  closedAt?: string;
  updatedAt: string;
}

/**
 * 3a. Enveloppe Budgétaire d'un Mois : `users/{userId}/monthlyBudgets/{yearMonth}/categories/{categoryId}`
 */
export interface BudgetCategory {
  id: string;
  templateId?: string;
  yearMonth: YearMonth;
  name: string;
  icon: string;
  colorHex: string;
  type: CategoryType;
  allocatedLimit: number;
  spentAmount: number;
  consumptionPercentage: number;
  gaugeState: BudgetGaugeState; // HEALTHY (<75%), WARNING (75-99%), CRITICAL (>=100%)
  autoDebited?: boolean;
  projectedOverflowDate?: string; // IA-01
  projectedOverflowAmount?: number; // IA-01
}

/**
 * 3b. Transaction / Dépense / Facture PDF : `users/{userId}/monthlyBudgets/{yearMonth}/transactions/{transactionId}`
 */
export interface BudgetTransaction {
  id: string;
  yearMonth: YearMonth;
  categoryId: string;
  categoryName: string;
  amount: number;
  type: CategoryType;
  date: string; // ISO 8601
  label: string;
  note?: string;
  source: AcquisitionSource | 'AUTO_FIXED_CHARGE';
  storeId?: string;
  storeName?: string;
  invoiceFileUrl?: string; // Lien Firebase Storage vers le PDF ou la photo du ticket
  invoiceFingerprint?: string; // Empreinte SHA-256 anti-doublon (US 4.3)
  savedAmountViaComparator?: number;
  createdAt: string;
}

/**
 * 3c. Recommandation & Analyse du Coach Financier IA : `users/{userId}/monthlyBudgets/{yearMonth}/aiInsights/{insightId}`
 */
export interface AIInsight {
  id: string;
  yearMonth: YearMonth;
  code: AIInsightCode;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'OPPORTUNITY';
  title: string;
  description: string;
  estimatedMonthlySaving?: number;
  estimatedAnnualSaving?: number;
  targetCategoryId?: string;
  targetPantryItemId?: string;
  suggestedAction?: {
    type: 'ADJUST_CATEGORY_LIMIT' | 'SUBSTITUTE_PRODUCT_5KM' | 'BULK_BUY_OPPORTUNITY' | 'RENEGOTIATE_FIXED_CHARGE';
    label: string;
    payload: Record<string, unknown>;
  };
  isApplied: boolean;
  createdAt: string;
}

/**
 * 4. Article de la Réserve Domestique : `users/{userId}/pantryItems/{itemId}` (US 2.1, US 2.2, US 2.3)
 */
export interface PantryItem {
  id: string;
  name: string;
  normalizedProductKey: string; // IA-07 clé sémantique normalisée (ex: "huile_tournesol_1l")
  eanBarcode?: string;
  category: 'ALIMENTAIRE' | 'ENTRETIEN_HYGIENE' | 'BOISSONS' | 'BEBE_ANIMAUX' | 'AUTRE';
  budgetCategoryId?: string;
  currentQuantity: number;
  unit: PantryUnit;
  alertThreshold: number; // 1 par défaut
  needsRestock: boolean; // true dès que currentQuantity <= alertThreshold
  averageConsumptionDays?: number; // IA-05 Smart Depletion
  predictedStockoutDate?: string; // IA-05 Date théorique de rupture
  expirationDate?: string | null; // Date de péremption DLC / DLUO (YYYY-MM-DD)
  lastPricePaid?: number;
  lastUpdatedAt: string;
}

/**
 * 5. Mouvement Horodaté de Réserve : `users/{userId}/pantryMovements/{movementId}` (US 2.2, US 5.2)
 */
export interface PantryMovement {
  id: string;
  itemId: string;
  itemName: string;
  yearMonth: YearMonth; // Liaison stricte au mois
  timestamp: string; // ISO 8601
  type: PantryMovementType; // CONSUMPTION (-1) | RESTOCK (+N)
  source: AcquisitionSource;
  quantityDelta: number; // ex: -1 ou +4
  quantityAfter: number;
  unitPricePaid?: number;
  savedAmount?: number;
  storeId?: string;
  storeName?: string;
  transactionId?: string;
}

/**
 * 6. Magasin Local (Indexé par Geohash) : `stores/{storeId}` (US 3.1)
 */
export interface LocalStore {
  id: string;
  name: string; // ex: "E.Leclerc Drive & Hypermarché"
  brand: 'LECLERC' | 'CARREFOUR' | 'LIDL' | 'AUCHAN' | 'INTERMARCHE' | 'SUPER_U' | 'OTHER';
  address: string;
  lat: number;
  lng: number;
  geohash: string;
  updatedAt: string;
}

/**
 * 7. Relevé de Prix Géolocalisé : `storePrices/{priceId}` (US 3.2, US 4.3, IA-07)
 */
export interface StorePriceRecord {
  id: string;
  storeId: string;
  storeName: string;
  geohash: string;
  lat: number;
  lng: number;
  eanBarcode?: string;
  normalizedProductKey: string; // IA-07 matching sémantique inter-enseignes
  rawProductLabel: string;
  unitPrice: number;
  promoPrice?: number;
  unit: PantryUnit;
  isStoreBrandAlternative?: boolean; // Marque distributeur pour IA-04
  observedAt: string;
  source: AcquisitionSource;
}

/**
 * 8. Résultat du Comparateur Quotidien 5 km (US 3.2, US 3.3, IA-04)
 */
export interface ProductPriceComparison {
  pantryItemId: string;
  productName: string;
  normalizedProductKey: string;
  eanBarcode?: string;
  quantityToBuy: number;
  bestOffer: {
    storeId: string;
    storeName: string;
    distanceKm: number;
    unitPrice: number;
    totalPrice: number;
    savingVsAverage: number;
  };
  aiEconomyAlternative?: {
    label: string;
    storeId: string;
    storeName: string;
    unitPrice: number;
    immediateSaving: number;
  };
}

export interface DailyBasketComparisonResult {
  generatedAt: string;
  yearMonth: YearMonth;
  radiusKm: number;
  itemsCount: number;
  /** Vue 1 : Meilleur prix article par article (multi-magasins) */
  bestPerItemView: {
    totalCost: number;
    totalSavingsVsAverage: number;
    items: ProductPriceComparison[];
  };
  /** Vue 2 : Meilleur magasin unique pour tout le panier (1 seul déplacement dans les 5 km) */
  bestSingleStoreView: {
    storeId: string;
    storeName: string;
    distanceKm: number;
    totalBasketCost: number;
    totalSavingsVsAverage: number;
    coverageCount: number;
    items: Array<{
      pantryItemId: string;
      productName: string;
      unitPrice: number;
      quantity: number;
      subtotal: number;
    }>;
  } | null;
}

/**
 * 9. Résultat d'Extraction Multimodale Facture PDF / Ticket via Gemini 2.5 Flash (US 4.2, US 4.3, IA-06)
 */
export interface ExtractedInvoiceLineItem {
  rawLabel: string;
  normalizedLabel: string;
  normalizedProductKey: string;
  eanBarcode?: string;
  quantity: number;
  unit: PantryUnit;
  unitPrice: number;
  discountAmount: number;
  lineTotalTTC: number;
  categoryType: 'ALIMENTAIRE' | 'ENTRETIEN_HYGIENE' | 'LOISIRS' | 'AUTRE';
  addToPantry: boolean;
}

export interface ExtractedInvoicePayload {
  storeName: string;
  storeAddress?: string;
  purchaseDateISO: string; // YYYY-MM-DD
  targetYearMonth: YearMonth; // YYYY-MM déduit automatiquement de la date de facture
  invoiceNumber?: string;
  totalAmountTTC: number;
  totalLoyaltyDiscounts: number;
  currency: SupportedCurrency;
  invoiceFingerprint: string; // Empreinte anti-doublon
  isDuplicate: boolean;
  lineItems: ExtractedInvoiceLineItem[];
  suggestedBudgetSplits: Array<{
    budgetCategoryName: string;
    amount: number;
  }>;
}
