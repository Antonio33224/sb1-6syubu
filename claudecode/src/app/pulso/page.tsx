'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Activity, ArrowDownRight, ArrowUpRight, Minus, RefreshCw, TrendingUp } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { PremiumGate } from '@/components/plus/PremiumGate';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { timeAgo } from '@/lib/format';
import { formatScore } from '@/lib/rating';
import { computePulse, PULSE_WINDOWS, type PulseVenueRow } from '@/lib/plus/night-pulse';

export default function PulsoPage() {
  return (
    <>
      <section className="plus-glow border-b border-line">
        <div className="container-site py-14 sm:py-20">
          <div className="flex items-center gap-3"><PlusBadge size="md" /><p className="eyebrow flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-blue" /></span>Pulso da Noite</p></div>
          <h1 className="mt-6 font-display text-[44px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[80px]">O que a noite<br />está dizendo agora.</h1>
          <p className="mt-6 max-w-xl text-[15px] text-mute">Avaliações publicadas pela comunidade nas últimas horas. Não estimamos lotação nem movimento — mostramos apenas o que foi avaliado.</p>
        </div>
      </section>
      <section className="container-site py-10 sm:py-14">
        <PremiumGate feature="pulso" description="Veja as casas mais bem avaliadas nas últimas horas, quem está crescendo e as experiências mais recentes da comunidade.">
          <Pulse />
        </PremiumGate>
      </section>
    </>
  );
}

function Pulse() {
  const { data, version } = useApp();
  const [hours, setHours] = useState<number>(24);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: base, loading } = useAsync(async () => {
    // Janela atual + janela anterior (para a taxa de crescimento).
    const sinceDays = Math.ceil((hours * 2) / 24);
    const [reviews, stats] = await Promise.all([data.listReviews({ sinceDays, sort: 'recent' }), data.getAllStats()]);
    return { reviews, stats, fetchedAt: Date.now() };
  }, [data, version, hours, refreshKey]);

  // Atualização automática a cada 2 minutos.
  useEffect(() => {
    const id = setInterval(() => setRefreshKey((k) => k + 1), 120_000);
    return () => clearInterval(id);
  }, []);

  const pulse = useMemo(() => (base ? computePulse(base.reviews, base.stats, hours, base.fetchedAt) : null), [base, hours]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Janela de tempo">
          {PULSE_WINDOWS.map((w) => (
            <button key={w.hours} role="tab" aria-selected={hours === w.hours} onClick={() => setHours(w.hours)} className={clsx('chip', hours === w.hours && 'chip-active')}>Últimas {w.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-mute">
          {pulse && <span>Atualizado em {new Date(pulse.generatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} className="btn-ghost btn-sm"><RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} /> Atualizar</button>
        </div>
      </div>

      {!pulse ? (
        <div className="mt-8 grid gap-5 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : pulse.total === 0 ? (
        <div className="mt-10 card flex flex-col items-center px-6 py-16 text-center">
          <Activity className="h-6 w-6 text-mute" />
          <p className="mt-4 font-display text-lg font-bold uppercase tracking-tight">Não há dados recentes disponíveis</p>
          <p className="mt-2 max-w-md text-sm text-mute">Nenhuma avaliação foi publicada nas últimas {PULSE_WINDOWS.find((w) => w.hours === hours)?.label}. Experimente uma janela maior — ou seja a primeira pessoa a avaliar a noite de hoje.</p>
          <Link href="/avaliar" className="btn-outline btn-sm mt-6">Avaliar agora</Link>
        </div>
      ) : (
        <>
          <p className="mt-6 text-[13px] text-mute"><span className="font-display text-[22px] font-extrabold text-blue">{pulse.total}</span> {pulse.total === 1 ? 'avaliação publicada' : 'avaliações publicadas'} na janela.</p>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Board title="Mais bem avaliadas" subtitle="Média geral na janela" rows={pulse.topRated} />
            <div className="card p-6">
              <p className="font-display text-[15px] font-extrabold uppercase tracking-tight">Maior crescimento de avaliações</p>
              <p className="mt-1 text-[11px] text-mute">Comparado à janela anterior de mesmo tamanho</p>
              {pulse.growth.length ? (
                <ul className="mt-5 divide-y divide-line">
                  {pulse.growth.map((g) => (
                    <li key={g.venue.id} className="flex items-center justify-between py-3 text-[13px]">
                      <Link href={`/boates/${g.venue.slug}`} className="truncate font-semibold hover:text-blue">{g.venue.name}</Link>
                      <span className="flex items-center gap-2 text-mute"><TrendingUp className="h-3.5 w-3.5 text-blue" /> {g.previous} → <span className="font-semibold text-bone">{g.count}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-5 text-[13px] text-mute">Nenhuma casa com aumento de avaliações em relação à janela anterior.</p>}
            </div>
            <Board title="Melhor em música" subtitle="Média de Música e DJs na janela" rows={pulse.bestMusic} metric />
            <Board title="Melhor custo-benefício" subtitle="Média de Bebidas e preços na janela" rows={pulse.bestValue} metric />
          </div>

          <div className="mt-12">
            <p className="eyebrow">Experiências recentes da comunidade</p>
            <ul className="mt-5 grid gap-4 md:grid-cols-2">
              {pulse.feed.map(({ item, highlight, vsVenue }) => (
                <li key={item.review.id} className="card flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/boates/${item.venue.slug}`} className="truncate font-display text-[15px] font-bold uppercase tracking-tight hover:text-blue">{item.venue.name}</Link>
                    <span className="font-display text-[22px] font-extrabold text-blue">{formatScore(item.review.overall_rating)}</span>
                  </div>
                  {item.review.comment && <p className="line-clamp-3 text-[13px] leading-relaxed text-bone/85">“{item.review.comment}”</p>}
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute">
                    <span className="flex items-center gap-2"><Avatar profile={item.author} size={18} /> {item.author.username}</span>
                    <span>{timeAgo(item.review.created_at)} · {new Date(item.review.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span>Destaque: {highlight.label} {formatScore(highlight.value)}</span>
                    {vsVenue !== null && <Trend value={vsVenue} label="vs. média da casa" />}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Board({ title, subtitle, rows, metric }: { title: string; subtitle: string; rows: PulseVenueRow[]; metric?: boolean }) {
  return (
    <div className="card p-6">
      <p className="font-display text-[15px] font-extrabold uppercase tracking-tight">{title}</p>
      <p className="mt-1 text-[11px] text-mute">{subtitle}</p>
      <ol className="mt-5 divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.venue.id} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-3 text-[13px]">
            <span className="font-display font-extrabold text-mute">{i + 1}</span>
            <span className="min-w-0">
              <Link href={`/boates/${r.venue.slug}`} className="block truncate font-semibold hover:text-blue">{r.venue.name}</Link>
              <span className="text-[11px] text-mute">{r.count} {r.count === 1 ? 'avaliação' : 'avaliações'}{r.trend !== null && !metric ? ' · ' : ''}{!metric && r.trend !== null && <Trend value={r.trend} label="tendência" />}</span>
            </span>
            <span className="font-display text-[18px] font-bold text-blue">{formatScore(metric ? r.value : r.avg)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Trend({ value, label }: { value: number; label: string }) {
  const Icon = value > 0.05 ? ArrowUpRight : value < -0.05 ? ArrowDownRight : Minus;
  return (
    <span className={clsx('inline-flex items-center gap-0.5', value > 0.05 ? 'text-blue' : 'text-mute')} title={`${label}: comparação com a média histórica pública`}>
      <Icon className="h-3 w-3" />{value > 0 ? '+' : ''}{value.toFixed(1)} {label}
    </span>
  );
}
