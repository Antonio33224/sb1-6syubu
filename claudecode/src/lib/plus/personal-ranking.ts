/**
 * MEU RANKING — nota personalizada por média ponderada dos 7 critérios.
 *
 *   nota personalizada = Σ (nota do critério × peso) / Σ pesos      (pesos > 0)
 *
 * As notas dos critérios são as médias PÚBLICAS da comunidade (todos os
 * usuários com o mesmo peso). O cálculo acontece só na visualização do
 * assinante: não altera notas, avaliações nem o ranking geral.
 */
import { CRITERIA, type CriteriaScores, type CriterionKey, type CriteriaWeights, type Venue, type VenueStats } from '@/types';
import { round1 } from '@/lib/rating';

export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 100;

export const clampWeight = (n: number) => Math.round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Number.isFinite(n) ? n : 0)));

/** Pesos equivalentes aos da nota pública (útil como ponto de partida). */
export const PUBLIC_WEIGHTS: CriteriaWeights = Object.fromEntries(
  CRITERIA.map((c) => [c.key, Math.round(c.weight * 500)]),
) as CriteriaWeights;

export const EQUAL_WEIGHTS: CriteriaWeights = Object.fromEntries(CRITERIA.map((c) => [c.key, 50])) as CriteriaWeights;

export const WEIGHT_PRESETS: { id: string; name: string; description: string; weights: CriteriaWeights }[] = [
  {
    id: 'pista',
    name: 'Pista acima de tudo',
    description: 'Som, DJs e energia do público.',
    weights: { music_rating: 100, crowd_rating: 70, atmosphere_rating: 60, drinks_rating: 30, service_rating: 30, organization_rating: 30, experience_rating: 60 },
  },
  {
    id: 'bolso',
    name: 'Noite que cabe no bolso',
    description: 'Bebidas e preços pesam mais.',
    weights: { music_rating: 60, crowd_rating: 40, atmosphere_rating: 40, drinks_rating: 100, service_rating: 50, organization_rating: 40, experience_rating: 70 },
  },
  {
    id: 'sem-perrengue',
    name: 'Sem perrengue',
    description: 'Fila rápida, atendimento e organização.',
    weights: { music_rating: 50, crowd_rating: 40, atmosphere_rating: 60, drinks_rating: 50, service_rating: 100, organization_rating: 100, experience_rating: 60 },
  },
];

export function normalizeWeights(w: Partial<Record<string, unknown>> | null | undefined): CriteriaWeights {
  return Object.fromEntries(CRITERIA.map((c) => [c.key, clampWeight(Number(w?.[c.key] ?? 0))])) as CriteriaWeights;
}

export const totalWeight = (w: CriteriaWeights) => CRITERIA.reduce((s, c) => s + (w[c.key] > 0 ? w[c.key] : 0), 0);

/**
 * Média ponderada. Critérios com peso 0 (ou sem nota) são desconsiderados.
 * Retorna null quando não há nenhum peso positivo com nota disponível.
 */
export function personalScore(criteria: Partial<CriteriaScores>, weights: CriteriaWeights): number | null {
  let sum = 0;
  let wsum = 0;
  for (const c of CRITERIA) {
    const w = weights[c.key];
    const v = criteria[c.key];
    if (!(w > 0) || typeof v !== 'number' || Number.isNaN(v)) continue;
    sum += v * w;
    wsum += w;
  }
  return wsum === 0 ? null : round1(sum / wsum);
}

/** Participação percentual de cada critério na nota personalizada. */
export function weightShares(weights: CriteriaWeights): Record<CriterionKey, number> {
  const total = totalWeight(weights);
  return Object.fromEntries(CRITERIA.map((c) => [c.key, total ? (Math.max(0, weights[c.key]) / total) * 100 : 0])) as Record<CriterionKey, number>;
}

export interface PersonalRow {
  position: number;
  venue: Venue;
  stats: VenueStats;
  personal: number;
  public: number;
  /** personal − public (positivo = combina mais com você do que a média geral). */
  delta: number;
  /** Compatibilidade 0–100 (nota personalizada em escala percentual). */
  match: number;
  /** Critério que mais contribuiu (nota × peso). */
  strongest: CriterionKey | null;
}

export function rankByPreferences(
  venues: Venue[],
  stats: Record<string, VenueStats>,
  weights: CriteriaWeights,
  opts: { minReviews?: number; limit?: number } = {},
): PersonalRow[] {
  const minReviews = Math.max(1, opts.minReviews ?? 1);
  const rows: Omit<PersonalRow, 'position'>[] = [];
  for (const venue of venues) {
    const s = stats[venue.id];
    if (!s || s.review_count < minReviews) continue; // sem dados suficientes: não entra
    const personal = personalScore(s.criteria, weights);
    if (personal === null) continue;
    let strongest: CriterionKey | null = null;
    let best = -1;
    for (const c of CRITERIA) {
      const contrib = (s.criteria[c.key] ?? 0) * Math.max(0, weights[c.key]);
      if (contrib > best) {
        best = contrib;
        strongest = c.key;
      }
    }
    rows.push({ venue, stats: s, personal, public: s.avg_rating, delta: round1(personal - s.avg_rating), match: Math.round(personal * 10), strongest });
  }
  rows.sort((a, b) => b.personal - a.personal || b.stats.review_count - a.stats.review_count || a.venue.name.localeCompare(b.venue.name));
  const out = rows.map((r, i) => ({ ...r, position: i + 1 }));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Diferença de posição entre o ranking pessoal e a ordem pública (por média). */
export function publicPositions(rows: PersonalRow[]): Map<string, number> {
  const byPublic = rows.slice().sort((a, b) => b.public - a.public || b.stats.review_count - a.stats.review_count);
  return new Map(byPublic.map((r, i) => [r.venue.id, i + 1]));
}
