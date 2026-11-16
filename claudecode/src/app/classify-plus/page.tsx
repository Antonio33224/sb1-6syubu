'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Activity, ArrowRight, Bell, Check, Gift, History, Minus, SlidersHorizontal, Sparkles, Trophy, X } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { PlanCards } from '@/components/plus/PlanCards';
import { PlusBadge, PlusWordmark } from '@/components/plus/PlusBadge';
import { Photo } from '@/components/ui/Photo';
import { useAsync } from '@/hooks/useAsync';
import { formatScore } from '@/lib/rating';
import { rankByPreferences } from '@/lib/plus/personal-ranking';
import { CRITERIA, type CriteriaWeights } from '@/types';

const COMPARISON: [string, string | boolean, string | boolean][] = [
  ['Rankings e avaliações', true, true],
  ['Enviar fotos e avaliar', true, true],
  ['Meu Ranking personalizado', false, true],
  ['Filtros avançados', 'Básicos', 'Completos'],
  ['Alertas personalizados', false, true],
  ['Pulso da Noite', false, true],
  ['Histórico pessoal', 'Básico', 'Completo'],
  ['Benefícios em parceiros', false, true],
  ['Banners de terceiros', 'Sim', 'Não'],
];

const FAQ = [
  ['Avaliar continua gratuito?', 'Sim. Avaliar, enviar fotos, comentar e consultar rankings, notas, agenda e preços são e continuarão gratuitos para todos.'],
  ['Assinantes têm mais peso nas notas?', 'Não. Todas as avaliações têm exatamente o mesmo peso no ranking público. O Meu Ranking recalcula as notas apenas na sua tela, com os seus pesos — o ranking da comunidade não muda.'],
  ['Como funciona o teste grátis?', 'O plano mensal tem 7 dias grátis para quem nunca fez o teste com a conta. Se você cancelar durante o teste, não há cobrança. O teste não pode ser repetido na mesma conta.'],
  ['Posso cancelar quando quiser?', 'Sim, em “Minha assinatura”. O cancelamento interrompe a renovação e você mantém o acesso até o fim do período já pago.'],
  ['Os estabelecimentos “Indicados” somem para assinantes?', 'Não. Cards “INDICADO” fazem parte da curadoria e aparecem para todos, sempre identificados. O que some para assinantes são os banners publicitários de terceiros.'],
  ['Meus dados de cartão ficam com o Classify DJ?', 'Não. O pagamento é feito no ambiente seguro do gateway; o Classify DJ recebe apenas a confirmação e o status da assinatura.'],
];

export default function ClassifyPlusPage() {
  const { isPremium } = usePlus();
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/lasers.jpg" alt="" className="photo h-full w-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/40" />
          <div className="plus-glow absolute inset-0" />
        </div>
        <div className="container-site relative flex min-h-[78vh] flex-col justify-center py-20">
          <div className="animate-fade-up"><PlusBadge size="lg" /></div>
          <h1 className="mt-8 max-w-5xl animate-fade-up font-display text-[52px] font-extrabold uppercase leading-[0.86] tracking-tight sm:text-[88px] lg:text-[120px]">
            Your night.<br /><span className="plus-text plus-sheen">Your rules.</span>
          </h1>
          <p className="mt-8 max-w-xl animate-fade-up text-[17px] leading-relaxed text-bone/85 [animation-delay:120ms]">
            Não descubra apenas as melhores boates. Descubra as melhores boates <strong className="text-blue">PARA VOCÊ</strong>.
          </p>
          <div className="mt-10 flex animate-fade-up flex-wrap gap-3 [animation-delay:200ms]">
            {isPremium ? (
              <Link href="/meu-ranking" className="btn-primary">Abrir Meu Ranking <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <a href="#planos" className="btn-primary">Quero ser Classify+ <ArrowRight className="h-4 w-4" /></a>
            )}
            <a href="#comparativo" className="btn-outline">Grátis vs Classify+</a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 1. apresentação */}
      <section className="container-site py-20 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-end">
          <div>
            <p className="eyebrow">O que é</p>
            <h2 className="mt-4 font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[52px]">
              O Classify gratuito ajuda a descobrir a noite.<br /><PlusWordmark /> ajuda a descobrir a noite perfeita.
            </h2>
          </div>
          <p className="text-[15px] leading-relaxed text-mute">
            O ranking da comunidade mostra as melhores casas segundo todo mundo. O Classify+ entende as suas preferências, recalcula as notas com os seus pesos,
            avisa quando seus DJs favoritos tocam, mostra o que está acontecendo agora e oferece vantagens em casas parceiras.
          </p>
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {[
            [Trophy, 'Meu Ranking', 'Pesos de 0 a 100 para os 7 critérios. Sua nota, seu top.'],
            [SlidersHorizontal, 'Filtros avançados', 'Gasto médio, público, capacidade, horário, dia e nota por critério.'],
            [Bell, 'Alertas', 'Seu DJ favorito vai tocar? Você fica sabendo.'],
            [Activity, 'Pulso da Noite', 'As avaliações das últimas horas, com tendências reais.'],
            [History, 'Retrospectiva', 'Sua noite em números, pronta para compartilhar.'],
            [Gift, 'Benefícios', 'Vantagens em casas parceiras.'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof Trophy;
            return (
              <div key={t as string} className="group bg-ink p-7 transition-colors hover:bg-ink-2">
                <I className="h-5 w-5 text-blue" strokeWidth={1.6} />
                <p className="mt-5 font-display text-[18px] font-bold uppercase tracking-tight">{t as string}</p>
                <p className="mt-2 text-[13px] text-mute">{d as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ 2. demo meu ranking */}
      <RankingDemo />

      {/* ------------------------------------------------------------ 3. comparativo */}
      <section id="comparativo" className="container-site scroll-mt-24 py-20 sm:py-28">
        <p className="eyebrow">Comparação</p>
        <h2 className="section-title mt-3">Grátis vs Classify+</h2>
        <div className="mt-10 overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[520px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-5 py-4 text-[10px] font-bold uppercase tracking-nav text-mute">Funcionalidade</th>
                <th className="px-5 py-4 text-center text-[10px] font-bold uppercase tracking-nav text-mute">Grátis</th>
                <th className="bg-blue-soft px-5 py-4 text-center"><PlusBadge size="xs" /></th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([f, free, plus]) => (
                <tr key={f} className="border-b border-line last:border-0">
                  <td className="px-5 py-4 text-bone/90">{f}</td>
                  <td className="px-5 py-4 text-center"><Cell v={free} /></td>
                  <td className="bg-blue-soft px-5 py-4 text-center"><Cell v={plus} strong /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------------------ 4/5. filtros + pulso */}
      <section className="border-y border-line bg-ink-2">
        <div className="container-site grid gap-6 py-20 sm:py-28 lg:grid-cols-2">
          <div className="plus-frame p-7 sm:p-9">
            <SlidersHorizontal className="h-5 w-5 text-blue" />
            <h3 className="mt-5 font-display text-[28px] font-extrabold uppercase leading-none tracking-tight">Filtros avançados</h3>
            <p className="mt-3 text-[13px] text-mute">Combine quantos quiser. Casas sem a informação cadastrada não entram no filtro — nada é estimado.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['Gasto médio até R$ 150', 'Techno', 'Público underground', 'Aberto à 01:00', 'Sábado', 'Música 9+', 'Organização 8+', 'Até 5 km', 'Capacidade intimista'].map((c) => (
                <span key={c} className="chip chip-active h-8 px-3 text-[9px]">{c}</span>
              ))}
            </div>
            <Link href="/descobrir" className="link-arrow mt-8">Ver no Descobrir <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="plus-frame p-7 sm:p-9">
            <Activity className="h-5 w-5 text-blue" />
            <h3 className="mt-5 font-display text-[28px] font-extrabold uppercase leading-none tracking-tight">Pulso da Noite</h3>
            <p className="mt-3 text-[13px] text-mute">As avaliações publicadas nas últimas horas: mais bem avaliadas, maior crescimento, melhores em música e em bebidas e preços, e as experiências mais recentes da comunidade — com horário de atualização.</p>
            <p className="mt-4 text-[12px] text-bone/80">Sem achismo: não inventamos lotação nem movimento. Se não houver avaliações recentes, mostramos que não há dados.</p>
            <Link href="/pulso" className="link-arrow mt-8">Conhecer o Pulso <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 6. benefícios */}
      <BenefitsTeaser />

      {/* ------------------------------------------------------------ 7. planos */}
      <section id="planos" className="plus-glow scroll-mt-24 border-y border-line">
        <div className="container-site py-20 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Planos e preços</p>
            <h2 className="mt-3 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[56px]">Escolha seu plano</h2>
          </div>
          <div className="mx-auto mt-12 max-w-4xl"><PlanCards /></div>
        </div>
      </section>

      {/* ------------------------------------------------------------ 8. FAQ */}
      <section className="container-site py-20 sm:py-28">
        <p className="eyebrow">Perguntas frequentes</p>
        <h2 className="section-title mt-3">FAQ</h2>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-display text-[16px] font-bold uppercase tracking-tight sm:text-[18px]">
                {q}
                <span className="text-[20px] text-blue transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-mute">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ 9. CTA final */}
      <section className="relative overflow-hidden border-t border-line">
        <div className="plus-glow absolute inset-0" />
        <div className="container-site relative flex flex-col items-center py-24 text-center sm:py-32">
          <PlusBadge size="md" />
          <h2 className="mt-8 font-display text-[44px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[72px]">Sua noite.<br />Seu ranking.</h2>
          {isPremium ? (
            <Link href="/meu-ranking" className="btn-primary mt-10">Abrir Meu Ranking <ArrowRight className="h-4 w-4" /></Link>
          ) : (
            <a href="#planos" className="btn-primary mt-10">Quero ser Classify+ <ArrowRight className="h-4 w-4" /></a>
          )}
        </div>
      </section>
    </>
  );
}

function Cell({ v, strong }: { v: string | boolean; strong?: boolean }) {
  if (v === true) return <Check className={clsx('mx-auto h-4 w-4', strong ? 'text-blue' : 'text-bone')} aria-label="Sim" />;
  if (v === false) return <X className="mx-auto h-4 w-4 text-mute/60" aria-label="Não" />;
  return <span className={clsx('text-[12px] font-semibold uppercase tracking-nav', strong ? 'text-blue' : 'text-mute')}>{v}</span>;
}

/** Demonstração interativa com dados reais (sem salvar). */
function RankingDemo() {
  const { data, version } = useApp();
  const { data: base } = useAsync(async () => {
    const [venues, stats] = await Promise.all([data.listVenues(), data.getAllStats()]);
    return { venues, stats };
  }, [data, version]);
  const [w, setW] = useState({ music: 100, drinks: 50, organization: 30 });
  const weights: CriteriaWeights = { music_rating: w.music, crowd_rating: 50, atmosphere_rating: 50, drinks_rating: w.drinks, service_rating: 50, organization_rating: w.organization, experience_rating: 50 };
  const rows = useMemo(() => (base ? rankByPreferences(base.venues, base.stats, weights, { minReviews: 5, limit: 4 }) : []), [base, weights]); // eslint-disable-line react-hooks/exhaustive-deps

  const sliders: { k: keyof typeof w; label: string }[] = [
    { k: 'music', label: CRITERIA[0].label },
    { k: 'drinks', label: CRITERIA[3].label },
    { k: 'organization', label: CRITERIA[5].label },
  ];

  return (
    <section className="border-y border-line bg-ink-2">
      <div className="container-site grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <p className="eyebrow flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-blue" /> Demonstração do Meu Ranking</p>
          <h2 className="mt-4 font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[48px]">Mexa nos pesos.<br />Veja o seu top mudar.</h2>
          <p className="mt-5 max-w-md text-[14px] text-mute">Prévia com dados reais da comunidade e 3 dos 7 critérios (os demais ficam em 50). No Classify+ você controla todos e salva várias configurações.</p>
          <div className="mt-8 flex max-w-md flex-col gap-5">
            {sliders.map((s) => (
              <label key={s.k} className="block">
                <span className="mb-2 flex justify-between text-[13px] font-semibold">
                  {s.label} <span className="font-display text-blue">{w[s.k]}</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={w[s.k]} onChange={(e) => setW({ ...w, [s.k]: Number(e.target.value) })}
                  className="plus-range" style={{ background: `linear-gradient(90deg, #83A9F5 ${w[s.k]}%, #292929 ${w[s.k]}%)` }} />
              </label>
            ))}
          </div>
        </div>
        <ol className="flex flex-col gap-3">
          {rows.length ? rows.map((r) => (
            <li key={r.venue.id} className="flex items-center gap-4 rounded-card border border-line bg-ink p-3 pr-5 transition-all">
              <span className="w-8 text-center font-display text-[24px] font-extrabold text-blue">{r.position}</span>
              <span className="relative hidden h-14 w-14 overflow-hidden rounded-sm sm:block"><Photo src={r.venue.cover_image} alt="" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-bold uppercase tracking-tight">{r.venue.name}</span>
                <span className="text-[11px] text-mute">Pública {formatScore(r.public)} <Minus className="inline h-3 w-3" /> {r.match}% compatível</span>
              </span>
              <span className="font-display text-[26px] font-extrabold text-blue">{formatScore(r.personal)}</span>
            </li>
          )) : <li className="card p-6 text-[13px] text-mute">Ainda não há casas com avaliações suficientes para a prévia.</li>}
        </ol>
      </div>
    </section>
  );
}

function BenefitsTeaser() {
  const { plus } = usePlus();
  const { data: list } = useAsync(() => plus.listBenefits(), [plus]);
  const available = (list ?? []).filter((b) => b.availability === 'disponivel').slice(0, 3);
  return (
    <section className="container-site py-20 sm:py-28">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Benefícios exclusivos</p>
          <h2 className="section-title mt-3">Vantagens em casas parceiras</h2>
        </div>
        <Link href="/beneficios" className="link-arrow">Ver benefícios <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      <p className="mt-4 max-w-2xl text-[14px] text-mute">Entrada antecipada, lista VIP, desconto em ingressos, drink de cortesia e acesso a áreas especiais — conforme as parcerias vigentes.</p>
      {available.length ? (
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {available.map(({ benefit, venueName }) => (
            <div key={benefit.id} className="group relative overflow-hidden rounded-card border border-line">
              <div className="relative aspect-[16/10]"><Photo src={benefit.image_url || '/images/club-tunnel.jpg'} alt={venueName} /><div className="absolute inset-0 bg-gradient-to-t from-ink to-transparent" /></div>
              <div className="absolute inset-x-0 bottom-0 p-5">
                {benefit.is_demo && <span className="mb-2 inline-block rounded-sm border border-bone/40 px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-nav text-bone">Exemplo</span>}
                <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">{venueName}</p>
                <p className="mt-1 font-display text-[18px] font-bold uppercase tracking-tight">{benefit.title}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-10 rounded-card border border-line p-6 text-[13px] text-mute">Novas parcerias estão sendo preparadas. Os benefícios vigentes aparecem aqui assim que forem publicados.</p>
      )}
      {available.some((b) => b.benefit.is_demo) && <p className="mt-4 text-[11px] text-mute">Itens marcados como “Exemplo” são demonstrativos e não representam acordos reais.</p>}
    </section>
  );
}
