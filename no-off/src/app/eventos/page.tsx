'use client';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { EventCard } from '@/components/cards/EventCard';
import { FilterSelect, Tabs } from '@/components/ui/Controls';
import { EmptyState, ErrorState, PageIntro, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { localIso, weekWindow } from '@/lib/week';
import { djKey } from '@/lib/format';

type When = 'semana' | 'mes' | 'todos' | 'dia';

export default function EventosPage() {
  const { data, version } = useApp();
  const [when, setWhen] = useState<When>('todos');
  const [city, setCity] = useState('');
  const [day, setDay] = useState(localIso(new Date()));
  // ?dj=Nome — vem do line-up da página do evento.
  const [dj, setDj] = useState('');
  useEffect(() => {
    setDj((new URLSearchParams(window.location.search).get('dj') ?? '').slice(0, 120));
  }, []);
  const clearDj = () => {
    setDj('');
    window.history.replaceState(null, '', '/eventos');
  };
  const { data: payload, error, reload } = useAsync(async () => {
    const [events, cities] = await Promise.all([data.listEvents({ from: localIso(new Date()) }), data.listCities()]);
    return { events, cities };
  }, [data, version]);

  const list = useMemo(() => {
    if (!payload) return null;
    const week = weekWindow();
    const month = new Date();
    month.setDate(month.getDate() + 30);
    const to = when === 'semana' ? week.to : when === 'mes' ? localIso(month) : null;
    return payload.events
      .filter((e) => !city || (e.city ?? e.venue.city) === city)
      .filter((e) => when !== 'dia' || e.event_date === day)
      .filter((e) => !dj || e.dj_names.some((n) => djKey(n) === djKey(dj)))
      .filter((e) => !to || e.event_date <= to)
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time));
  }, [payload, when, city, dj, day]);

  return (
    <>
      <PageIntro eyebrow="Agenda" title={<>The night<br />agenda.</>} subtitle="Festas, DJs e eventos — compre seus ingressos com Pix." image="/images/festival-stage.jpg" />
      <section className="container-site py-10 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
          <div className="flex flex-wrap items-end gap-4">
            <Tabs value={when} onChange={setWhen} items={[{ value: 'todos', label: 'Todos os próximos' }, { value: 'semana', label: 'Próximos 7 dias' }, { value: 'mes', label: 'Próximos 30 dias' }, { value: 'dia', label: 'Por dia' }]} />
            {when === 'dia' && (
              <label className="block">
                <span className="field-label">Dia</span>
                <input type="date" min={localIso(new Date())} value={day} onChange={(e) => setDay(e.target.value || localIso(new Date()))} className="field h-11 w-auto" />
              </label>
            )}
          </div>
          <FilterSelect label="Cidade" value={city} onChange={setCity}
            options={[{ value: '', label: 'Todas as cidades' }, ...(payload?.cities ?? []).map((c) => ({ value: c.city, label: `${c.city} — ${c.state}` }))]} />
        </div>
        {dj && (
          <p className="mt-6 flex flex-wrap items-center gap-2 text-[12px] text-mute">
            Mostrando eventos com <span className="chip gap-2 text-bone">{dj}<button onClick={clearDj} aria-label="Remover filtro de DJ" className="hover:text-red-bright"><X className="h-3 w-3" /></button></span>
          </p>
        )}
        <div className="mt-10">
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !list ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[340px]" />)}</div>
          ) : list.length === 0 ? (
            <EmptyState title="Nenhum evento no período" text="Ainda não há eventos divulgados para esses filtros." action={{ href: '/descobrir', label: 'Explorar lugares' }} />
          ) : (
            <>
              <p className="mb-6 text-[12px] text-mute">{list.length} {list.length === 1 ? 'evento' : 'eventos'}</p>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{list.map((e) => <EventCard key={e.id} event={e} />)}</div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
