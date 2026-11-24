/**
 * NO OFF — motor de classificação.
 *
 * Princípios:
 *  1. Média bayesiana: estabelecimentos com poucas avaliações são puxados
 *     para a média global C com peso m (configurável). Score =
 *        (n_eff / (n_eff + m)) * R + (m / (n_eff + m)) * C
 *  2. Recência: cada avaliação recebe peso w = max(0.25, 0.5 ^ (idade / meia-vida)).
 *     R é a média ponderada e n_eff = Σw (a amostra "envelhece").
 *  3. Confiabilidade: avaliações ocultas pela moderação não contam;
 *     avaliações sinalizadas (denunciadas) contam com peso 0.5 até a moderação.
 *  4. Variação de posição: ranking recalculado como era há 7 dias.
 *
 * Espelhado em SQL pela função `get_rankings` (supabase/migrations).
 */
import {
  CRITERIA,
  type CriteriaScores,
  type PlatformSettings,
  type RankingQuery,
  type RankingRow,
  type Venue,
  type VenueCategory,
  type VenueReview,
  type VenueStats,
  type ReviewLike,
} from '@/types';
import { distributionBucket, round1 } from './rating';

const DAY = 86_400_000;

export const DEFAULT_SETTINGS: PlatformSettings = {
  approved_min_rating: 8.5,
  approved_min_reviews: 20,
  approved_max_flag_ratio: 0.1,
  bayes_prior_weight: 10,
  recency_half_life_days: 180,
  music_styles: ['Eletrônica', 'House', 'Techno', 'Hip-hop', 'Funk', 'Open format', 'Pop', 'Disco', 'Samba', 'Trap'],
};

export function recencyWeight(createdAt: string, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - new Date(createdAt).getTime()) / DAY);
  return Math.max(0.25, Math.pow(0.5, ageDays / halfLifeDays));
}

function reliabilityWeight(r: VenueReview): number {
  if (r.status === 'hidden') return 0;
  if (r.status === 'flagged') return 0.5;
  return 1;
}

const emptyCriteria = (): CriteriaScores =>
  Object.fromEntries(CRITERIA.map((c) => [c.key, 0])) as CriteriaScores;

/** Média global (C) de todas as avaliações publicadas. */
export function globalMean(reviews: VenueReview[]): number {
  const valid = reviews.filter((r) => r.status !== 'hidden');
  if (!valid.length) return 7;
  return valid.reduce((s, r) => s + r.overall_rating, 0) / valid.length;
}

interface StatsOptions {
  now: number;
  settings: PlatformSettings;
  globalMean: number;
  useRecency?: boolean;
}

export function computeVenueStats(venueId: string, reviews: VenueReview[], opts: StatsOptions): VenueStats {
  const all = reviews.filter((r) => r.venue_id === venueId);
  const visible = all.filter((r) => r.status !== 'hidden');
  const criteria = emptyCriteria();
  const distribution = [0, 0, 0, 0, 0];

  let sum = 0;
  let wSum = 0;
  let wTotal = 0;
  for (const r of visible) {
    sum += r.overall_rating;
    distribution[distributionBucket(r.overall_rating)]++;
    for (const c of CRITERIA) criteria[c.key] += r[c.key];
    const w =
      reliabilityWeight(r) *
      (opts.useRecency === false ? 1 : recencyWeight(r.created_at, opts.now, opts.settings.recency_half_life_days));
    wSum += r.overall_rating * w;
    wTotal += w;
  }
  const n = visible.length;
  if (n) for (const c of CRITERIA) criteria[c.key] = round1(criteria[c.key] / n);

  const m = opts.settings.bayes_prior_weight;
  const R = wTotal ? wSum / wTotal : 0;
  const score = wTotal ? (wTotal / (wTotal + m)) * R + (m / (wTotal + m)) * opts.globalMean : 0;

  const flagged = all.filter((r) => r.status !== 'published').length;
  const flagged_ratio = all.length ? flagged / all.length : 0;
  const avg = n ? round1(sum / n) : 0;

  return {
    venue_id: venueId,
    review_count: n,
    avg_rating: avg,
    score: Math.round(score * 1000) / 1000,
    criteria,
    distribution,
    flagged_ratio,
    approved: isApproved(avg, n, flagged_ratio, opts.settings),
  };
}

export function isApproved(avg: number, count: number, flaggedRatio: number, s: PlatformSettings): boolean {
  return avg >= s.approved_min_rating && count >= s.approved_min_reviews && flaggedRatio <= s.approved_max_flag_ratio;
}

export function computeAllStats(
  venues: Venue[],
  reviews: VenueReview[],
  settings: PlatformSettings,
  now = Date.now(),
): Map<string, VenueStats> {
  const C = globalMean(reviews);
  const map = new Map<string, VenueStats>();
  for (const v of venues) map.set(v.id, computeVenueStats(v.id, reviews, { now, settings, globalMean: C }));
  return map;
}

const CATEGORY_MAP: Record<string, VenueCategory | undefined> = {
  boates: 'boate',
  festas: 'festa',
  festivais: 'festival',
  experiencias: 'experiencia',
};

interface RankInput {
  venues: Venue[];
  reviews: VenueReview[];
  likes: ReviewLike[];
  settings: PlatformSettings;
  now?: number;
}

function rankAt(input: RankInput, q: RankingQuery, now: number): { venue: Venue; stats: VenueStats; key: number; periodCount: number }[] {
  const { settings } = input;
  const category = q.category ?? 'all';
  const period = q.period ?? 'geral';

  let venues = input.venues;
  const cat = CATEGORY_MAP[category];
  if (cat) venues = venues.filter((v) => v.category === cat);
  if (q.city) venues = venues.filter((v) => v.city === q.city);
  if (q.state) venues = venues.filter((v) => v.state === q.state);

  // Somente avaliações existentes no instante "now" (permite calcular o ranking passado).
  const asOf = input.reviews.filter((r) => new Date(r.created_at).getTime() <= now);
  const windowDays = period === 'semana' ? 7 : period === 'mes' ? 30 : null;
  const inWindow = windowDays ? asOf.filter((r) => now - new Date(r.created_at).getTime() <= windowDays * DAY) : asOf;

  const C = globalMean(asOf);
  const useRecency = period !== 'historico';

  const rows = venues.map((venue) => {
    const stats = computeVenueStats(venue.id, inWindow, { now, settings, globalMean: C, useRecency });
    const periodCount = stats.review_count;
    let key = stats.score;

    if (category === 'hype') {
      // Mais hypadas: volume de atividade recente (avaliações + curtidas em 30 dias), desempate pela nota.
      const recent = asOf.filter(
        (r) => r.venue_id === venue.id && r.status !== 'hidden' && now - new Date(r.created_at).getTime() <= 30 * DAY,
      );
      const ids = new Set(recent.map((r) => r.id));
      const likeCount = input.likes.filter(
        (l) => ids.has(l.review_id) && now - new Date(l.created_at).getTime() <= 30 * DAY,
      ).length;
      key = recent.length * 3 + likeCount + stats.score / 100;
    } else if (category === 'ascensao') {
      // Em ascensão: diferença entre a média dos últimos 30 dias e a média anterior, ponderada pela amostra recente.
      const mine = asOf.filter((r) => r.venue_id === venue.id && r.status !== 'hidden');
      const recent = mine.filter((r) => now - new Date(r.created_at).getTime() <= 30 * DAY);
      const older = mine.filter((r) => now - new Date(r.created_at).getTime() > 30 * DAY);
      if (recent.length < 2) key = -Infinity;
      else {
        const avg = (a: VenueReview[]) => a.reduce((s, r) => s + r.overall_rating, 0) / a.length;
        const base = older.length ? avg(older) : C;
        const conf = recent.length / (recent.length + 3);
        key = (avg(recent) - base) * conf;
      }
    }
    return { venue, stats, key, periodCount };
  });

  const minReviews = category === 'ascensao' ? 2 : 1;
  return rows
    .filter((r) => r.stats.review_count >= minReviews && r.key !== -Infinity)
    .filter((r) => (q.minRating ? r.stats.avg_rating >= q.minRating : true))
    .sort((a, b) => b.key - a.key || b.stats.review_count - a.stats.review_count || a.venue.name.localeCompare(b.venue.name));
}

export function computeRankings(input: RankInput, q: RankingQuery = {}): RankingRow[] {
  const now = input.now ?? Date.now();
  const current = rankAt(input, q, now);
  const previous = rankAt(input, q, now - 7 * DAY);
  const prevPos = new Map(previous.map((r, i) => [r.venue.id, i + 1]));
  // Selo "approved" sempre avaliado sobre o histórico completo (não muda por filtro de período).
  const fullStats = computeAllStats(input.venues, input.reviews, input.settings, now);

  const rows = current.map((r, i) => {
    const before = prevPos.get(r.venue.id);
    const full = fullStats.get(r.venue.id)!;
    return {
      position: i + 1,
      venue: { ...r.venue, approved: full.approved },
      stats: { ...r.stats, approved: full.approved },
      change: before ? before - (i + 1) : null,
      period_count: r.periodCount,
    } satisfies RankingRow;
  });
  return q.limit ? rows.slice(0, q.limit) : rows;
}
