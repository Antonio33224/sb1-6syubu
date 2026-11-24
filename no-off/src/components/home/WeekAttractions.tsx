'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowRight, Clock, MapPin } from 'lucide-react';
import { Carousel } from '@/components/ui/Carousel';
import { Photo } from '@/components/ui/Photo';
import { Skeleton } from '@/components/ui/States';
import { formatEventDate } from '@/lib/format';
import { byDateTime, relativeDayLabel, weekdayOf, weekWindow, WEEKDAY_SHORT } from '@/lib/week';
import { HomeSectionTitle } from './HomeSectionTitle';
import type { HomeData, HomeEvent } from './HomeView';

export function WeekAttractions({ data, city }: { data: HomeData | null; city: string }) {
  const week = useMemo(() => weekWindow(), []);
  const [day, setDay] = useState<string | null>(null);
  const list = useMemo(() => (data ? data.events.filter((e) => e.event_date <= week.to).sort(byDateTime) : null), [data, week]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    (list ?? []).forEach((e) => m.set(e.event_date, (m.get(e.event_date) ?? 0) + 1));
    return m;
  }, [list]);
  const shown = list ? (day ? list.filter((e) => e.event_date === day) : list) : null;

  return (
    <section className="relative overflow-hidden border-t border-line py-16 sm:py-24">
      <div className="pointer-events-none absolute -right-40 top-20 h-[480px] w-[480px] rounded-full bg-red/[0.07] blur-[120px]" />
      <div className="container-site relative">
        <HomeSectionTitle
          index="03"
          eyebrow={city ? `Próximos 7 dias · ${city}` : 'Próximos 7 dias'}
          title={<>Quem vai comandar<br className="hidden sm:block" /> a noite?</>}
          text="DJs, artistas e festas programados para esta semana."
        />

        {/* Filtro por dia da semana */}
        <div className="-mx-5 mb-8 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Filtrar por dia">
          <button role="tab" aria-selected={day === null} onClick={() => setDay(null)} className={clsx('chip shrink-0', day === null && 'chip-active')}>
            Semana toda {list && <span className="ml-1.5 text-bone/50">{list.length}</span>}
          </button>
          {week.days.map((d) => {
            const n = counts.get(d) ?? 0;
            return (
              <button key={d} role="tab" aria-selected={day === d} disabled={!n} onClick={() => setDay(d)}
                className={clsx('chip shrink-0', day === d && 'chip-active', !n && 'cursor-not-allowed opacity-35 hover:border-line hover:text-mute')}>
                {d === week.days[0] ? 'Hoje' : WEEKDAY_SHORT[weekdayOf(d)]} {formatEventDate(d).day}
                {n > 0 && <span className="ml-1.5 text-bone/50">{n}</span>}
              </button>
            );
          })}
        </div>

        {!shown ? (
          <div className="flex gap-4 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[420px] w-[78%] shrink-0 sm:w-[300px]" />)}</div>
        ) : shown.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 px-6 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div>
              <p className="font-display text-[20px] font-extrabold uppercase tracking-tight">Nenhuma atração divulgada</p>
              <p className="mt-2 max-w-md text-[14px] text-mute">
                {city ? `As casas de ${city} ainda não divulgaram a programação dos próximos 7 dias.` : 'As casas ainda não divulgaram a programação dos próximos 7 dias.'}
              </p>
            </div>
            <Link href="/eventos" className="btn-outline btn-sm">Ver agenda futura</Link>
          </div>
        ) : (
          <Carousel label="Atrações da semana" key={day ?? 'all'}>
            {shown.map((e) => <ArtistCard key={e.id} event={e} />)}
          </Carousel>
        )}
      </div>
    </section>
  );
}

function ArtistCard({ event }: { event: HomeEvent }) {
  const headliner = event.dj_names[0] ?? event.name;
  const others = event.dj_names.slice(1);
  return (
    <article className="group relative flex w-[78%] shrink-0 snap-start flex-col overflow-hidden rounded-card border border-line bg-panel transition-colors duration-500 hover:border-red/50 sm:w-[300px]">
      <Link href={`/eventos/${event.slug}`} className="relative block aspect-[4/5] overflow-hidden" draggable={false}>
        <Photo src={event.cover_image} alt={`${headliner} — ${event.name}`} />
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-ink/20 to-transparent" />
        <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-ink/85 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-nav text-red-bright backdrop-blur-sm">
            {relativeDayLabel(event.event_date)}
          </span>        </div>
        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3 className="font-display text-[26px] font-extrabold uppercase leading-[0.92] tracking-tight transition-colors group-hover:text-red-bright">{headliner}</h3>
          {others.length > 0 && <p className="mt-1.5 truncate text-[11px] font-semibold uppercase tracking-nav text-bone/60">+ {others.join(' · ')}</p>}
        </div>
      </Link>
      <div className="flex flex-1 flex-col px-5 pb-5">
        <p className="truncate text-[14px] font-semibold text-bone">{event.name}</p>
        <p className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-mute">
          <MapPin className="h-3 w-3 shrink-0" /> {event.venue.name} · {event.venue.city}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-mute">
          <Clock className="h-3 w-3 shrink-0" /> {formatEventDate(event.event_date).full} · {event.start_time}
        </p>
        <Link href={`/eventos/${event.slug}`} className="link-arrow mt-5 self-start" draggable={false}>
          Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
