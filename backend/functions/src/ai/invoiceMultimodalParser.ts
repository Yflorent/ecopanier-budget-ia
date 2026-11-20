import {
  AcquisitionSource,
  BudgetTransaction,
  ExtractedInvoiceLineItem,
  ExtractedInvoicePayload,
  PantryItem,
  PantryMovement,
  StorePriceRecord,
  SupportedCurrency,
  SupportedLocale,
  YearMonth,
  applyPantryQuantityDelta,
  computeInvoiceFingerprint,
  computeSuggestedBudgetSplits,
  extractYearMonthFromDate,
  normalizeSemanticProductKey,
} from '@depense/shared';

export interface GeminiMultimodalModelPort {
  /**
   * Interroge Vertex AI Gemini (`gemini-2.5-flash`) avec un fichier `application/pdf` ou `image/*`
   * et retourne le JSON structuré conforme au schéma d'extraction de facture.
   */
  extractInvoiceFromDocument(params: {
    fileStorageUri: string;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
    locale: SupportedLocale;
    defaultCurrency: SupportedCurrency;
  }): Promise<{
    storeName: string;
    storeAddress?: string;
    purchaseDateISO: string;
    invoiceNumber?: string;
    totalAmountTTC: number;
    totalLoyaltyDiscounts: number;
    currency: SupportedCurrency;
    rawItems: Array<{
      rawLabel: string;
      normalizedLabel: string;
      eanBarcode?: string;
      quantity: number;
      unit: 'unit' | 'kg' | 'g' | 'L' | 'mL' | 'pack';
      unitPrice: number;
      discountAmount?: number;
      lineTotalTTC: number;
      categoryType: 'ALIMENTAIRE' | 'ENTRETIEN_HYGIENE' | 'LOISIRS' | 'AUTRE';
    }>;
  }>;
}

export interface InvoicePersistencePort {
  hasExistingInvoiceFingerprint(
    userId: string,
    yearMonth: YearMonth,
    invoiceFingerprint: string
  ): Promise<boolean>;
  listUserPantryItems(userId: string): Promise<PantryItem[]>;
  commitValidatedInvoiceAtomicBatch(params: {
    userId: string;
    yearMonth: YearMonth;
    transactions: BudgetTransaction[];
    updatedPantryItems: PantryItem[];
    newPantryMovements: PantryMovement[];
    newStorePrices: StorePriceRecord[];
  }): Promise<void>;
}

/**
 * Prompt Système & Schéma d'instructions pour Vertex AI Gemini 2.5 Flash (IA-06 & IA-07)
 */
export const GEMINI_INVOICE_PARSER_SYSTEM_PROMPT = `
Tu es un moteur expert d'extraction comptable et d'analyse de factures de supermarchés (Drive, e-tickets PDF multi-pages et tickets de caisse papier).
Analyse le document (application/pdf ou image/*) et extrais en JSON strict :
1. Le nom de l'enseigne (ex: "E.Leclerc Drive", "Carrefour", "Lidl", "Auchan") et son adresse.
2. La date exacte d'achat au format ISO YYYY-MM-DD (indispensable pour rattacher la dépense à la bonne page mensuelle YYYY-MM).
3. Le numéro de facture / ticket, le montant total TTC payé et le total des remises fidélité.
4. Chaque ligne d'article avec :
   - rawLabel : libellé brut figurant sur la facture
   - normalizedLabel : libellé français/anglais propre et standardisé (ex: "Huile de Tournesol 1L", "Lait Demi-Écrémé 1L")
   - quantity : quantité achetée (nombre positif)
   - unit : "unit" | "kg" | "g" | "L" | "mL" | "pack"
   - unitPrice : prix unitaire net TTC
   - lineTotalTTC : total TTC de la ligne
   - categoryType : "ALIMENTAIRE" | "ENTRETIEN_HYGIENE" | "LOISIRS" | "AUTRE"
`.trim();

/**
 * US 4.2, US 4.3 & IA-06 — Étape 1 : Extraction multimodale d'un PDF ou d'une photo de ticket
 * et préparation de l'écran de pré-validation (avec détection anti-doublon et proposition de ventilation).
 */
export async function parseAndPrepareInvoiceForValidation(params: {
  geminiPort: GeminiMultimodalModelPort;
  persistencePort: InvoicePersistencePort;
  userId: string;
  fileStorageUri: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  locale: SupportedLocale;
  defaultCurrency: SupportedCurrency;
}): Promise<ExtractedInvoicePayload> {
  const extracted = await params.geminiPort.extractInvoiceFromDocument({
    fileStorageUri: params.fileStorageUri,
    mimeType: params.mimeType,
    locale: params.locale,
    defaultCurrency: params.defaultCurrency,
  });

  const targetYearMonth = extractYearMonthFromDate(extracted.purchaseDateISO);

  const invoiceFingerprint = computeInvoiceFingerprint({
    storeName: extracted.storeName,
    purchaseDateISO: extracted.purchaseDateISO,
    totalAmountTTC: extracted.totalAmountTTC,
    invoiceNumber: extracted.invoiceNumber,
  });

  const isDuplicate = await params.persistencePort.hasExistingInvoiceFingerprint(
    params.userId,
    targetYearMonth,
    invoiceFingerprint
  );

  const lineItems: ExtractedInvoiceLineItem[] = extracted.rawItems.map((item) => ({
    rawLabel: item.rawLabel,
    normalizedLabel: item.normalizedLabel,
    normalizedProductKey: normalizeSemanticProductKey(item.normalizedLabel),
    eanBarcode: item.eanBarcode,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    discountAmount: item.discountAmount ?? 0,
    lineTotalTTC: item.lineTotalTTC,
    categoryType: item.categoryType,
    addToPantry:
      item.categoryType === 'ALIMENTAIRE' || item.categoryType === 'ENTRETIEN_HYGIENE',
  }));

  const suggestedBudgetSplits = computeSuggestedBudgetSplits(lineItems);

  return {
    storeName: extracted.storeName,
    storeAddress: extracted.storeAddress,
    purchaseDateISO: extracted.purchaseDateISO,
    targetYearMonth,
    invoiceNumber: extracted.invoiceNumber,
    totalAmountTTC: extracted.totalAmountTTC,
    totalLoyaltyDiscounts: extracted.totalLoyaltyDiscounts,
    currency: extracted.currency,
    invoiceFingerprint,
    isDuplicate,
    lineItems,
    suggestedBudgetSplits,
  };
}

/**
 * US 4.1 & US 4.3 (Critère 4) — Étape 2 : Validation atomique de la facture PDF (ou scan ticket)
 * après pré-validation par l'utilisateur :
 * - Crée la ou les transactions ventilées dans `monthlyBudgets/{targetYearMonth}/transactions`
 * - Incrémente les quantités dans `pantryItems` et crée les mouvements `RESTOCK` dans `pantryMovements`
 * - Met à jour les prix unitaires dans `storePrices` pour le comparateur 5 km
 */
export async function commitPrevalidatedInvoice(params: {
  persistencePort: InvoicePersistencePort;
  userId: string;
  invoiceFileUrl: string;
  source: Extract<AcquisitionSource, 'PDF_INVOICE' | 'PHOTO_OCR'>;
  payload: ExtractedInvoicePayload;
  validatedBudgetSplits: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
  }>;
  storeLocation?: {
    storeId: string;
    geohash: string;
    lat: number;
    lng: number;
  };
  nowISO?: string;
}): Promise<{
  yearMonth: YearMonth;
  createdTransactionsCount: number;
  updatedPantryItemsCount: number;
  updatedStorePricesCount: number;
}> {
  if (params.payload.isDuplicate) {
    throw new Error(
      `Facture doublon détectée (${params.payload.storeName} - ${params.payload.purchaseDateISO}). Enregistrement bloqué.`
    );
  }

  const nowISO = params.nowISO ?? new Date().toISOString();
  const yearMonth = params.payload.targetYearMonth;

  // 1. Génère les transactions ventilées par poste budgétaire dans le mois de la facture
  const transactions: BudgetTransaction[] = params.validatedBudgetSplits.map(
    (split, idx) => ({
      id: `tx_${yearMonth}_${Date.now()}_${idx}`,
      yearMonth,
      categoryId: split.categoryId,
      categoryName: split.categoryName,
      amount: split.amount,
      type: 'VARIABLE',
      date: params.payload.purchaseDateISO,
      label: `Facture ${params.payload.storeName} (${split.categoryName})`,
      source: params.source,
      storeId: params.storeLocation?.storeId,
      storeName: params.payload.storeName,
      invoiceFileUrl: params.invoiceFileUrl,
      invoiceFingerprint: params.payload.invoiceFingerprint,
      createdAt: nowISO,
    })
  );

  // 2. Réapprovisionne les articles cochés (`addToPantry == true`) dans la réserve domestique
  const existingPantry = await params.persistencePort.listUserPantryItems(params.userId);
  const updatedPantryItems: PantryItem[] = [];
  const newPantryMovements: PantryMovement[] = [];
  const newStorePrices: StorePriceRecord[] = [];

  for (const line of params.payload.lineItems) {
    if (line.addToPantry && line.quantity > 0) {
      const existing = existingPantry.find(
        (p) =>
          (line.eanBarcode && p.eanBarcode === line.eanBarcode) ||
          p.normalizedProductKey === line.normalizedProductKey
      );

      const baseItem: PantryItem = existing ?? {
        id: `pantry_${line.normalizedProductKey}`,
        name: line.normalizedLabel,
        normalizedProductKey: line.normalizedProductKey,
        eanBarcode: line.eanBarcode,
        category:
          line.categoryType === 'ENTRETIEN_HYGIENE'
            ? 'ENTRETIEN_HYGIENE'
            : 'ALIMENTAIRE',
        currentQuantity: 0,
        unit: line.unit,
        alertThreshold: 1,
        needsRestock: true,
        lastUpdatedAt: nowISO,
      };

      const { updatedItem, movement } = applyPantryQuantityDelta({
        item: baseItem,
        delta: line.quantity,
        yearMonth,
        source: params.source,
        nowISO,
        unitPricePaid: line.unitPrice,
        storeId: params.storeLocation?.storeId,
        storeName: params.payload.storeName,
        transactionId: transactions[0]?.id,
      });

      updatedPantryItems.push(updatedItem);
      newPantryMovements.push(movement);
    }

    // 3. Alimente le référentiel de prix locaux 5 km si le magasin est géolocalisé
    if (params.storeLocation && line.unitPrice > 0) {
      newStorePrices.push({
        id: `price_${params.storeLocation.storeId}_${line.normalizedProductKey}`,
        storeId: params.storeLocation.storeId,
        storeName: params.payload.storeName,
        geohash: params.storeLocation.geohash,
        lat: params.storeLocation.lat,
        lng: params.storeLocation.lng,
        eanBarcode: line.eanBarcode,
        normalizedProductKey: line.normalizedProductKey,
        rawProductLabel: line.rawLabel,
        unitPrice: line.unitPrice,
        unit: line.unit,
        observedAt: nowISO,
        source: params.source,
      });
    }
  }

  await params.persistencePort.commitValidatedInvoiceAtomicBatch({
    userId: params.userId,
    yearMonth,
    transactions,
    updatedPantryItems,
    newPantryMovements,
    newStorePrices,
  });

  return {
    yearMonth,
    createdTransactionsCount: transactions.length,
    updatedPantryItemsCount: updatedPantryItems.length,
    updatedStorePricesCount: newStorePrices.length,
  };
}
