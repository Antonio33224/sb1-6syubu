/**
 * MINHA RETROSPECTIVA — estatísticas anuais calculadas exclusivamente a partir
 * das avaliações da própria conta. Nada é estimado ou preenchido: se não houver
 * dado (ex.: nenhuma avaliação no ano), o campo fica null.
 */
import { CRITERIA, type CriterionKey, type CriteriaWeights, type ReviewWithMeta, type Venue } from '@/types';
import { round1 } from '@/lib/rating';

export interface MonthPoint {
  month: number; // 0–11
  count: number;
  avg: number | null;
}

export interface Retrospective {
  year: number;
  reviews: number;
  venues: number;
  photos: number;
  cities: number;
  avgGiven: number | null;
  topVenue: { venue: Venue; rating: number } | null;
  favoriteStyle: { style: string; count: number } | null;
  /** Critério com a maior média nas notas dadas pela pessoa. */
  topCriterion: { key: CriterionKey; label: string; avg: number } | null;
  /** Critério de maior peso no Meu Ranking (se configurado). */
  mostValued: { key: CriterionKey; label: string; weight: number } | null;
  favorites: ReviewWithMeta[];
  months: MonthPoint[];
}

/** Data de referência da experiência: data informada ou, na falta, data de publicação. */
export const experienceTime = (r: ReviewWithMeta) => new Date(r.review.experience_date ? `${r.review.experience_date}T12:00:00` : r.review.created_at);

export function yearsWithActivity(reviews: ReviewWithMeta[]): number[] {
  return [...new Set(reviews.map((r) => experienceTime(r).getFullYear()))].sort((a, b) => b - a);
}

export function computeRetrospective(all: ReviewWithMeta[], year: number, weights?: CriteriaWeights | null): Retrospective {
  const reviews = all.filter((r) => r.review.status !== 'hidden' && experienceTime(r).getFullYear() === year);
  const n = reviews.length;

  const styleCount = new Map<string, number>();
  for (const r of reviews) for (const s of r.venue.music_styles) styleCount.set(s, (styleCount.get(s) ?? 0) + 1);
  const topStyle = [...styleCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  const top = reviews.slice().sort((a, b) => b.review.overall_rating - a.review.overall_rating || b.review.created_at.localeCompare(a.review.created_at))[0];

  let topCriterion: Retrospective['topCriterion'] = null;
  if (n) {
    for (const c of CRITERIA) {
      const avg = round1(reviews.reduce((s, r) => s + r.review[c.key], 0) / n);
      if (!topCriterion || avg > topCriterion.avg) topCriterion = { key: c.key, label: c.label, avg };
    }
  }

  let mostValued: Retrospective['mostValued'] = null;
  if (weights) {
    for (const c of CRITERIA) {
      const w = weights[c.key] ?? 0;
      if (w > 0 && (!mostValued || w > mostValued.weight)) mostValued = { key: c.key, label: c.label, weight: w };
    }
  }

  const months: MonthPoint[] = Array.from({ length: 12 }, (_, month) => {
    const list = reviews.filter((r) => experienceTime(r).getMonth() === month);
    return { month, count: list.length, avg: list.length ? round1(list.reduce((s, r) => s + r.review.overall_rating, 0) / list.length) : null };
  });

  return {
    year,
    reviews: n,
    venues: new Set(reviews.map((r) => r.venue.id)).size,
    photos: reviews.reduce((s, r) => s + r.review.photos.length, 0),
    cities: new Set(reviews.map((r) => r.venue.city)).size,
    avgGiven: n ? round1(reviews.reduce((s, r) => s + r.review.overall_rating, 0) / n) : null,
    topVenue: top ? { venue: top.venue, rating: top.review.overall_rating } : null,
    favoriteStyle: topStyle ? { style: topStyle[0], count: topStyle[1] } : null,
    topCriterion,
    mostValued,
    favorites: reviews.slice().sort((a, b) => b.review.overall_rating - a.review.overall_rating).slice(0, 3),
    months,
  };
}

/** Texto curto para compartilhar (WhatsApp etc.). Só inclui o que existe. */
export function shareText(r: Retrospective, siteUrl: string): string {
  const lines = [`MINHA NOITE EM ${r.year} — Classify DJ`, `${r.venues} ${r.venues === 1 ? 'casa avaliada' : 'casas avaliadas'}`, `${r.reviews} ${r.reviews === 1 ? 'avaliação publicada' : 'avaliações publicadas'}`];
  if (r.favoriteStyle) lines.push(`Meu estilo favorito: ${r.favoriteStyle.style}`);
  if (r.topVenue) lines.push(`Minha nº 1: ${r.topVenue.venue.name}`);
  lines.push(siteUrl);
  return lines.join('\n');
}
