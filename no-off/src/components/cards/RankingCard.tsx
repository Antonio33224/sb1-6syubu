import Link from 'next/link';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { ApprovedBadge } from '@/components/brand/ApprovedSeal';
import type { RankingRow } from '@/types';

/** Card fotográfico do ranking (home). */
export function RankingCard({ row, priority }: { row: RankingRow; priority?: boolean }) {
  const { venue, stats, position } = row;
  return (
    <Link
      href={`/boates/${venue.slug}`}
      className="group relative block aspect-[4/3.1] overflow-hidden rounded-card border border-line bg-panel"
    >
      <Photo src={venue.cover_image} alt={venue.name} priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/35 to-ink/40" />
      <div className="absolute inset-0 bg-ink/0 transition-colors duration-700 group-hover:bg-ink/10" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-6">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[26px] font-extrabold leading-none tracking-tight">#{position}</span>
          <span className="text-[10px] font-semibold uppercase tracking-nav text-bone/85">{venue.city}</span>
        </div>
        {venue.approved && <ApprovedBadge compact />}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <h3 className="font-display text-[20px] font-extrabold uppercase leading-[1.02] tracking-tight sm:text-[22px]">{venue.name}</h3>
          <p className="mt-2 text-[11px] text-bone/60">{stats.review_count.toLocaleString('pt-BR')} avaliações</p>
        </div>
        <Score value={stats.avg_rating} size="md" />
      </div>
      <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-red transition-transform duration-700 group-hover:scale-x-100" />
    </Link>
  );
}
