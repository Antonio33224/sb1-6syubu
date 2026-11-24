'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Photo } from '@/components/ui/Photo';
import { Skeleton } from '@/components/ui/States';
import { brl, hasAvgPrice } from '@/lib/pricing';
import { priceLabel } from '@/lib/format';
import type { RankingRow, Venue, VenueStats } from '@/types';
import { HomeSectionTitle } from './HomeSectionTitle';
import type { HomeData } from './HomeView';

/** Mínimo de avaliações para entrar nas listas temáticas (evita amostras pequenas). */
const MIN_REVIEWS = 5;

type BoardKey = 'top10' | 'eletronica' | 'funk' | 'vip' | 'custo' | 'ambiente';

interface Board {
  key: BoardKey;
  label: string;
  hint: string;
  metricLabel: string;
}

const BOARDS: Board[] = [
  { key: 'top10', label: 'Top 10 da cidade', hint: 'Ranking geral NO OFF: média bayesiana ponderada por recência e confiabilidade.', metricLabel: 'Nota' },
  { key: 'eletronica', label: 'Música eletrônica', hint: 'Casas com house, techno ou eletrônica no line-up, ordenadas pela pontuação NO OFF.', metricLabel: 'Nota' },
  { key: 'funk', label: 'Funk', hint: 'Casas e festas com funk na programação, ordenadas pela pontuação NO OFF.', metricLabel: 'Nota' },
  { key: 'vip', label: 'Experiências VIP', hint: 'Casas de faixa premium (R$$$$), ordenadas pela nota de atendimento e experiência geral.', metricLabel: 'Atend. + exp.' },
  { key: 'custo', label: 'Custo-benefício', hint: 'Ordenado pelo critério “Bebidas e preços” avaliado pela comunidade.', metricLabel: 'Bebidas e preços' },
  { key: 'ambiente', label: 'Melhores ambientes', hint: 'Ordenado pelo critério “Ambiente” avaliado pela comunidade.', metricLabel: 'Ambiente' },
];

interface Entry {
  venue: Venue;
  metric: number;
  reviews: number;
}

export function RankingsBoard({ data, rows, city }: { data: HomeData | null; rows: RankingRow[] | null; city: string }) {
  const [active, setActive] = useState<BoardKey>('top10');

  const lists = useMemo<Record<BoardKey, Entry[]> | null>(() => {
    if (!data || !rows) return null;
    const eligible = data.venues
      .map((v) => ({ v, s: data.stats[v.id] }))
      .filter((x): x is { v: Venue; s: VenueStats } => !!x.s && x.s.review_count >= MIN_REVIEWS);
    const by = (filter: (v: Venue) => boolean, metric: (s: VenueStats) => number) =>
      eligible
        .filter((x) => filter(x.v))
        .map((x) => ({ venue: x.v, metric: metric(x.s), reviews: x.s.review_count, score: x.s.score }))
        .sort((a, b) => b.metric - a.metric || b.score - a.score)
        .slice(0, 5);
    const styles = (list: string[]) => (v: Venue) => v.music_styles.some((s) => list.includes(s));
    return {
      top10: rows.slice(0, 10).map((r) => ({ venue: r.venue, metric: r.stats.avg_rating, reviews: r.stats.review_count })),
      eletronica: by(styles(['Eletrônica', 'Techno', 'House']), (s) => s.avg_rating),
      funk: by(styles(['Funk']), (s) => s.avg_rating),
      vip: by((v) => v.price_range >= 4, (s) => (s.criteria.service_rating + s.criteria.experience_rating) / 2),
      custo: by(() => true, (s) => s.criteria.drinks_rating),
      ambiente: by(() => true, (s) => s.criteria.atmosphere_rating),
    };
  }, [data, rows]);

  const boards = BOARDS.map((b) => (b.key === 'top10' ? { ...b, label: city ? `Top 10 · ${city}` : 'Top 10 geral' } : b));
  const board = boards.find((b) => b.key === active)!;
  const entries = lists?.[active] ?? [];
  const leader = entries[0];

  return (
    <section className="relative border-t border-line bg-ink-2 py-16 sm:py-24">
      <div className="container-site">
        <HomeSectionTitle
          index="04"
          eyebrow={city ? `Classificação · ${city}` : 'Classificação'}
          title="Os rankings da noite"
          href="/rankings"
          linkLabel="Ranking completo"
        />

        <div className="grid gap-8 lg:grid-cols-[280px_1fr] lg:gap-12">
          {/* Seletor de listas */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0 lg:flex-col lg:flex-nowrap lg:gap-0 lg:border-y lg:border-line" role="tablist" aria-label="Rankings">
            {boards.map((b, i) => (
              <button
                key={b.key}
                role="tab"
                aria-selected={active === b.key}
                onClick={() => setActive(b.key)}
                className={clsx(
                  'chip shrink-0 lg:flex lg:h-auto lg:w-full lg:items-center lg:justify-between lg:rounded-none lg:border-0 lg:border-b lg:border-line lg:px-0 lg:py-4 lg:text-left lg:last:border-b-0',
                  active === b.key ? 'chip-active lg:text-red-bright' : 'lg:hover:text-bone',
                )}
              >
                <span className="flex items-center gap-3">
                  <span className="hidden font-display text-[11px] text-bone/30 lg:inline">{String(i + 1).padStart(2, '0')}</span>
                  {b.label}
                </span>
                <ArrowRight className={clsx('hidden h-3.5 w-3.5 transition-all lg:block', active === b.key ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0')} />
              </button>
            ))}
          </div>

          {/* Lista ativa */}
          <div className="min-w-0">
            {!lists ? (
              <Skeleton className="h-[480px]" />
            ) : entries.length === 0 ? (
              <div className="card px-6 py-16 text-center">
                <p className="font-display text-lg font-bold uppercase tracking-tight">Lista em formação</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-mute">
                  Ainda não há casas com pelo menos {MIN_REVIEWS} avaliações nesta categoria{city ? ` em ${city}` : ''}.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
                {leader && (
                  <Link href={`/boates/${leader.venue.slug}`} className="group relative hidden min-h-[420px] overflow-hidden rounded-card border border-line xl:block">
                    <Photo src={leader.venue.cover_image} alt={leader.venue.name} />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-ink/10" />
                    <span className="absolute left-6 top-4 font-display text-[180px] font-extrabold leading-none tracking-[-0.06em] text-bone/90">1</span>
                    <div className="absolute inset-x-0 bottom-0 p-6">
                      <p className="text-[10px] font-extrabold uppercase tracking-wide2 text-red-bright">{board.label}</p>
                      <h3 className="mt-2 font-display text-[36px] font-extrabold uppercase leading-[0.92] tracking-tight transition-colors group-hover:text-red-bright">{leader.venue.name}</h3>
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-nav text-bone/70">{leader.venue.neighborhood} · {leader.venue.city}</p>
                    </div>
                  </Link>
                )}
                <ol key={active} className="flex flex-col border-t border-line">
                  {entries.map((e, i) => (
                    <li key={e.venue.id} className="animate-fade-up border-b border-line" style={{ animationDelay: `${i * 45}ms` }}>
                      <Link href={`/boates/${e.venue.slug}`} className="group grid grid-cols-[64px_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[84px_1fr_auto]">
                        <span className={clsx('font-display text-[44px] font-extrabold leading-none tracking-[-0.05em] sm:text-[56px]', i === 0 ? 'text-red-bright' : i < 3 ? 'text-bone' : 'text-bone/35')}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-display text-[16px] font-bold uppercase tracking-tight transition-colors group-hover:text-red-bright sm:text-[19px]">{e.venue.name}</p>
                          <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-nav text-mute">
                            {e.venue.neighborhood} · {e.venue.city}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-red-bright/90">
                            {hasAvgPrice(e.venue) ? <>Média {brl(e.venue.avg_price)} <span className="font-normal text-mute">/pessoa</span></> : <span className="font-normal text-mute">{priceLabel(e.venue.price_range)} · média não informada</span>}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-[22px] font-bold leading-none text-red-bright sm:text-[26px]">{e.metric.toFixed(1)}</p>
                          <p className="mt-1 text-[9px] font-semibold uppercase tracking-nav text-mute">{board.metricLabel}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="mt-5 text-[11px] leading-relaxed text-mute">{board.hint}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
