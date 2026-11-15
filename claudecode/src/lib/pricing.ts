import type { Venue } from '@/types';

export const PRICE_FIELDS = [
  'avg_price',
  'entry_price_min',
  'entry_price_max',
  'drink_price_min',
  'drink_price_max',
  'spend_min',
  'spend_max',
] as const;

export type PriceField = (typeof PRICE_FIELDS)[number];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "R$ 120" — sem centavos quando inteiro. */
export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** "R$ 30–60", "a partir de R$ 30", "até R$ 60" ou null quando não informado. */
export function formatRange(min?: number | null, max?: number | null): string | null {
  const a = isNum(min) ? min : null;
  const b = isNum(max) ? max : null;
  if (a !== null && b !== null) return a === b ? brl(a) : `${brl(a)}–${b.toLocaleString('pt-BR')}`;
  if (a !== null) return `a partir de ${brl(a)}`;
  if (b !== null) return `até ${brl(b)}`;
  return null;
}

export interface PriceBreakdownRow {
  key: 'entry' | 'drinks' | 'spend';
  label: string;
  value: string;
}

export function priceBreakdown(v: Venue): PriceBreakdownRow[] {
  const rows: (PriceBreakdownRow | null)[] = [
    (() => {
      const value = formatRange(v.entry_price_min, v.entry_price_max);
      return value ? { key: 'entry' as const, label: 'Entrada', value } : null;
    })(),
    (() => {
      const value = formatRange(v.drink_price_min, v.drink_price_max);
      return value ? { key: 'drinks' as const, label: 'Drinks', value } : null;
    })(),
    (() => {
      const value = formatRange(v.spend_min, v.spend_max);
      return value ? { key: 'spend' as const, label: 'Consumação média', value } : null;
    })(),
  ];
  return rows.filter((r): r is PriceBreakdownRow => r !== null);
}

export const hasAvgPrice = (v: Venue): v is Venue & { avg_price: number } => isNum(v.avg_price);

export const hasAnyPriceInfo = (v: Venue) => hasAvgPrice(v) || priceBreakdown(v).length > 0;

/** Valida os campos de preço antes de salvar (usado pelos dois serviços). */
export function validatePrices(v: Partial<Venue>): string | null {
  for (const f of PRICE_FIELDS) {
    const val = v[f];
    if (val === null || val === undefined) continue;
    if (!isNum(val) || val < 0) return 'Os valores de preço devem ser números positivos.';
    if (val > 100_000) return 'Valor de preço fora do intervalo permitido.';
  }
  const pairs: [PriceField, PriceField, string][] = [
    ['entry_price_min', 'entry_price_max', 'entrada'],
    ['drink_price_min', 'drink_price_max', 'drinks'],
    ['spend_min', 'spend_max', 'consumação'],
  ];
  for (const [a, b, label] of pairs) {
    const x = v[a];
    const y = v[b];
    if (isNum(x) && isNum(y) && x > y) return `Na faixa de ${label}, o valor mínimo não pode ser maior que o máximo.`;
  }
  return null;
}

/** Normaliza: campos ausentes viram null (nunca 0, para não sugerir "gratuito"). */
export function normalizePrices(v: Partial<Venue>): Record<PriceField, number | null> {
  return Object.fromEntries(PRICE_FIELDS.map((f) => [f, isNum(v[f]) ? (v[f] as number) : null])) as Record<PriceField, number | null>;
}
