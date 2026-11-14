'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { ClassifyMark } from '@/components/brand/ApprovedSeal';
import { RankingCard } from '@/components/cards/RankingCard';
import { Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';

export default function ApprovedPage() {
  const { data, version } = useApp();
  const { data: payload } = useAsync(async () => {
    const [settings, rows] = await Promise.all([data.getSettings(), data.getRankings({})]);
    return { settings, approved: rows.filter((r) => r.venue.approved) };
  }, [data, version]);
  const s = payload?.settings;

  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="container-site grid items-center gap-14 py-20 sm:py-28 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <p className="eyebrow">O selo das melhores festas</p>
            <h1 className="mt-6 font-display text-[48px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[84px]">
              ClassifyDJ
              <br />
              <span className="text-blue">Approved.</span>
            </h1>
            <p className="mt-8 max-w-lg text-[16px] leading-relaxed text-mute">
              Um selo que não se compra. Ele é concedido e retirado automaticamente pelo sistema, com base nas avaliações da comunidade.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <ClassifyMark className="h-56 w-56 sm:h-72 sm:w-72" strokeWidth={1.1} />
          </div>
        </div>
      </section>

      <section className="container-site py-16 sm:py-20">
        <h2 className="section-title">Critérios atuais</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
          {[
            { k: s ? s.approved_min_rating.toFixed(1) : '—', l: 'Nota mínima', d: 'Média geral das avaliações válidas.' },
            { k: s ? String(s.approved_min_reviews) : '—', l: 'Avaliações válidas', d: 'Volume mínimo para uma amostra confiável.' },
            { k: s ? `${Math.round(s.approved_max_flag_ratio * 100)}%` : '—', l: 'Limite de sinais', d: 'Máximo de avaliações denunciadas ou removidas — sem indícios relevantes de manipulação.' },
          ].map((c) => (
            <div key={c.l} className="bg-ink p-8">
              <p className="font-display text-[56px] font-extrabold leading-none text-blue">{c.k}</p>
              <p className="mt-4 text-[11px] font-bold uppercase tracking-nav">{c.l}</p>
              <p className="mt-2 text-[13px] text-mute">{c.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-mute">Parâmetros configuráveis pela administração da plataforma. O selo é reavaliado a cada nova avaliação, edição ou remoção.</p>
      </section>

      <section className="border-t border-line">
        <div className="container-site py-16 sm:py-20">
          <div className="mb-10 flex items-end justify-between">
            <h2 className="section-title">Selecionados</h2>
            <Link href="/rankings" className="link-arrow">Ver rankings <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          {!payload ? (
            <div className="grid gap-5 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3.1]" />)}</div>
          ) : payload.approved.length ? (
            <div className="grid gap-5 md:grid-cols-3">
              {payload.approved.map((r, i) => <RankingCard key={r.venue.id} row={{ ...r, position: i + 1 }} />)}
            </div>
          ) : (
            <p className="text-sm text-mute">Nenhum estabelecimento atende aos critérios no momento.</p>
          )}
        </div>
      </section>
    </>
  );
}
