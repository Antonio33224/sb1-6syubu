'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Download, Image as ImageIcon, MessageCircle, Share2 } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { Paywall } from '@/components/plus/PremiumGate';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { Photo } from '@/components/ui/Photo';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { formatScore } from '@/lib/rating';
import { computeRetrospective, shareText, yearsWithActivity, type Retrospective } from '@/lib/plus/retrospective';
import { renderShareCard } from '@/lib/plus/share-card';
import type { ActivityEntry } from '@/types';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function RetrospectivaPage() {
  const { user, authReady, data, version } = useApp();
  const { plus, isPremium, ready } = usePlus();
  const router = useRouter();
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    if (authReady && !user) router.replace('/entrar?next=/retrospectiva');
  }, [authReady, user, router]);

  const { data: base } = useAsync(async () => {
    if (!user) return null;
    const [reviews, activity, prefs] = await Promise.all([
      data.listReviews({ userId: user.id, sort: 'recent' }),
      plus.listActivity(),
      plus.getPreferences().catch(() => null),
    ]);
    const weights = prefs?.ranking_presets.find((p) => p.id === prefs.active_preset_id)?.weights ?? null;
    return { reviews, activity, weights };
  }, [data, plus, user?.id, version]);

  const years = useMemo(() => (base ? yearsWithActivity(base.reviews) : []), [base]);
  const current = year ?? years[0] ?? new Date().getFullYear();
  const retro = useMemo(() => (base ? computeRetrospective(base.reviews, current, base.weights) : null), [base, current]);

  if (!authReady || !user || !ready || !base || !retro) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;

  return (
    <>
      <section className="plus-glow border-b border-line">
        <div className="container-site py-14 sm:py-20">
          <div className="flex items-center gap-3">{isPremium && <PlusBadge size="md" />}<p className="eyebrow">Minha retrospectiva</p></div>
          <h1 className="mt-6 font-display text-[48px] font-extrabold uppercase leading-[0.88] tracking-tight sm:text-[96px]">
            Minha noite<br /><span className="text-blue">em {current}.</span>
          </h1>
          {years.length > 1 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {years.map((y) => <button key={y} onClick={() => setYear(y)} className={clsx('chip', y === current && 'chip-active')}>{y}</button>)}
            </div>
          )}
        </div>
      </section>

      <section className="container-site py-10 sm:py-14">
        {retro.reviews === 0 ? (
          <EmptyState title={`Nenhuma avaliação em ${current}`} text="Sua retrospectiva é montada só com as suas avaliações reais. Avalie suas noites para vê-la ganhar vida." action={{ href: '/avaliar', label: 'Avaliar uma experiência' }} />
        ) : (
          <>
            {/* Básico — disponível para todos */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
              <Big n={retro.venues} label={retro.venues === 1 ? 'Casa avaliada' : 'Casas avaliadas'} />
              <Big n={retro.reviews} label={retro.reviews === 1 ? 'Avaliação publicada' : 'Avaliações publicadas'} />
              <Big n={retro.photos} label={retro.photos === 1 ? 'Foto enviada' : 'Fotos enviadas'} />
              <Big n={retro.cities} label={retro.cities === 1 ? 'Cidade' : 'Cidades'} />
            </div>

            {isPremium ? <FullRetro retro={retro} username={user.username} /> : (
              <div className="mt-10">
                <Paywall feature="retrospectiva_completa" compact title="Sua retrospectiva completa está pronta" description="Veja sua casa nº 1, estilo favorito, nota média, critério mais valorizado, evolução mês a mês e gere o card para compartilhar no Instagram e no WhatsApp." />
              </div>
            )}

            <History entries={base.activity} />
          </>
        )}
      </section>
    </>
  );
}

function Big({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="bg-ink p-6 sm:p-8">
      <p className="font-display text-[44px] font-extrabold leading-none text-blue sm:text-[60px]">{n}</p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
    </div>
  );
}

function FullRetro({ retro, username }: { retro: Retrospective; username: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const maxCount = Math.max(1, ...retro.months.map((m) => m.count));
  const site = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const makeCard = async () => {
    setBusy(true);
    try {
      const blob = await renderShareCard(retro, username);
      setPreview(URL.createObjectURL(blob));
      return blob;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao gerar o card.', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const blob = await makeCard();
    if (!blob) return;
    const file = new File([blob], `minha-noite-${retro.year}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Minha noite em ${retro.year}`, text: shareText(retro, site) });
        return;
      }
    } catch {
      return; // compartilhamento cancelado
    }
    download(blob);
    toast('Card baixado. Publique nos stories do Instagram ou envie no WhatsApp.');
  };

  const download = (blob: Blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `minha-noite-${retro.year}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="mt-10 flex flex-col gap-10">
      <div className="grid gap-5 lg:grid-cols-3">
        {retro.topVenue && (
          <Link href={`/boates/${retro.topVenue.venue.slug}`} className="group relative overflow-hidden rounded-card border border-line lg:row-span-2">
            <div className="relative aspect-[4/5] lg:h-full lg:aspect-auto"><Photo src={retro.topVenue.venue.cover_image} alt={retro.topVenue.venue.name} /><div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" /></div>
            <div className="absolute inset-x-0 bottom-0 p-7">
              <p className="eyebrow text-blue">Minha casa nº 1</p>
              <p className="mt-3 font-display text-[34px] font-extrabold uppercase leading-[0.95] tracking-tight">{retro.topVenue.venue.name}</p>
              <p className="mt-2 text-[13px] text-mute">Minha nota: <span className="font-semibold text-blue">{formatScore(retro.topVenue.rating)}</span></p>
            </div>
          </Link>
        )}
        <Fact label="Meu estilo favorito" value={retro.favoriteStyle?.style ?? '—'} hint={retro.favoriteStyle ? `em ${retro.favoriteStyle.count} das casas avaliadas` : 'sem estilos cadastrados'} />
        <Fact label="Nota média que dei" value={retro.avgGiven !== null ? formatScore(retro.avgGiven) : '—'} />
        <Fact
          label={retro.mostValued ? 'Critério que mais valorizo' : 'Critério mais bem avaliado por mim'}
          value={retro.mostValued?.label ?? retro.topCriterion?.label ?? '—'}
          hint={retro.mostValued ? `peso ${retro.mostValued.weight} no Meu Ranking` : retro.topCriterion ? `média ${formatScore(retro.topCriterion.avg)}` : undefined}
        />
        <Fact label="Casas avaliadas" value={String(retro.venues)} hint={`${retro.cities} ${retro.cities === 1 ? 'cidade' : 'cidades'}`} />
      </div>

      <div className="card p-6 sm:p-8">
        <p className="eyebrow">Evolução das avaliações em {retro.year}</p>
        <div className="mt-8 grid h-48 grid-cols-12 items-end gap-2">
          {retro.months.map((m) => (
            <div key={m.month} className="flex h-full flex-col items-center justify-end gap-2" title={`${MONTHS[m.month]}: ${m.count} avaliações${m.avg !== null ? `, média ${m.avg}` : ''}`}>
              {m.avg !== null && <span className="text-[10px] font-semibold text-blue">{m.avg.toFixed(1)}</span>}
              <span className={clsx('w-full rounded-t-sm', m.count ? 'bg-blue' : 'bg-line')} style={{ height: `${m.count ? Math.max(8, (m.count / maxCount) * 100) : 4}%` }} />
              <span className="text-[10px] text-mute">{MONTHS[m.month]}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-mute">Altura = quantidade de avaliações no mês · número = sua nota média no mês.</p>
      </div>

      {retro.favorites.length > 0 && (
        <div>
          <p className="eyebrow">Minhas experiências favoritas</p>
          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {retro.favorites.map((f) => (
              <li key={f.review.id} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/boates/${f.venue.slug}`} className="font-display text-[16px] font-bold uppercase tracking-tight hover:text-blue">{f.venue.name}</Link>
                  <span className="font-display text-[22px] font-extrabold text-blue">{formatScore(f.review.overall_rating)}</span>
                </div>
                <p className="mt-1 text-[11px] text-mute">{formatDate(f.review.experience_date ?? f.review.created_at)}</p>
                {f.review.comment && <p className="mt-3 line-clamp-3 text-[13px] text-bone/80">“{f.review.comment}”</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="plus-frame plus-glow grid gap-8 p-7 sm:p-9 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="font-display text-[26px] font-extrabold uppercase leading-none tracking-tight">Compartilhe sua noite</p>
          <p className="mt-3 max-w-lg text-[13px] text-mute">Gere o card “Minha noite em {retro.year}” no formato stories, com os seus números reais.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={share} disabled={busy} className="btn-primary"><Share2 className="h-4 w-4" /> Compartilhar card</button>
            <button onClick={async () => { const b = await makeCard(); if (b) download(b); }} disabled={busy} className="btn-outline"><Download className="h-4 w-4" /> Baixar PNG</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText(retro, site))}`} target="_blank" rel="noopener noreferrer" className="btn-ghost"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
          </div>
        </div>
        <div className="mx-auto flex aspect-[9/16] w-[180px] items-center justify-center overflow-hidden rounded-card border border-line bg-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt={`Card Minha noite em ${retro.year}`} className="h-full w-full object-cover" /> : (
            <button onClick={makeCard} disabled={busy} className="flex flex-col items-center gap-2 text-[11px] text-mute hover:text-bone"><ImageIcon className="h-6 w-6" /> Pré-visualizar</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card flex flex-col justify-between p-6">
      <p className="text-[10px] font-bold uppercase tracking-nav text-mute">{label}</p>
      <div>
        <p className="mt-4 font-display text-[30px] font-extrabold uppercase leading-none tracking-tight">{value}</p>
        {hint && <p className="mt-2 text-[11px] text-mute">{hint}</p>}
      </div>
    </div>
  );
}

const ACTIVITY_LABEL: Record<ActivityEntry['kind'], string> = {
  review_published: 'Avaliação publicada',
  review_updated: 'Avaliação editada',
  benefit_redeemed: 'Benefício resgatado',
  subscription_started: 'Assinatura Classify+ iniciada',
  subscription_canceled: 'Assinatura cancelada',
};

function History({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="mt-14">
      <p className="eyebrow">Histórico pessoal</p>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {entries.slice(0, 40).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
            <span>
              <span className="font-semibold">{ACTIVITY_LABEL[e.kind]}</span>
              {typeof e.metadata.venue === 'string' && <span className="text-mute"> · {e.metadata.venue}</span>}
              {typeof e.metadata.benefit === 'string' && <span className="text-mute"> · {e.metadata.benefit}</span>}
              {typeof e.metadata.rating === 'number' && <span className="text-blue"> · {formatScore(e.metadata.rating)}</span>}
            </span>
            <span className="text-[11px] text-mute">{formatDate(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
