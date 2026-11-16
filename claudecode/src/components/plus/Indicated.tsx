import Link from 'next/link';
import { clsx } from 'clsx';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { CATEGORY_LABEL } from '@/lib/format';
import type { Venue, VenueStats } from '@/types';

/** Rótulo de curadoria. Não é publicidade de terceiros e não altera rankings. */
export function IndicatedLabel({ className }: { className?: string }) {
  return (
    <span
      title="Indicado pela curadoria Classify. Não altera notas nem posições nos rankings."
      className={clsx('inline-flex items-center rounded-sm bg-bone px-2 py-[3px] text-[9px] font-extrabold uppercase tracking-wide2 text-ink', className)}
    >
      Indicado
    </span>
  );
}

export function IndicatedCard({ venue, stats }: { venue: Venue; stats?: VenueStats }) {
  return (
    <Link href={`/boates/${venue.slug}`} className="group relative block w-[280px] shrink-0 overflow-hidden rounded-card border border-line bg-panel sm:w-auto">
      <div className="relative aspect-[16/10] overflow-hidden">
        <Photo src={venue.cover_image} alt={venue.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
        <IndicatedLabel className="absolute left-4 top-4" />
      </div>
      <div className="flex items-end justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">{CATEGORY_LABEL[venue.category]} · {venue.city}</p>
          <h3 className="mt-1.5 truncate font-display text-[17px] font-bold uppercase tracking-tight transition-colors group-hover:text-blue">{venue.name}</h3>
        </div>
        <Score value={stats?.review_count ? stats.avg_rating : null} size="sm" />
      </div>
    </Link>
  );
}

/** Faixa de estabelecimentos INDICADOS — exibida para todos os usuários. */
export function IndicatedRail({ venues, stats, className }: { venues: Venue[]; stats: Record<string, VenueStats>; className?: string }) {
  const list = venues.filter((v) => v.is_indicated);
  if (!list.length) return null;
  return (
    <section className={clsx('container-site', className)} aria-labelledby="indicados-title">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Curadoria Classify</p>
          <h2 id="indicados-title" className="section-title mt-2">Indicados</h2>
        </div>
        <p className="max-w-sm text-[11px] text-mute">Seleção editorial identificada como “Indicado”. Não interfere nas notas nem nas posições dos rankings da comunidade.</p>
      </div>
      <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
        {list.slice(0, 8).map((v) => <IndicatedCard key={v.id} venue={v} stats={stats[v.id]} />)}
      </div>
    </section>
  );
}
