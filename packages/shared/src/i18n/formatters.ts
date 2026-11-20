import { SupportedCurrency, SupportedLocale, YearMonth } from '../models';

/**
 * Retourne le mois courant au format `YYYY-MM`
 */
export function getCurrentYearMonth(now = new Date()): YearMonth {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}` as YearMonth;
}

/**
 * Calcule le mois précédent (`M-1`) ou suivant (`M+1`) pour la barre de navigation temporelle
 * `< Septembre 2026 | Octobre 2026 | Novembre 2026 >` (US 1.4).
 */
export function shiftYearMonth(yearMonth: YearMonth, deltaMonths: number): YearMonth {
  const [yearStr, monthStr] = yearMonth.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 1 + deltaMonths, 1);
  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${newYear}-${newMonth}` as YearMonth;
}

/**
 * Génère la liste des N derniers mois (`3M`, `6M`, `12M`) pour les graphiques d'évolution (US 5.1, US 5.2).
 */
export function getHistoricalYearMonthsRange(
  endYearMonth: YearMonth,
  count: 3 | 6 | 12
): YearMonth[] {
  const result: YearMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    result.push(shiftYearMonth(endYearMonth, -i));
  }
  return result;
}

/**
 * Formate un identifiant `YYYY-MM` dans la langue de l'utilisateur (ex: "Novembre 2026" ou "November 2026" - US 0.4, US 1.4).
 */
export function formatYearMonthLabel(
  yearMonth: YearMonth,
  locale: SupportedLocale = 'fr'
): string {
  const [yearStr, monthStr] = yearMonth.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  const intlLocale = locale === 'fr' ? 'fr-FR' : locale === 'es' ? 'es-ES' : 'en-US';
  const formatted = new Intl.DateTimeFormat(intlLocale, {
    month: 'long',
    year: 'numeric',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Formate un montant selon la devise (`EUR`, `XAF`, `USD`, `CAD`) et la langue de l'utilisateur (US 0.4).
 */
export function formatCurrencyAmount(
  amount: number,
  currency: SupportedCurrency = 'EUR',
  locale: SupportedLocale = 'fr'
): string {
  const intlLocale = locale === 'fr' ? 'fr-FR' : locale === 'es' ? 'es-ES' : 'en-US';
  const maximumFractionDigits = currency === 'XAF' ? 0 : 2;
  const minimumFractionDigits = currency === 'XAF' ? 0 : 2;

  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
}
