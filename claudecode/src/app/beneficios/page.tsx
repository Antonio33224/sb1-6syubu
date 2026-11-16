'use client';
import Link from 'next/link';
import { useState } from 'react';
import { clsx } from 'clsx';
import { CalendarClock, Copy, Gift, Lock, Ticket } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { Photo } from '@/components/ui/Photo';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import type { BenefitWithMeta } from '@/types';

const AVAILABILITY: Record<BenefitWithMeta['availability'], { label: string; tone: string }> = {
  disponivel: { label: 'Disponível', tone: 'border-blue text-blue' },
  esgotado: { label: 'Esgotado', tone: 'border-line text-mute' },
  expirado: { label: 'Expirado', tone: 'border-line text-mute' },
  inativo: { label: 'Indisponível', tone: 'border-line text-mute' },
};

export default function BeneficiosPage() {
  const { version } = useApp();
  const { plus, isPremium } = usePlus();
  const { data: list, reload } = useAsync(() => plus.listBenefits(), [plus, version]);
  const hasDemo = list?.some((b) => b.benefit.is_demo);

  return (
    <>
      <section className="plus-glow border-b border-line">
        <div className="container-site py-14 sm:py-20">
          <div className="flex items-center gap-3"><PlusBadge size="md" /><p className="eyebrow">Benefícios Classify+</p></div>
          <h1 className="mt-6 font-display text-[44px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[80px]">Vantagens<br />na noite.</h1>
          <p className="mt-6 max-w-xl text-[15px] text-mute">Entrada antecipada, lista VIP, descontos e cortesias em casas parceiras — exclusivos para assinantes.</p>
          {!isPremium && <Link href="/classify-plus#planos" className="btn-primary mt-8">Quero ser Classify+</Link>}
        </div>
      </section>
      <section className="container-site py-10 sm:py-14">
        {hasDemo && (
          <p className="mb-8 rounded-card border border-bone/30 px-5 py-4 text-[13px]">
            <strong className="font-bold uppercase tracking-nav">Exemplos demonstrativos.</strong>{' '}
            <span className="text-mute">Os benefícios marcados como “Exemplo” ilustram o formato e não representam acordos reais com os estabelecimentos.</span>
          </p>
        )}
        {!list ? (
          <div className="grid gap-5 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-96" />)}</div>
        ) : list.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {list.map((b) => <BenefitCard key={b.benefit.id} item={b} onRedeemed={reload} />)}
          </div>
        ) : (
          <EmptyState title="Nenhum benefício publicado" text="Novas parcerias estão sendo preparadas. Os benefícios vigentes aparecem aqui assim que forem publicados." />
        )}
      </section>
    </>
  );
}

function BenefitCard({ item, onRedeemed }: { item: BenefitWithMeta; onRedeemed: () => void }) {
  const { user } = useApp();
  const { plus, isPremium } = usePlus();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(item.myRedemption?.code ?? null);
  const { benefit, venueName, venueSlug, availability } = item;
  const a = AVAILABILITY[availability];

  const redeem = async () => {
    setBusy(true);
    try {
      const r = await plus.redeemBenefit(benefit.id);
      setCode(r.code);
      toast('Benefício resgatado. Apresente o código conforme as instruções.');
      onRedeemed();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível resgatar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={clsx('flex flex-col overflow-hidden rounded-card border bg-panel', availability === 'disponivel' ? 'border-line' : 'border-line opacity-70')}>
      <div className="relative aspect-[16/8] overflow-hidden">
        <Photo src={benefit.image_url || '/images/club-tunnel.jpg'} alt={venueName} />
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-ink/30 to-transparent" />
        <div className="absolute left-4 top-4 flex gap-2">
          <PlusBadge size="xs" />
          {benefit.is_demo && <span className="inline-flex h-5 items-center rounded-sm bg-bone px-2 text-[8px] font-extrabold uppercase tracking-nav text-ink">Exemplo</span>}
        </div>
        <span className={clsx('absolute right-4 top-4 rounded-full border bg-ink/70 px-3 py-1 text-[9px] font-bold uppercase tracking-nav backdrop-blur-sm', a.tone)}>{a.label}</span>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div>
          {venueSlug ? <Link href={`/boates/${venueSlug}`} className="text-[10px] font-semibold uppercase tracking-nav text-mute hover:text-blue">{venueName}</Link> : <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">{venueName}</p>}
          <h2 className="mt-1.5 font-display text-[22px] font-extrabold uppercase leading-tight tracking-tight">{benefit.title}</h2>
          <p className="mt-2 text-[14px] text-bone/85">{benefit.description}</p>
        </div>
        <dl className="grid gap-3 text-[12px]">
          <div><dt className="font-bold uppercase tracking-nav text-mute">Regras</dt><dd className="mt-1 text-bone/80">{benefit.rules}</dd></div>
          <div><dt className="font-bold uppercase tracking-nav text-mute">Como resgatar</dt><dd className="mt-1 text-bone/80">{benefit.how_to_redeem}</dd></div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-mute">
            <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Válido até {formatDate(benefit.valid_until)}</span>
            {benefit.total_quantity !== null && <span className="flex items-center gap-1.5"><Ticket className="h-3.5 w-3.5" /> {Math.max(0, benefit.total_quantity - item.redeemed)} de {benefit.total_quantity} restantes</span>}
          </div>
        </dl>
        <div className="mt-auto border-t border-line pt-5">
          {code ? (
            <div className="flex items-center justify-between gap-3 rounded-card border border-blue/50 bg-blue-soft px-4 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-nav text-mute">Seu código{benefit.is_demo ? ' (demonstrativo, sem validade no local)' : ''}</p>
                <p className="mt-1 font-display text-[20px] font-extrabold tracking-wider text-blue">{code}</p>
              </div>
              <button onClick={() => { void navigator.clipboard?.writeText(code); toast('Código copiado.'); }} aria-label="Copiar código" className="text-mute hover:text-bone"><Copy className="h-4 w-4" /></button>
            </div>
          ) : !user ? (
            <Link href="/entrar?next=/beneficios" className="btn-outline btn-sm w-full">Entrar para resgatar</Link>
          ) : !isPremium ? (
            <Link href="/classify-plus#planos" className="btn-ghost btn-sm w-full"><Lock className="h-3.5 w-3.5" /> Exclusivo para assinantes</Link>
          ) : availability === 'disponivel' ? (
            <button onClick={redeem} disabled={busy} className="btn-primary btn-sm w-full"><Gift className="h-3.5 w-3.5" /> Resgatar benefício</button>
          ) : (
            <p className="text-center text-[12px] text-mute">Este benefício não está disponível para resgate.</p>
          )}
        </div>
      </div>
    </article>
  );
}
