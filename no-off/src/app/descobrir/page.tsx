'use client';
import dynamic from 'next/dynamic';
import { Suspense, useMemo, useState } from 'react';
import { IndicatedRail } from '@/components/venue/Indicated';
import { useSearchParams } from 'next/navigation';
import { LayoutGrid, LocateFixed, Map as MapIcon, X } from 'lucide-react';
import { findCategory } from '@/lib/categories';
import { clsx } from 'clsx';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { PageIntro, EmptyState, Skeleton } from '@/components/ui/States';
import { FilterSelect } from '@/components/ui/Controls';
import { VenueCard } from '@/components/cards/VenueCard';
import { EventCard } from '@/components/cards/EventCard';
import { useAsync } from '@/hooks/useAsync';
import { isoDate } from '@/lib/format';
import type { Venue, VenueCategory } from '@/types';

const VenueMap = dynamic(() => import('@/components/map/VenueMap').then((m) => m.VenueMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[520px]" />,
});

type Quick = 'todos' | 'proximas' | 'semana' | 'fimdesemana' | 'festivais' | 'Eletrônica' | 'Hip-hop' | 'Funk' | 'House' | 'Techno' | 'Open format';
const QUICK: { value: Quick; label: string }[] = [
  { value: 'todos', label: 'Tudo' },
  { value: 'proximas', label: 'Boates próximas' },
  { value: 'semana', label: 'Festas desta semana' },
  { value: 'fimdesemana', label: 'Fim de semana' },
  { value: 'festivais', label: 'Festivais' },
  { value: 'Eletrônica', label: 'Eletrônica' },
  { value: 'Hip-hop', label: 'Hip-hop' },
  { value: 'Funk', label: 'Funk' },
  { value: 'House', label: 'House' },
  { value: 'Techno', label: 'Techno' },
  { value: 'Open format', label: 'Open format' },
];
const STYLES = new Set(['Eletrônica', 'Hip-hop', 'Funk', 'House', 'Techno', 'Open format']);

function distanceKm(a: { lat: number; lng: number }, v: Venue) {
  const R = 6371;
  const dLat = ((v.latitude - a.lat) * Math.PI) / 180;
  const dLng = ((v.longitude - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((v.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function weekendRange() {
  // Sexta a domingo: se já estamos no fim de semana, de hoje até domingo.
  const now = new Date();
  const day = now.getDay(); // 0 = domingo
  const start = new Date(now);
  if (day >= 1 && day <= 4) start.setDate(now.getDate() + (5 - day));
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - day) % 7));
  return { from: isoDate(start), to: isoDate(sunday) };
}

export default function DescobrirPage() {
  return (
    <Suspense fallback={<div className="container-site py-20"><Skeleton className="h-96" /></div>}>
      <Discover />
    </Suspense>
  );
}

function Discover() {
  const params = useSearchParams();
  const initialStyle = params.get('estilo');
  const { data, version } = useApp();
  const toast = useToast();
  const [quick, setQuick] = useState<Quick>(initialStyle && STYLES.has(initialStyle) ? (initialStyle as Quick) : 'todos');
  const [city, setCity] = useState('');
  const [style, setStyle] = useState(initialStyle && !STYLES.has(initialStyle) ? initialStyle : '');
  const [price, setPrice] = useState('0');
  const [minRating, setMinRating] = useState('0');
  const [when, setWhen] = useState('todas');
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [categorySlug, setCategorySlug] = useState<string | null>(params.get('categoria'));
  const discoverCategory = findCategory(categorySlug);

  const { data: base } = useAsync(async () => {
    const [venues, events, stats, cities, settings] = await Promise.all([
      data.listVenues(),
      data.listEvents({ upcomingOnly: true }),
      data.getAllStats(),
      data.listCities(),
      data.getSettings(),
    ]);
    return { venues, events, stats, cities, styles: settings.music_styles };
  }, [data, version]);

  const pickQuick = (q: Quick) => {
    setQuick(q);
    if (q === 'proximas' && !geo) {
      if (!navigator.geolocation) return toast('Geolocalização indisponível neste navegador.', 'error');
      navigator.geolocation.getCurrentPosition(
        (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {
          toast('Não foi possível obter sua localização. Mostrando o Rio de Janeiro.', 'error');
          setGeo({ lat: -22.9068, lng: -43.1729 });
        },
        { timeout: 8000 },
      );
    }
  };

  const result = useMemo(() => {
    if (!base) return null;
    const today = isoDate(new Date());
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const wk = weekendRange();
    const activeStyle = STYLES.has(quick) ? quick : style;
    const category: VenueCategory | undefined = quick === 'festivais' ? 'festival' : undefined;

    let venues = base.venues.filter((v) => {
      if (discoverCategory && !discoverCategory.match(v)) return false;
      if (city && v.city !== city) return false;
      if (activeStyle && !v.music_styles.includes(activeStyle)) return false;
      if (category && v.category !== category) return false;
      if (quick === 'proximas' && v.category !== 'boate') return false;
      if (Number(price) && v.price_range > Number(price)) return false;
      if (Number(minRating) && (base.stats[v.id]?.avg_rating ?? 0) < Number(minRating)) return false;
      return true;
    });
    if (quick === 'proximas' && geo) venues = venues.slice().sort((a, b) => distanceKm(geo, a) - distanceKm(geo, b));
    else venues = venues.slice().sort((a, b) => (base.stats[b.id]?.score ?? 0) - (base.stats[a.id]?.score ?? 0));

    const venueIds = new Set(venues.map((v) => v.id));
    let from = today;
    let to: string | null = null;
    if (quick === 'semana' || when === 'semana') to = isoDate(in7);
    if (quick === 'fimdesemana' || when === 'fimdesemana') ({ from, to } = wk);
    if (when === 'mes') {
      const m = new Date();
      m.setDate(m.getDate() + 30);
      to = isoDate(m);
    }
    const events = base.events.filter((e) => {
      // Festas fora de casas cadastradas (ou com local oculto) não dependem dos filtros de casa.
      if (e.venue_id && !venueIds.has(e.venue_id) && !(quick === 'semana' || quick === 'fimdesemana')) return false;
      if (city && (e.city ?? e.venue.city) !== city) return false;
      if (activeStyle && !e.music_styles.includes(activeStyle) && !e.venue.music_styles.includes(activeStyle)) return false;
      if (e.event_date < from || (to && e.event_date > to)) return false;
      if (Number(price) && e.ticket_price !== null && e.ticket_price > [0, 60, 120, 250, 99999][Number(price)]!) return false;
      return true;
    });
    const eventsFirst = quick === 'semana' || quick === 'fimdesemana';
    return { venues, events, eventsFirst };
  }, [base, quick, city, style, price, minRating, when, geo, discoverCategory]);

  const clearCategory = () => {
    setCategorySlug(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('categoria');
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <>
      <PageIntro
        eyebrow="Descobrir"
        title={<>Discover<br />the night.</>}
        subtitle="Boates, festas e festivais bem avaliados perto de você — filtrados por estilo, data, preço e nota."
        image="/images/dj-booth.jpg"
      />

      <section className="container-site py-10 sm:py-14">
        {discoverCategory && (
          <div className="relative mb-8 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-card border border-red/40 bg-red-soft px-5 py-4">
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-wide2 text-red-bright">Categoria</p>
              <p className="mt-1 font-display text-[22px] font-extrabold uppercase tracking-tight">{discoverCategory.label}</p>
              <p className="mt-1 text-[12px] text-mute">{discoverCategory.blurb}</p>
            </div>
            <button onClick={clearCategory} className="btn-ghost btn-sm"><X className="h-3.5 w-3.5" /> Limpar categoria</button>
          </div>
        )}
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
          {QUICK.map((q) => (
            <button key={q.value} onClick={() => pickQuick(q.value)} className={clsx('chip shrink-0', quick === q.value && 'chip-active')}>
              {q.value === 'proximas' && <LocateFixed className="mr-1.5 h-3 w-3" />}
              {q.label}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-4 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-[repeat(5,1fr)_auto]">
          <FilterSelect label="Localização" value={city} onChange={setCity}
            options={[{ value: '', label: 'Todas as cidades' }, ...(base?.cities ?? []).map((c) => ({ value: c.city, label: `${c.city} — ${c.state}` }))]} />
          <FilterSelect label="Data dos eventos" value={when} onChange={setWhen}
            options={[{ value: 'todas', label: 'Qualquer data' }, { value: 'semana', label: 'Próximos 7 dias' }, { value: 'fimdesemana', label: 'Este fim de semana' }, { value: 'mes', label: 'Próximos 30 dias' }]} />
          <FilterSelect label="Preço" value={price} onChange={setPrice}
            options={[{ value: '0', label: 'Qualquer' }, { value: '1', label: 'Até R$' }, { value: '2', label: 'Até R$$' }, { value: '3', label: 'Até R$$$' }]} />
          <FilterSelect label="Estilo musical" value={STYLES.has(quick) ? quick : style} onChange={(v) => { setStyle(v); if (STYLES.has(quick)) setQuick('todos'); }}
            options={[{ value: '', label: 'Todos' }, ...(base?.styles ?? []).map((s) => ({ value: s, label: s }))]} />
          <FilterSelect label="Avaliação" value={minRating} onChange={setMinRating}
            options={[{ value: '0', label: 'Qualquer' }, { value: '7', label: '7.0+' }, { value: '8', label: '8.0+' }, { value: '9', label: '9.0+' }]} />
          <div className="flex items-end">
            <div className="flex h-11 overflow-hidden rounded-full border border-line">
              <button onClick={() => setView('grid')} className={clsx('flex items-center gap-2 px-4 text-[10px] font-bold uppercase tracking-nav', view === 'grid' ? 'bg-bone text-ink' : 'text-mute hover:text-bone')} aria-pressed={view === 'grid'}>
                <LayoutGrid className="h-3.5 w-3.5" /> Grade
              </button>
              <button onClick={() => setView('map')} className={clsx('flex items-center gap-2 px-4 text-[10px] font-bold uppercase tracking-nav', view === 'map' ? 'bg-bone text-ink' : 'text-mute hover:text-bone')} aria-pressed={view === 'map'}>
                <MapIcon className="h-3.5 w-3.5" /> Mapa
              </button>
            </div>
          </div>
        </div>

        {!result ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[340px]" />)}</div>
        ) : (
          <div className={clsx('mt-10 flex flex-col gap-16', result.eventsFirst && 'flex-col-reverse')}>
            <div>
              <div className="mb-6 flex items-end justify-between">
                <h2 className="section-title">{quick === 'proximas' ? 'Perto de você' : 'Lugares'}</h2>
                <span className="text-[12px] text-mute">{result.venues.length} resultados</span>
              </div>
              {view === 'map' ? (
                <VenueMap venues={result.venues} stats={base!.stats} className="h-[520px] w-full rounded-card border border-line" />
              ) : result.venues.length ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {result.venues.map((v) => (
                    <div key={v.id} className="relative">
                      <VenueCard venue={v} stats={base!.stats[v.id]} />
                      {quick === 'proximas' && geo && (
                        <span className="pointer-events-none absolute left-4 top-12 text-[10px] font-semibold text-red-bright">{distanceKm(geo, v).toFixed(1)} km</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Nada por aqui" text="Nenhum lugar corresponde aos filtros." />
              )}
            </div>
            <div>
              <div className="mb-6 flex items-end justify-between">
                <h2 className="section-title">Próximos eventos</h2>
                <span className="text-[12px] text-mute">{result.events.length} eventos</span>
              </div>
              {result.events.length ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{result.events.map((e) => <EventCard key={e.id} event={e} />)}</div>
              ) : (
                <EmptyState title="Sem eventos no período" text="Tente outra data ou região." />
              )}
            </div>
          </div>
        )}
      </section>
      {base && <IndicatedRail venues={base.venues} stats={base.stats} className="pb-16 sm:pb-24" />}
    </>
  );
}
