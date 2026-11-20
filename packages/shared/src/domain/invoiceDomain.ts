import * as crypto from 'crypto';
import { ExtractedInvoiceLineItem, YearMonth } from '../models';

/**
 * Extrait l'identifiant mensuel `YYYY-MM` à partir d'une date ISO (`YYYY-MM-DD` ou ISO 8601)
 * pour rattacher toute dépense ou facture PDF au bon mois (US 1.3, US 1.5, US 4.3).
 */
export function extractYearMonthFromDate(dateISO: string): YearMonth {
  const match = dateISO.trim().match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (!match) {
    throw new Error(`Format de date invalide pour le rattachement mensuel YYYY-MM : "${dateISO}"`);
  }
  return `${match[1]}-${match[2]}` as YearMonth;
}

/**
 * US 4.3 (Critère 5) — Génère une empreinte déterministe SHA-256 anti-doublon pour une facture PDF ou un ticket scanné.
 * Bloque l'import si la même facture (même enseigne, même date, même montant TTC ou même numéro de facture) a déjà été traitée.
 */
export function computeInvoiceFingerprint(params: {
  storeName: string;
  purchaseDateISO: string;
  totalAmountTTC: number;
  invoiceNumber?: string;
}): string {
  const normalizedStore = params.storeName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const datePart = params.purchaseDateISO.slice(0, 10);
  const amountPart = params.totalAmountTTC.toFixed(2);
  const invoiceNumPart = (params.invoiceNumber ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const rawPayload = `${normalizedStore}|${datePart}|${amountPart}|${invoiceNumPart}`;
  return crypto.createHash('sha256').update(rawPayload).digest('hex');
}

/**
 * US 4.3 (Critère 3) — Calcule automatiquement la proposition de ventilation budgétaire
 * d'une facture PDF entre plusieurs postes (ex: 85,00 € en Alimentation et 20,00 € en Entretien/Hygiène).
 */
export function computeSuggestedBudgetSplits(
  lineItems: ExtractedInvoiceLineItem[]
): Array<{ budgetCategoryName: string; amount: number }> {
  const map = new Map<string, number>();

  for (const item of lineItems) {
    let targetCategory = 'Alimentation';
    if (item.categoryType === 'ENTRETIEN_HYGIENE') {
      targetCategory = 'Entretien & Hygiène';
    } else if (item.categoryType === 'LOISIRS') {
      targetCategory = 'Loisirs';
    } else if (item.categoryType === 'AUTRE') {
      targetCategory = 'Divers';
    }

    const prev = map.get(targetCategory) ?? 0;
    map.set(targetCategory, Math.round((prev + item.lineTotalTTC) * 100) / 100);
  }

  return Array.from(map.entries()).map(([budgetCategoryName, amount]) => ({
    budgetCategoryName,
    amount,
  }));
}
