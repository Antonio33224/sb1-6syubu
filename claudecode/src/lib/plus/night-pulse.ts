/**
 * PULSO DA NOITE — leitura quase em tempo real das avaliações publicadas.
 * Usa EXCLUSIVAMENTE avaliações reais da comunidade dentro da janela escolhida.
 * Não estima lotação nem movimento: quando não há avaliações recentes, o
 * resultado é vazio e a interface informa que não há dados recentes.
 */
import { CRITERIA, type CriterionKey, type ReviewWithMeta, type Venue, type VenueStats } from '@/types';
import { round1 } from '@/lib/rating';

const HOUR = 3_600_000;

export const PULSE_WINDOWS = [
  { hours: 6, label: '6 horas' },
  { hours: 24, label: '24 horas' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '7 dias' },
] as const;

export interface PulseVenueRow {
  venue: Venue;
  count: number;
  avg: number;
  /** Média do critério destacado no indicador (quando aplicável). */
  value: number;
  /** Variação da média recente vs. média histórica pública (null sem histórico). */
  trend: number | null;
}

export interface PulseGrowthRow {
  venue: Venue;
  count: number;
  previous: number;
  growth: number;
}

export interface PulseFeedItem {
  item: ReviewWithMeta;
  /** Critério com a maior nota nessa avaliação. */
  highlight: { key: CriterionKey; label: string; value: number };
  /** Variação desta nota em relação à média histórica da casa. */
  vsVenue: number | null;
}

export interface PulseResult {
  windowHours: number;
  generatedAt: string;
  total: number;
  topRated: PulseVenueRow[];
  growth: PulseGrowthRow[];
  bestMusic: PulseVenueRow[];
  bestValue: PulseVenueRow[];
  feed: PulseFeedItem[];
}

function highlightOf(r: ReviewWithMeta['review']) {
  let best: (typeof CRITERIA)[number] = CRITERIA[0];
  for (const c of CRITERIA) if (r[c.key] > r[best.key]) best = c;
  return { key: best.key, label: best.label, value: r[best.key] };
}

export function computePulse(
  reviews: ReviewWithMeta[],
  stats: Record<string, VenueStats>,
  windowHours: number,
  now = Date.now(),
  opts: { limit?: number } = {},
): PulseResult {
  const limit = opts.limit ?? 5;
  const start = now - windowHours * HOUR;
  const prevStart = start - windowHours * HOUR;
  const visible = reviews.filter((r) => r.review.status !== 'hidden');
  const recent = visible.filter((r) => {
    const t = new Date(r.review.created_at).getTime();
    return t > start && t <= now;
  });
  const previous = visible.filter((r) => {
    const t = new Date(r.review.created_at).getTime();
    return t > prevStart && t <= start;
  });

  const byVenue = new Map<string, ReviewWithMeta[]>();
  for (const r of recent) byVenue.set(r.venue.id, [...(byVenue.get(r.venue.id) ?? []), r]);

  const venueRows = (key?: CriterionKey): PulseVenueRow[] =>
    [...byVenue.values()]
      .map((list) => {
        const venue = list[0]!.venue;
        const avg = round1(list.reduce((s, r) => s + r.review.overall_rating, 0) / list.length);
        const value = key ? round1(list.reduce((s, r) => s + r.review[key], 0) / list.length) : avg;
        const hist = stats[venue.id];
        return { venue, count: list.length, avg, value, trend: hist?.review_count ? round1(avg - hist.avg_rating) : null };
      })
      .sort((a, b) => b.value - a.value || b.count - a.count)
      .slice(0, limit);

  const prevCount = new Map<string, number>();
  for (const r of previous) prevCount.set(r.venue.id, (prevCount.get(r.venue.id) ?? 0) + 1);
  const growth: PulseGrowthRow[] = [...byVenue.values()]
    .map((list) => {
      const venue = list[0]!.venue;
      const prev = prevCount.get(venue.id) ?? 0;
      return { venue, count: list.length, previous: prev, growth: list.length - prev };
    })
    .filter((g) => g.growth > 0)
    .sort((a, b) => b.growth - a.growth || b.count - a.count)
    .slice(0, limit);

  const feed: PulseFeedItem[] = recent
    .slice()
    .sort((a, b) => b.review.created_at.localeCompare(a.review.created_at))
    .slice(0, 20)
    .map((item) => {
      const hist = stats[item.venue.id];
      return {
        item,
        highlight: highlightOf(item.review),
        vsVenue: hist?.review_count ? round1(item.review.overall_rating - hist.avg_rating) : null,
      };
    });

  return {
    windowHours,
    generatedAt: new Date(now).toISOString(),
    total: recent.length,
    topRated: venueRows(),
    growth,
    bestMusic: venueRows('music_rating'),
    // "Custo-benefício": o critério existente que mede preço é "Bebidas e preços".
    bestValue: venueRows('drinks_rating'),
    feed,
  };
}
