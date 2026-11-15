'use client';
import Link from 'next/link';
import { ArrowRight, MapPin, Music2 } from 'lucide-react';
import { Carousel } from '@/components/ui/Carousel';
import { Photo } from '@/components/ui/Photo';
import { DemoTag, EmptyState, Skeleton } from '@/components/ui/States';
import { formatBRL, formatEventDate } from '@/lib/format';
import { byDateTime, relativeDayLabel, weekWindow } from '@/lib/week';
import { HomeSectionTitle } from './HomeSectionTitle';
import type { HomeData, HomeEvent } from './HomeView';

export function FeaturedEvents({ data, city }: { data: HomeData | null; city: string }) {
  const events = data ? [...data.events].sort(byDateTime).slice(0, 8) : null;

  return (
    <section id="eventos-destaque" className="scroll-mt-20 overflow-hidden py-16 sm:py-24">
      <div className="container-site">
        <HomeSectionTitle
          index="01"
          eyebrow={city ? `Agenda · ${city}` : 'Agenda'}
          title="Eventos em destaque"
          text="As próximas festas e noites especiais cadastradas na plataforma."
          href="/eventos"
          linkLabel="Agenda completa"
        />
        {!events ? (
          <div className="flex gap-4 overflow-hidden">
            <Skeleton className="aspect-[16/10] w-[88%] shrink-0 sm:w-[640px]" />
            <Skeleton className="aspect-[16/10] w-[88%] shrink-0 sm:w-[640px]" />
          </div>
        ) : events.length === 0 ? (
          <EmptyState title="Nenhum evento divulgado" text={city ? `Ainda não há eventos futuros cadastrados em ${city}.` : 'Ainda não há eventos futuros cadastrados.'} action={{ href: '/descobrir', label: 'Explorar lugares' }} />
        ) : (
          <Carousel label="Eventos em destaque">
            {events.map((e, i) => (
              <EventBanner key={e.id} event={e} priority={i === 0} />
            ))}
          </Carousel>
        )}
      </div>
    </section>
  );
}

function EventBanner({ event, priority }: { event: HomeEvent; priority?: boolean }) {
  const d = formatEventDate(event.event_date);
  const inWeek = event.event_date <= weekWindow().to;
  return (
    <article className="group relative aspect-[4/5] w-[86%] shrink-0 snap-start overflow-hidden rounded-card border border-line bg-panel sm:aspect-[16/10] sm:w-[620px] lg:w-[720px]">
      <Photo src={event.cover_image} alt={`Divulgação — ${event.name}`} priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/45 to-ink/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/60 via-transparent to-transparent" />
      <Link href={`/eventos/${event.slug}`} className="absolute inset-0" aria-label={`Ver evento ${event.name}`} draggable={false} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-7">
        <div className="rounded-sm bg-ink/85 px-3.5 py-2.5 text-center backdrop-blur-sm">
          <p className="text-[9px] font-bold tracking-nav text-mute">{d.weekday}</p>
          <p className="font-display text-[32px] font-extrabold leading-none">{d.day}</p>
          <p className="mt-1 text-[9px] font-bold tracking-nav text-blue">{d.month}</p>
        </div>
        <div className="flex items-center gap-2">
          {inWeek && <span className="rounded-sm bg-blue px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-nav text-ink">{relativeDayLabel(event.event_date)}</span>}
          {event.is_demo && <DemoTag className="bg-ink/70" />}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 sm:p-7">
        <p className="text-[10px] font-bold uppercase tracking-nav text-blue">{event.venue.name}</p>
        <h3 className="mt-2 font-display text-[28px] font-extrabold uppercase leading-[0.92] tracking-tight sm:text-[40px]">{event.name}</h3>
        {event.dj_names.length > 0 && (
          <p className="mt-3 flex items-start gap-2 text-[13px] text-bone/85">
            <Music2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue" />
            <span className="line-clamp-2">{event.dj_names.join(' · ')}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-bone/15 pt-4">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-nav text-bone/70">
            <MapPin className="h-3.5 w-3.5" /> {event.venue.neighborhood} · {event.venue.city} · {event.start_time}
          </p>
          <div className="flex items-center gap-4">
            <span className="font-display text-[16px] font-bold text-blue">{formatBRL(event.ticket_price)}</span>
            <Link href={`/eventos/${event.slug}`} className="btn-primary btn-sm pointer-events-auto" draggable={false}>
              Ver evento <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
