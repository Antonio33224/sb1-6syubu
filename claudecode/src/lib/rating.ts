import { CRITERIA, type CriteriaScores } from '@/types';

/** Arredonda para 1 casa decimal. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

export const clampScore = (n: number) => Math.min(10, Math.max(0, n));

/**
 * Nota geral ponderada a partir dos 7 critérios.
 * Espelhada no Postgres pela função `compute_overall_rating` — o servidor
 * sempre recalcula, ignorando qualquer overall enviado pelo navegador.
 */
export function computeOverall(scores: CriteriaScores): number {
  let total = 0;
  let weight = 0;
  for (const c of CRITERIA) {
    const v = scores[c.key];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    total += clampScore(v) * c.weight;
    weight += c.weight;
  }
  return weight === 0 ? 0 : round1(total / weight);
}

export function validateCriteria(scores: Partial<CriteriaScores>): string | null {
  for (const c of CRITERIA) {
    const v = scores[c.key];
    if (typeof v !== 'number' || Number.isNaN(v)) return `Dê uma nota para "${c.label}".`;
    if (v < 0 || v > 10) return `A nota de "${c.label}" deve estar entre 0 e 10.`;
  }
  return null;
}

export const formatScore = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(1);

/** Índice do balde de distribuição: 0 => 9-10 ... 4 => 0-2.9 */
export function distributionBucket(rating: number): number {
  if (rating >= 9) return 0;
  if (rating >= 7) return 1;
  if (rating >= 5) return 2;
  if (rating >= 3) return 3;
  return 4;
}

export const DISTRIBUTION_LABELS = ['9 – 10', '7 – 8.9', '5 – 6.9', '3 – 4.9', '0 – 2.9'];
