import type { ReviewSort, ReviewWithMeta } from '@/types';

const DAY = 86_400_000;

/** Ordenações da página de reviews. */
export function sortReviews(rows: ReviewWithMeta[], sort: ReviewSort | string): ReviewWithMeta[] {
  const copy = rows.slice();
  if (sort === 'best') copy.sort((a, b) => b.review.overall_rating - a.review.overall_rating || b.likes - a.likes);
  else if (sort === 'liked') copy.sort((a, b) => b.likes - a.likes || b.review.created_at.localeCompare(a.review.created_at));
  else if (sort === 'useful') {
    // Utilidade: curtidas + riqueza do relato (comentário detalhado, fotos), suavizado pela idade.
    const useful = (r: ReviewWithMeta) => {
      const age = Math.max(1, (Date.now() - new Date(r.review.created_at).getTime()) / DAY);
      const detail = Math.min(3, r.review.comment.length / 80) + r.review.photos.length * 1.5;
      return (r.likes + detail) / Math.pow(age, 0.15);
    };
    copy.sort((a, b) => useful(b) - useful(a));
  } else copy.sort((a, b) => b.review.updated_at.localeCompare(a.review.updated_at));
  return copy;
}
