import Link from 'next/link';
import { Ticket } from 'lucide-react';
import { Photo } from '@/components/ui/Photo';
import { FavoriteButton } from '@/components/actions/Actions';
import { formatBRL, formatEventDate } from '@/lib/format';
import { HIDDEN_TEXT, priceLabel } from '@/lib/public-events';
import type { EventWithVenue } from '@/types';

export function EventCard({ event }: { event: EventWithVenue }) {
  const d = formatEventDate(event.event_date);
  const price = priceLabel(event, formatBRL) ?? (event.has_tickets ? 'Ingressos' : formatBRL(event.ticket_price));
  return (
    <Link href={`/eventos/${event.slug}`} className="group relative block overflow-hidden rounded-card border border-line bg-panel">
      <div className="relative aspect-[16/10] overflow-hidden">
        <Photo src={event.cover_image} alt={event.hidden?.name ? HIDDEN_TEXT.name : event.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-ink/20" />
        <div className="absolute left-4 top-4 rounded-sm bg-ink/80 px-3 py-2 text-center backdrop-blur-sm">
          <p className="font-display text-[22px] font-extrabold leading-none">{d.day}</p>
          <p className="mt-1 text-[9px] font-bold tracking-nav text-red-bright">{d.month}</p>
        </div>
        {event.has_tickets && (
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-sm bg-red px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-nav text-bone">
            <Ticket className="h-3 w-3" /> Ingressos NO OFF
          </span>
        )}
        <FavoriteButton eventId={event.id} variant="icon" className="absolute right-4 top-4" />
      </div>
      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">
          {d.weekday} · {event.start_time} · {event.city ?? event.venue.city}
        </p>
        <h3 className="mt-2 font-display text-[17px] font-bold uppercase leading-tight tracking-tight transition-colors group-hover:text-red-bright">{event.name}</h3>
        <p className="mt-2 truncate text-[12px] text-mute">{event.dj_names.join(' · ')}</p>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="truncate text-[12px] text-bone/80">{event.venue.name}</span>
          <span className="shrink-0 font-display text-[14px] font-bold text-red-bright">{price}</span>
        </div>
      </div>
    </Link>
  );
}
