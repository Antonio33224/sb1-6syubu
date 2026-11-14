import Link from 'next/link';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { ApprovedBadge } from '@/components/brand/ApprovedSeal';
import { FavoriteButton } from '@/components/actions/Actions';
import { CATEGORY_LABEL, priceLabel } from '@/lib/format';
import type { Venue, VenueStats } from '@/types';

export function VenueCard({ venue, stats }: { venue: Venue; stats?: VenueStats }) {
  return (
    <Link href={`/boates/${venue.slug}`} className="group relative block overflow-hidden rounded-card border border-line bg-panel">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Photo src={venue.cover_image} alt={venue.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-ink/30" />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-nav text-bone/85">{CATEGORY_LABEL[venue.category]}</span>
          <FavoriteButton venueId={venue.id} variant="icon" />
        </div>
        {venue.approved && <ApprovedBadge compact className="absolute bottom-4 left-4" />}
      </div>
      <div className="flex items-end justify-between gap-3 p-5">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[17px] font-bold uppercase tracking-tight transition-colors group-hover:text-blue">{venue.name}</h3>
          <p className="mt-1.5 truncate text-[11px] text-mute">
            {venue.neighborhood} · {venue.city} · {priceLabel(venue.price_range)}
          </p>
          <p className="mt-1 truncate text-[11px] text-mute/80">{venue.music_styles.join(' · ')}</p>
        </div>
        <div className="text-right">
          <Score value={stats?.review_count ? stats.avg_rating : null} size="sm" />
          <p className="mt-1 text-[10px] text-mute">{stats?.review_count ?? 0} aval.</p>
        </div>
      </div>
    </Link>
  );
}
