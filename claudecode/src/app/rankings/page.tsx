'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { PageIntro, EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { FilterSelect, Tabs } from '@/components/ui/Controls';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { ApprovedBadge } from '@/components/brand/ApprovedSeal';
import { useAsync } from '@/hooks/useAsync';
import { CATEGORY_LABEL, priceLabel } from '@/lib/format';
import { brl, hasAvgPrice } from '@/lib/pricing';
import type { RankingCategory, RankingPeriod, RankingRow } from '@/types';

const CATEGORIES: { value: RankingCategory; label: string }[] = [
  { value: 'all', label: 'Geral' },
  { value: 'boates', label: 'Top boates' },
  { value: 'festas', label: 'Top festas' },
  { value: 'festivais', label: 'Top festivais' },
  { value: 'experiencias', label: 'Top experiências' },
  { value: 'hype', label: 'Mais hypadas' },
  { value: 'ascensao', label: 'Em ascensão' },
];

type View = 'geral' | 'cidade' | 'semana' | 'mes' | 'historico';
const VIEWS: { value: View; label: string }[] = [
  { value: 'geral', label: 'Ranking geral' },
  { value: 'cidade', label: 'Da cidade' },
  { value: 'semana', label: 'Da semana' },
  { value: 'mes', label: 'Do mês' },
  { value: 'historico', label: 'Histórico' },
];

const CATEGORY_HINT: Partial<Record<RankingCategory, string>> = {
  hype: 'Volume de avaliações e curtidas nos últimos 30 dias.',
  ascensao: 'Maior evolução da nota nos últimos 30 dias em relação ao histórico.',
};

export default function RankingsPage() {
  const { data, version } = useApp();
  const [category, setCategory] = useState<RankingCategory>('all');
  const [view, setView] = useState<View>('geral');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [minRating, setMinRating] = useState('0');

  const { data: cities } = useAsync(() => data.listCities(), [data]);
  const states = useMemo(() => [...new Set((cities ?? []).map((c) => c.state))].sort(), [cities]);
  const effectiveCity = view === 'cidade' ? city || 'Rio de Janeiro' : city;
  const period: RankingPeriod = view === 'semana' ? 'semana' : view === 'mes' ? 'mes' : view === 'historico' ? 'historico' : 'geral';

  const { data: rows, loading, error, reload } = useAsync(
    () =>
      data.getRankings({
        category,
        period,
        city: effectiveCity || undefined,
        state: state || undefined,
        minRating: Number(minRating) || undefined,
      }),
    [data, version, category, period, effectiveCity, state, minRating],
  );

  return (
    <>
      <PageIntro
        eyebrow="Classificação Classify"
        title={<>The night<br />rankings.</>}
        subtitle="As melhores experiências noturnas, classificadas por quem vive a noite."
        image="/images/stage-glow.jpg"
      />

      <section className="container-site py-10 sm:py-14">
        <Tabs value={category} onChange={setCategory} items={CATEGORIES} />

        <div className="mt-8 grid gap-4 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-[2.4fr_1fr_1fr_1fr]">
          <div className="min-w-0 sm:col-span-3 lg:col-span-1">
            <span className="field-label">Período e escopo</span>
            <Tabs value={view} onChange={setView} items={VIEWS} />
          </div>
          <FilterSelect
            label="Cidade"
            value={effectiveCity}
            onChange={(v) => {
              setCity(v);
              if (!v && view === 'cidade') setView('geral');
            }}
            options={[{ value: '', label: 'Todas as cidades' }, ...(cities ?? []).map((c) => ({ value: c.city, label: c.city }))]}
          />
          <FilterSelect label="Estado" value={state} onChange={setState} options={[{ value: '', label: 'Todos os estados' }, ...states.map((s) => ({ value: s, label: s }))]} />
          <FilterSelect
            label="Nota mínima"
            value={minRating}
            onChange={setMinRating}
            options={[
              { value: '0', label: 'Qualquer nota' },
              { value: '7', label: '7.0+' },
              { value: '8', label: '8.0+' },
              { value: '8.5', label: '8.5+' },
              { value: '9', label: '9.0+' },
            ]}
          />
        </div>

        <p className="mt-6 text-[12px] leading-relaxed text-mute">
          {CATEGORY_HINT[category] ??
            'Posição calculada por média bayesiana ponderada por recência e confiabilidade — não apenas pela maior média.'}{' '}
          <Link href="/editorial/como-calculamos-os-rankings" className="text-bone underline decoration-line underline-offset-4 hover:text-blue">
            Como calculamos
          </Link>
        </p>

        <div className="mt-8">
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading && !rows ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[104px]" />
              ))}
            </div>
          ) : rows && rows.length ? (
            <ol className="flex flex-col">
              {rows.map((row, i) => (
                <RankingListItem key={row.venue.id} row={row} index={i} period={period} />
              ))}
            </ol>
          ) : (
            <EmptyState title="Nenhum resultado" text="Não há avaliações suficientes para esses filtros. Tente ampliar o período ou a região." />
          )}
        </div>
      </section>
    </>
  );
}

function RankingListItem({ row, index, period }: { row: RankingRow; index: number; period: RankingPeriod }) {
  const { venue, stats, position, change } = row;
  return (
    <li className="animate-fade-up border-b border-line first:border-t" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <Link href={`/boates/${venue.slug}`} className="group grid grid-cols-[44px_1fr_auto] items-center gap-4 py-5 sm:grid-cols-[72px_140px_1fr_auto] sm:gap-6">
        <div className="flex flex-col items-start">
          <span className={`font-display text-[30px] font-extrabold leading-none tracking-tight sm:text-[40px] ${position <= 3 ? 'text-bone' : 'text-bone/45'}`}>
            {String(position).padStart(2, '0')}
          </span>
          <ChangeIndicator change={change} />
        </div>
        <div className="hidden h-[84px] overflow-hidden rounded-[4px] sm:block">
          <Photo src={venue.cover_image} alt={venue.name} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="truncate font-display text-[17px] font-bold uppercase tracking-tight transition-colors group-hover:text-blue sm:text-[21px]">{venue.name}</h3>
            {venue.approved && <ApprovedBadge compact className="hidden sm:inline-flex" />}
          </div>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-nav text-mute">
            {CATEGORY_LABEL[venue.category]} · {venue.neighborhood} · {venue.city}
          </p>
          <p className="mt-2 text-[11px] font-semibold text-blue">
            {hasAvgPrice(venue) ? (
              <>Média {brl(venue.avg_price)} <span className="font-normal text-mute">/pessoa</span></>
            ) : (
              <span className="font-normal text-mute">{priceLabel(venue.price_range)} · média não informada</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <Score value={stats.avg_rating} size="md" />
          <p className="mt-1.5 text-[11px] text-mute">
            {stats.review_count.toLocaleString('pt-BR')} {stats.review_count === 1 ? 'avaliação' : 'avaliações'}
            {period === 'semana' || period === 'mes' ? ' no período' : ''}
          </p>
        </div>
      </Link>
    </li>
  );
}

function ChangeIndicator({ change }: { change: number | null }) {
  if (change === null) return <span className="mt-1.5 text-[9px] font-bold uppercase tracking-nav text-blue">Novo</span>;
  if (change === 0)
    return (
      <span className="mt-1.5 inline-flex items-center text-mute" title="Sem variação na semana">
        <Minus className="h-3 w-3" />
      </span>
    );
  const up = change > 0;
  return (
    <span className={`mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold ${up ? 'text-blue' : 'text-mute'}`} title={`${up ? 'Subiu' : 'Caiu'} ${Math.abs(change)} posições em 7 dias`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(change)}
    </span>
  );
}
