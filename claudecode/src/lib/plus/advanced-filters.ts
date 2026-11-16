/**
 * Filtros avançados Classify+.
 * Regra de ouro: um filtro só usa dados cadastrados. Quando a informação não
 * foi informada para uma casa (ex.: capacidade), a casa NÃO passa no filtro
 * ativo — nunca estimamos um valor.
 */
import { CRITERIA, type AdvancedFilterState, type CriterionKey, type Venue, type VenueStats } from '@/types';

export const AUDIENCE_OPTIONS = ['Universitário', 'Jovem adulto', '30+', 'LGBTQIA+', 'Turistas', 'Underground', 'Alto padrão'] as const;

export const CAPACITY_BANDS = [
  { value: 'intimista', label: 'Intimista (até 400)', min: 0, max: 400 },
  { value: 'media', label: 'Média (400–1.200)', min: 401, max: 1200 },
  { value: 'grande', label: 'Grande (1.200–5.000)', min: 1201, max: 5000 },
  { value: 'mega', label: 'Mega (5.000+)', min: 5001, max: Infinity },
] as const;

export const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'] as const;

export const EVENT_TYPES = [
  { value: 'boate', label: 'Boate' },
  { value: 'festa', label: 'Festa' },
  { value: 'festival', label: 'Festival' },
  { value: 'experiencia', label: 'Experiência' },
] as const;

/** Filtros disponíveis para todos (os que já existiam no Descobrir). */
export const BASIC_FILTER_KEYS = ['city', 'styles', 'priceRanges', 'minRating'] as const;
/** Filtros exclusivos Classify+. */
export const PREMIUM_FILTER_KEYS = [
  'avgPriceMin', 'avgPriceMax', 'audience', 'capacity', 'openAt', 'weekdays', 'categories', 'criteriaMin', 'maxDistanceKm', 'minReviews',
] as const;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const WEEKDAY_KEYS = WEEKDAYS.map(norm);

/**
 * Interpreta `opening_days` (texto livre do cadastro): "Sexta", "Quinta a domingo",
 * "Sexta e sábado". Retorna índices 0=segunda…6=domingo, ou null se não for possível
 * interpretar (ex.: "Edições trimestrais").
 */
export function parseOpeningDays(days: string[]): Set<number> | null {
  const out = new Set<number>();
  for (const raw of days) {
    const t = norm(raw).replace(/-feira/g, '');
    const range = t.match(/^(\w+)\s+a\s+(\w+)$/);
    if (range) {
      const a = WEEKDAY_KEYS.findIndex((d) => range[1]!.startsWith(d.slice(0, 3)));
      const b = WEEKDAY_KEYS.findIndex((d) => range[2]!.startsWith(d.slice(0, 3)));
      if (a >= 0 && b >= 0) {
        for (let i = a; ; i = (i + 1) % 7) {
          out.add(i);
          if (i === b) break;
        }
        continue;
      }
    }
    for (const part of t.split(/\s*(?:,|\be\b)\s*/)) {
      const idx = WEEKDAY_KEYS.findIndex((d) => part.startsWith(d.slice(0, 3)));
      if (idx >= 0) out.add(idx);
    }
  }
  return out.size ? out : null;
}

const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** A casa está aberta no horário? Suporta virada da madrugada (23:00–06:00). null = sem dado. */
export function isOpenAt(venue: Pick<Venue, 'opens_at' | 'closes_at'>, hhmm: string): boolean | null {
  if (!venue.opens_at || !venue.closes_at) return null;
  const o = toMinutes(venue.opens_at);
  const c = toMinutes(venue.closes_at);
  const t = toMinutes(hhmm);
  if (o === null || c === null || t === null) return null;
  return o <= c ? t >= o && t < c : t >= o || t < c;
}

export function distanceKm(a: { lat: number; lng: number }, v: Pick<Venue, 'latitude' | 'longitude'>) {
  const R = 6371;
  const dLat = ((v.latitude - a.lat) * Math.PI) / 180;
  const dLng = ((v.longitude - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((v.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export interface FilterContext {
  stats: Record<string, VenueStats>;
  geo?: { lat: number; lng: number } | null;
}

/** Aplica TODOS os filtros combinados (E lógico). */
export function applyAdvancedFilters(venues: Venue[], f: AdvancedFilterState, ctx: FilterContext): Venue[] {
  return venues.filter((v) => {
    const s = ctx.stats[v.id];
    if (f.city && v.city !== f.city) return false;
    if (f.styles?.length && !f.styles.some((st) => v.music_styles.includes(st))) return false;
    if (f.priceRanges?.length && !f.priceRanges.includes(v.price_range)) return false;
    if (f.minRating && (!s?.review_count || s.avg_rating < f.minRating)) return false;
    if (f.minReviews && (s?.review_count ?? 0) < f.minReviews) return false;

    if (f.avgPriceMin != null || f.avgPriceMax != null) {
      if (v.avg_price == null) return false; // não informado
      if (f.avgPriceMin != null && v.avg_price < f.avgPriceMin) return false;
      if (f.avgPriceMax != null && v.avg_price > f.avgPriceMax) return false;
    }
    if (f.audience?.length) {
      if (!v.audience_tags?.length || !f.audience.some((a) => v.audience_tags!.includes(a))) return false;
    }
    if (f.capacity?.length) {
      if (v.capacity == null) return false;
      const ok = f.capacity.some((band) => {
        const b = CAPACITY_BANDS.find((x) => x.value === band);
        return b ? v.capacity! >= b.min && v.capacity! <= b.max : false;
      });
      if (!ok) return false;
    }
    if (f.openAt) {
      if (isOpenAt(v, f.openAt) !== true) return false;
    }
    if (f.weekdays?.length) {
      const days = parseOpeningDays(v.opening_days);
      if (!days) return false;
      if (!f.weekdays.some((d) => days.has(WEEKDAYS.indexOf(d as (typeof WEEKDAYS)[number])))) return false;
    }
    if (f.categories?.length && !f.categories.includes(v.category)) return false;
    if (f.criteriaMin) {
      for (const [key, min] of Object.entries(f.criteriaMin) as [CriterionKey, number][]) {
        if (!min) continue;
        if (!s?.review_count || (s.criteria[key] ?? 0) < min) return false;
      }
    }
    if (f.maxDistanceKm && ctx.geo) {
      if (distanceKm(ctx.geo, v) > f.maxDistanceKm) return false;
    }
    return true;
  });
}

export interface ActiveChip {
  key: keyof AdvancedFilterState;
  label: string;
  /** Valor específico (para remover um item de uma lista). */
  value?: string | number;
  premium: boolean;
}

const criterionLabel = (k: string) => CRITERIA.find((c) => c.key === k)?.label ?? k;

/** Lista de "chips" removíveis representando os filtros ativos. */
export function activeChips(f: AdvancedFilterState): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (f.city) chips.push({ key: 'city', label: f.city, premium: false });
  f.styles?.forEach((s) => chips.push({ key: 'styles', label: s, value: s, premium: false }));
  f.priceRanges?.forEach((p) => chips.push({ key: 'priceRanges', label: `R${'$'.repeat(p)}`, value: p, premium: false }));
  if (f.minRating) chips.push({ key: 'minRating', label: `Nota ${f.minRating}+`, premium: false });
  if (f.avgPriceMin != null || f.avgPriceMax != null)
    chips.push({ key: 'avgPriceMin', label: `Gasto médio ${f.avgPriceMin != null ? `R$ ${f.avgPriceMin}` : ''}–${f.avgPriceMax != null ? `R$ ${f.avgPriceMax}` : '∞'}`, premium: true });
  f.audience?.forEach((a) => chips.push({ key: 'audience', label: a, value: a, premium: true }));
  f.capacity?.forEach((c) => chips.push({ key: 'capacity', label: CAPACITY_BANDS.find((b) => b.value === c)?.label ?? c, value: c, premium: true }));
  if (f.openAt) chips.push({ key: 'openAt', label: `Aberto às ${f.openAt}`, premium: true });
  f.weekdays?.forEach((d) => chips.push({ key: 'weekdays', label: d, value: d, premium: true }));
  f.categories?.forEach((c) => chips.push({ key: 'categories', label: EVENT_TYPES.find((t) => t.value === c)?.label ?? c, value: c, premium: true }));
  Object.entries(f.criteriaMin ?? {}).forEach(([k, v]) => v && chips.push({ key: 'criteriaMin', label: `${criterionLabel(k)} ${v}+`, value: k, premium: true }));
  if (f.maxDistanceKm) chips.push({ key: 'maxDistanceKm', label: `Até ${f.maxDistanceKm} km`, premium: true });
  if (f.minReviews) chips.push({ key: 'minReviews', label: `${f.minReviews}+ avaliações`, premium: true });
  return chips;
}

/** Remove um chip do estado (imutável). */
export function removeChip(f: AdvancedFilterState, chip: ActiveChip): AdvancedFilterState {
  const next: AdvancedFilterState = { ...f };
  switch (chip.key) {
    case 'styles':
    case 'audience':
    case 'weekdays':
    case 'categories':
    case 'capacity':
      (next[chip.key] as unknown[]) = ((f[chip.key] as unknown[]) ?? []).filter((x) => x !== chip.value);
      break;
    case 'priceRanges':
      next.priceRanges = (f.priceRanges ?? []).filter((x) => x !== chip.value);
      break;
    case 'avgPriceMin':
      next.avgPriceMin = null;
      next.avgPriceMax = null;
      break;
    case 'criteriaMin': {
      const c = { ...(f.criteriaMin ?? {}) };
      delete c[chip.value as CriterionKey];
      next.criteriaMin = c;
      break;
    }
    default:
      (next as Record<string, unknown>)[chip.key] = chip.key === 'city' ? '' : null;
  }
  return next;
}

/** Verdadeiro se algum filtro exclusivo Classify+ está ativo. */
export const usesPremiumFilters = (f: AdvancedFilterState) => activeChips(f).some((c) => c.premium);

/** Mantém apenas os filtros básicos (usado para visitantes/gratuitos). */
export function stripPremium(f: AdvancedFilterState): AdvancedFilterState {
  return { city: f.city, styles: f.styles, priceRanges: f.priceRanges, minRating: f.minRating };
}
