import Link from 'next/link';
import { Photo } from '@/components/ui/Photo';
import { FavoriteButton } from '@/components/actions/Actions';
import { formatBRL, formatEventDate } from '@/lib/format';
import type { EventItem, Venue } from '@/types';

export function EventCard({ event }: { event: EventItem & { venue: Venue } }) {
  const d = formatEventDate(event.event_date);
  return (
    <Link href={`/eventos/${event.slug}`} className="group relative block overflow-hidden rounded-card border border-line bg-panel">
      <div className="relative aspect-[16/10] overflow-hidden">
        <Photo src={event.cover_image} alt={event.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-ink/20" />
        <div className="absolute left-4 top-4 rounded-sm bg-ink/80 px-3 py-2 text-center backdrop-blur-sm">
          <p className="font-display text-[22px] font-extrabold leading-none">{d.day}</p>
          <p className="mt-1 text-[9px] font-bold tracking-nav text-blue">{d.month}</p>
        </div>
        <FavoriteButton eventId={event.id} variant="icon" className="absolute right-4 top-4" />
      </div>
      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">
          {d.weekday} · {event.start_time} · {event.venue.city}
        </p>
        <h3 className="mt-2 font-display text-[17px] font-bold uppercase leading-tight tracking-tight transition-colors group-hover:text-blue">{event.name}</h3>
        <p className="mt-2 truncate text-[12px] text-mute">{event.dj_names.join(' · ')}</p>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-[12px] text-bone/80">{event.venue.name}</span>
          <span className="font-display text-[14px] font-bold text-blue">{formatBRL(event.ticket_price)}</span>
        </div>
      </div>
    </Link>
  );
}
