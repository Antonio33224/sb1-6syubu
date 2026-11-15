'use client';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, MapPin } from 'lucide-react';
import { ApprovedBadge } from '@/components/brand/ApprovedSeal';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { DemoTag, EmptyState, Skeleton } from '@/components/ui/States';
import { PriceTag } from '@/components/venue/PriceDisplay';
import type { RankingRow } from '@/types';
import { HomeSectionTitle } from './HomeSectionTitle';

export function TopVenues({ rows, city }: { rows: RankingRow[] | null; city: string }) {
  const top = rows?.slice(0, 5) ?? null;
  return (
    <section className="relative border-t border-line bg-ink-2 py-16 sm:py-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue/50 to-transparent" />
      <div className="container-site">
        <HomeSectionTitle
          index="02"
          eyebrow={city ? `Mais bem avaliadas · ${city}` : 'Mais bem avaliadas'}
          title={<>As melhores<br className="hidden sm:block" /> da noite</>}
          text="Classificação pela nota da comunidade, com peso para confiabilidade e avaliações recentes."
          href="/descobrir"
          linkLabel="Ver todas as boates"
        />
        {!top ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Skeleton className="aspect-[4/5] md:col-span-2 md:row-span-2 md:aspect-auto" />
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[4/3]" />)}
          </div>
        ) : top.length === 0 ? (
          <EmptyState title="Ranking em formação" text="Assim que houver avaliações, as melhores casas aparecem aqui." action={{ href: '/avaliar', label: 'Fazer uma avaliação' }} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {top.map((row, i) => (
              <VenueTile key={row.venue.id} row={row} big={i === 0} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VenueTile({ row, big, index }: { row: RankingRow; big: boolean; index: number }) {
  const { venue, stats, position, change } = row;
  return (
    <Link
      href={`/boates/${venue.slug}`}
      style={{ animationDelay: `${index * 70}ms` }}
      className={clsx(
        'group relative block animate-fade-up overflow-hidden rounded-card border border-line bg-panel transition-colors duration-500 hover:border-blue/50',
        big ? 'aspect-[4/5] sm:col-span-2 sm:aspect-[16/11] lg:row-span-2 lg:aspect-auto lg:min-h-[560px]' : 'aspect-[4/3.4]',
      )}
    >
      <Photo src={venue.cover_image} alt={venue.name} priority={big} />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/20" />

      {/* Posição */}
      <div className="absolute left-0 top-0 flex items-start gap-3 p-4 sm:p-5">
        <span
          className={clsx(
            'font-display font-extrabold leading-[0.8] tracking-[-0.05em]',
            big ? 'text-[96px] sm:text-[140px]' : 'text-[56px]',
            position <= 3 ? 'text-bone' : 'text-bone/70',
          )}
        >
          {String(position).padStart(2, '0')}
        </span>
        <div className="mt-2 flex flex-col items-start gap-2">
          <RankIndicator change={change} />
          {venue.is_demo && <DemoTag className="bg-ink/60" />}
        </div>
      </div>
      {venue.approved && <ApprovedBadge compact className="absolute right-4 top-4 sm:right-5 sm:top-5" />}

      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className={clsx('font-display font-extrabold uppercase leading-[0.95] tracking-tight transition-colors group-hover:text-blue', big ? 'text-[34px] sm:text-[48px]' : 'text-[19px]')}>
              {venue.name}
            </h3>
            <p className="mt-2 flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-nav text-bone/70">
              <MapPin className="h-3 w-3 shrink-0" /> {venue.neighborhood} · {venue.city}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <Score value={stats.avg_rating} size={big ? 'lg' : 'sm'} />
            <p className="mt-1 text-[10px] text-mute">{stats.review_count.toLocaleString('pt-BR')} aval.</p>
          </div>
        </div>
        <div className={clsx('flex items-center justify-between gap-3 border-t border-bone/10', big ? 'mt-4 pt-4' : 'mt-3 pt-3')}>
          <PriceTag venue={venue} tone="glass" />
          {big && <span className="text-[10px] font-bold uppercase tracking-nav text-blue">Líder do ranking</span>}
        </div>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-blue transition-transform duration-700 group-hover:scale-x-100" />
    </Link>
  );
}

function RankIndicator({ change }: { change: number | null }) {
  if (change === null) return <span className="rounded-sm bg-blue px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-nav text-ink">Novo</span>;
  if (change === 0) return <span className="text-[9px] font-bold uppercase tracking-nav text-mute">= 7d</span>;
  const up = change > 0;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-[10px] font-bold', up ? 'text-blue' : 'text-mute')} title={`${up ? 'Subiu' : 'Caiu'} ${Math.abs(change)} posições em 7 dias`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(change)}
    </span>
  );
}
