'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowRight, CalendarX2, Clock, Disc3, ExternalLink } from 'lucide-react';
import { Photo } from '@/components/ui/Photo';
import { DemoTag } from '@/components/ui/States';
import { formatBRL, formatEventDate } from '@/lib/format';
import { byDateTime, relativeDayLabel, weekdayOf, weekWindow, WEEKDAY_LONG, WEEKDAY_SHORT } from '@/lib/week';
import type { EventItem, Venue } from '@/types';

type Ev = EventItem & { venue: Venue };

/**
 * ATRAÇÕES DA SEMANA — programação dos próximos 7 dias de UMA casa.
 * Recebe somente eventos da própria casa (filtrados por venue_id no serviço)
 * e ainda descarta, por segurança, qualquer item de outra casa.
 */
export function WeeklyLineup({ venue, events, nextLater }: { venue: Venue; events: Ev[]; nextLater?: Ev | null }) {
  const week = useMemo(() => weekWindow(), []);
  const list = useMemo(
    () => events.filter((e) => e.venue_id === venue.id && e.event_date >= week.from && e.event_date <= week.to).sort(byDateTime),
    [events, venue.id, week],
  );
  const [day, setDay] = useState<string | null>(null);
  const daysWithEvents = useMemo(() => new Set(list.map((e) => e.event_date)), [list]);
  const shown = day ? list.filter((e) => e.event_date === day) : list;
  const [featured, ...rest] = shown;
  const next = list[0];

  const range = `${formatEventDate(week.from).day} ${formatEventDate(week.from).month} — ${formatEventDate(week.to).day} ${formatEventDate(week.to).month}`;

  return (
    <section id="atracoes" className="scroll-mt-24 border-t border-line">
      <div className="container-site py-14 lg:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide2 text-blue">Programação · {range}</p>
            <h2 className="section-title mt-3">Atrações da semana</h2>
          </div>
          {list.length > 0 && (
            <p className="text-[12px] text-mute">
              {list.length} {list.length === 1 ? 'atração' : 'atrações'} em {daysWithEvents.size} {daysWithEvents.size === 1 ? 'dia' : 'dias'}
            </p>
          )}
        </div>

        {list.length === 0 ? (
          <EmptyLineup venue={venue} nextLater={nextLater ?? null} />
        ) : (
          <>
            {/* Navegação pelos dias */}
            <div className="-mx-5 mb-8 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:px-0" role="tablist" aria-label="Dias da semana">
              <DayChip active={day === null} onClick={() => setDay(null)} top="Semana" bottom="Todos" />
              {week.days.map((d) => {
                const has = daysWithEvents.has(d);
                return (
                  <DayChip
                    key={d}
                    active={day === d}
                    disabled={!has}
                    onClick={() => setDay(d)}
                    top={WEEKDAY_SHORT[weekdayOf(d)]!}
                    bottom={formatEventDate(d).day}
                    dot={has}
                  />
                );
              })}
            </div>

            {featured && (
              <FeaturedAttraction event={featured} isNext={featured.id === next?.id} />
            )}

            {rest.length > 0 && (
              <ol className="mt-6 divide-y divide-line border-y border-line">
                {rest.map((e) => (
                  <li key={e.id}>
                    <Link href={`/eventos/${e.slug}`} className="group grid grid-cols-[64px_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[150px_88px_1fr_auto] sm:gap-6">
                      <div className="sm:order-2 h-14 w-16 overflow-hidden rounded-[3px] border border-line sm:h-16 sm:w-[88px]">
                        <Photo src={e.cover_image} alt={e.name} />
                      </div>
                      <div className="hidden sm:order-1 sm:block">
                        <p className="font-display text-[15px] font-bold uppercase tracking-tight">{relativeDayLabel(e.event_date)}</p>
                        <p className="mt-1 text-[11px] text-mute">{formatEventDate(e.event_date).full}</p>
                      </div>
                      <div className="min-w-0 sm:order-3">
                        <p className="text-[10px] font-semibold uppercase tracking-nav text-blue sm:hidden">
                          {relativeDayLabel(e.event_date)} · {e.start_time}
                        </p>
                        <p className="mt-1 truncate font-display text-[16px] font-bold uppercase tracking-tight transition-colors group-hover:text-blue sm:mt-0 sm:text-[18px]">
                          {e.dj_names.length ? e.dj_names.join(' · ') : e.name}
                        </p>
                        <p className="mt-1 truncate text-[12px] text-mute">{e.name}</p>
                      </div>
                      <div className="flex items-center gap-4 sm:order-4">
                        <span className="hidden items-center gap-1.5 font-display text-[18px] font-bold tracking-tight sm:inline-flex">
                          <Clock className="h-3.5 w-3.5 text-blue" /> {e.start_time}
                        </span>
                        <ArrowRight className="h-4 w-4 text-mute transition-all group-hover:translate-x-1 group-hover:text-blue" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
            {list.some((e) => e.is_demo) && (
              <p className="mt-5 text-[11px] text-mute">Programação de exemplo (dados demonstrativos fictícios).</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DayChip({ active, disabled, onClick, top, bottom, dot }: { active: boolean; disabled?: boolean; onClick: () => void; top: string; bottom: string; dot?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'relative flex h-[68px] w-[64px] shrink-0 flex-col items-center justify-center rounded-card border transition-all duration-300',
        active ? 'border-blue bg-blue text-ink' : 'border-line text-bone hover:border-bone/60',
        disabled && 'cursor-not-allowed opacity-30 hover:border-line',
      )}
    >
      <span className={clsx('text-[9px] font-bold uppercase tracking-nav', active ? 'text-ink/70' : 'text-mute')}>{top}</span>
      <span className="mt-1 font-display text-[20px] font-extrabold leading-none">{bottom}</span>
      {dot && !active && <span className="absolute bottom-2 h-1 w-1 rounded-full bg-blue" />}
    </button>
  );
}

function FeaturedAttraction({ event, isNext }: { event: Ev; isNext: boolean }) {
  const d = formatEventDate(event.event_date);
  return (
    <article className="group grid overflow-hidden rounded-card border border-line bg-panel lg:grid-cols-[1.15fr_1fr]">
      <Link href={`/eventos/${event.slug}`} className="relative block aspect-[16/10] overflow-hidden lg:aspect-auto lg:min-h-[380px]">
        <Photo src={event.cover_image} alt={`Divulgação — ${event.name}`} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-ink/30 lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-panel" />
        <div className="absolute left-5 top-5 flex items-center gap-2">
          {isNext && (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-blue px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-nav text-ink">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" /> Próxima atração
            </span>
          )}
          {event.is_demo && <DemoTag className="bg-ink/70" />}
        </div>
        <div className="absolute bottom-5 left-5 rounded-sm bg-ink/85 px-3.5 py-2.5 text-center backdrop-blur-sm">
          <p className="font-display text-[30px] font-extrabold leading-none">{d.day}</p>
          <p className="mt-1 text-[9px] font-bold tracking-nav text-blue">{d.month}</p>
        </div>
      </Link>
      <div className="flex flex-col p-6 sm:p-8 lg:p-10">
        <p className="text-[11px] font-bold uppercase tracking-nav text-blue">
          {relativeDayLabel(event.event_date)}
          {relativeDayLabel(event.event_date) !== WEEKDAY_LONG[weekdayOf(event.event_date)] && ` · ${WEEKDAY_LONG[weekdayOf(event.event_date)]}`}
        </p>
        <h3 className="mt-4 font-display text-[30px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[40px]">
          {event.dj_names.length ? event.dj_names[0] : event.name}
        </h3>
        {event.dj_names.length > 1 && (
          <p className="mt-2 text-[13px] font-semibold uppercase tracking-nav text-bone/70">+ {event.dj_names.slice(1).join(' · ')}</p>
        )}
        <p className="mt-5 flex items-center gap-2 text-[14px] font-semibold text-bone">
          <Disc3 className="h-4 w-4 text-blue" /> {event.name}
        </p>
        {event.description && <p className="mt-3 line-clamp-3 text-[14px] leading-relaxed text-mute">{event.description}</p>}

        <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line text-center">
          <Info label="Data" value={`${d.day} ${d.month}`} />
          <Info label="Horário" value={event.start_time || '—'} />
          <Info label="Ingresso" value={formatBRL(event.ticket_price)} />
        </dl>
        {event.music_styles.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {event.music_styles.map((s) => <span key={s} className="chip h-7 px-3 text-[9px]">{s}</span>)}
          </div>
        )}
        <div className="mt-auto flex flex-wrap gap-3 pt-7">
          <Link href={`/eventos/${event.slug}`} className="btn-primary btn-sm">Ver detalhes <ArrowRight className="h-3.5 w-3.5" /></Link>
          {event.ticket_url && (
            <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">Ingressos <ExternalLink className="h-3.5 w-3.5" /></a>
          )}
        </div>
      </div>
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-3 py-3.5">
      <dt className="text-[9px] font-semibold uppercase tracking-nav text-mute">{label}</dt>
      <dd className="mt-1.5 font-display text-[14px] font-bold tracking-tight text-bone">{value}</dd>
    </div>
  );
}

function EmptyLineup({ venue, nextLater }: { venue: Venue; nextLater: Ev | null }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-panel">
      <div className="pointer-events-none absolute -left-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-blue/10 blur-3xl" />
      <div className="relative flex flex-col items-start gap-6 px-6 py-12 sm:flex-row sm:items-center sm:px-10">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-blue/40 text-blue">
          <CalendarX2 className="h-6 w-6" strokeWidth={1.6} />
        </span>
        <div className="flex-1">
          <p className="font-display text-[20px] font-extrabold uppercase tracking-tight">Nenhuma atração divulgada ainda</p>
          <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-mute">
            {venue.name} ainda não divulgou a programação para os próximos 7 dias. Assim que os DJs e festas forem anunciados, eles aparecem aqui.
          </p>
        </div>
        {nextLater && (
          <Link href={`/eventos/${nextLater.slug}`} className="btn-outline btn-sm shrink-0">
            Próxima data: {formatEventDate(nextLater.event_date).day} {formatEventDate(nextLater.event_date).month}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
