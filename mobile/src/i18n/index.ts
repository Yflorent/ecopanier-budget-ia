import fr from './fr.json';
import en from './en.json';
import {
  SupportedCurrency,
  SupportedLocale,
  YearMonth,
  formatCurrencyAmount,
  formatYearMonthLabel,
} from '@depense/shared';

const dictionaries = {
  fr,
  en,
  es: fr, // Fallback vers FR si clé absente
};

export function translate(
  locale: SupportedLocale,
  path: string,
  params?: Record<string, string | number>
): string {
  const dict = dictionaries[locale] ?? dictionaries.fr;
  const parts = path.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  if (typeof current !== 'string') {
    return path;
  }
  if (!params) {
    return current;
  }
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`{{${key}}}`, 'g'), String(value)),
    current
  );
}

export { formatCurrencyAmount, formatYearMonthLabel };
export type { SupportedLocale, SupportedCurrency, YearMonth };
