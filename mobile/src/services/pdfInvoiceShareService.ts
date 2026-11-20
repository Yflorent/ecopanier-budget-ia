import {
  ExtractedInvoiceLineItem,
  ExtractedInvoicePayload,
  YearMonth,
  computeSuggestedBudgetSplits,
} from '@depense/shared';

export interface MobilePdfPickerAndStoragePort {
  pickLocalPdfDocument(): Promise<{ localUri: string; fileName: string; sizeBytes: number } | null>;
  uploadPdfToFirebaseStorage(params: {
    userId: string;
    yearMonth: YearMonth;
    localUri: string;
    fileName: string;
  }): Promise<{ storageUri: string; downloadUrl: string }>;
  callGeminiInvoiceParserFunction(params: {
    storageUri: string;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  }): Promise<ExtractedInvoicePayload>;
}

/**
 * Service Mobile d'Import de Factures PDF & Récepteur de Partage Natif ("Share Extension" iOS / "Intent Filter" Android)
 * Conforme à US 4.3 & STITCH-05 / STITCH-10.
 */
export class PdfInvoiceShareService {
  constructor(private readonly port: MobilePdfPickerAndStoragePort) {}

  /**
   * US 4.3 (Critère 1) — Import depuis le sélecteur de fichiers système ("Importer une facture PDF")
   */
  public async pickAndExtractPdfInvoice(
    userId: string,
    activeYearMonth: YearMonth
  ): Promise<{ downloadUrl: string; extractedPayload: ExtractedInvoicePayload } | null> {
    const picked = await this.port.pickLocalPdfDocument();
    if (!picked) {
      return null;
    }
    return this.handleIncomingSharedPdfUri({
      userId,
      fallbackYearMonth: activeYearMonth,
      localUri: picked.localUri,
      fileName: picked.fileName,
      mimeType: 'application/pdf',
    });
  }

  /**
   * US 4.3 (Critère 1 & 2) — Réception directe d'un fichier `.pdf` partagé depuis l'app Mail,
   * Leclerc Drive, Carrefour, Auchan ou Lidl Plus via le menu natif "Partager vers..."
   */
  public async handleIncomingSharedPdfUri(params: {
    userId: string;
    fallbackYearMonth: YearMonth;
    localUri: string;
    fileName: string;
    mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  }): Promise<{ downloadUrl: string; extractedPayload: ExtractedInvoicePayload }> {
    const uploaded = await this.port.uploadPdfToFirebaseStorage({
      userId: params.userId,
      yearMonth: params.fallbackYearMonth,
      localUri: params.localUri,
      fileName: params.fileName,
    });

    const extractedPayload = await this.port.callGeminiInvoiceParserFunction({
      storageUri: uploaded.storageUri,
      mimeType: params.mimeType,
    });

    return {
      downloadUrl: uploaded.downloadUrl,
      extractedPayload,
    };
  }

  /**
   * US 4.3 (Critère 3) — Permet à l'utilisateur de cocher/décocher un article sur l'écran de pré-validation
   * (`STITCH-10`) avant d'enregistrer dans la réserve et recalcule la ventilation budgétaire suggérée.
   */
  public toggleLineItemPantrySelection(
    payload: ExtractedInvoicePayload,
    lineIndex: number,
    addToPantry: boolean
  ): ExtractedInvoicePayload {
    const updatedLines: ExtractedInvoiceLineItem[] = payload.lineItems.map((line, idx) =>
      idx === lineIndex ? { ...line, addToPantry } : line
    );

    return {
      ...payload,
      lineItems: updatedLines,
      suggestedBudgetSplits: computeSuggestedBudgetSplits(updatedLines),
    };
  }
}
