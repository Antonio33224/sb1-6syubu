'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Check, Minus, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { PremiumGate } from '@/components/plus/PremiumGate';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { FilterSelect } from '@/components/ui/Controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Photo } from '@/components/ui/Photo';
import { useAsync } from '@/hooks/useAsync';
import { formatScore } from '@/lib/rating';
import { uid } from '@/lib/format';
import {
  clampWeight,
  PUBLIC_WEIGHTS,
  publicPositions,
  rankByPreferences,
  totalWeight,
  WEIGHT_PRESETS,
  weightShares,
  type PersonalRow,
} from '@/lib/plus/personal-ranking';
import { CRITERIA, type CriteriaWeights, type RankingPreset } from '@/types';

/** Exemplo do briefing: perfil de quem ama música eletrônica e custo-benefício. */
const STARTER: CriteriaWeights = {
  music_rating: 100, crowd_rating: 70, atmosphere_rating: 60, drinks_rating: 90, service_rating: 40, organization_rating: 30, experience_rating: 100,
};

export default function MeuRankingPage() {
  return (
    <>
      <section className="plus-glow relative overflow-hidden border-b border-line">
        <div className="container-site py-14 sm:py-20">
          <div className="flex animate-fade-up items-center gap-3">
            <PlusBadge size="md" />
            <span className="eyebrow">Meu Ranking</span>
          </div>
          <h1 className="mt-6 max-w-4xl animate-fade-up font-display text-[44px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[72px] lg:text-[88px]">
            Your night.<br /><span className="text-blue">Your ranking.</span>
          </h1>
          <p className="mt-6 max-w-xl animate-fade-up text-[15px] leading-relaxed text-mute [animation-delay:120ms]">
            Diga o que importa para você em cada um dos 7 critérios. Recalculamos as notas da comunidade com os seus pesos — o ranking geral continua o mesmo para todo mundo.
          </p>
        </div>
      </section>
      <section className="container-site py-10 sm:py-14">
        <PremiumGate
          feature="meu_ranking"
          title="Descubra as melhores casas para você"
          description="Ajuste a importância de música, público, ambiente, bebidas, atendimento, organização e experiência — e veja quais casas mais combinam com o seu perfil."
          preview={<RankingBuilder readOnly />}
        >
          <RankingBuilder />
        </PremiumGate>
      </section>
    </>
  );
}

function RankingBuilder({ readOnly = false }: { readOnly?: boolean }) {
  const { data, version } = useApp();
  const { plus } = usePlus();
  const toast = useToast();
  const [weights, setWeights] = useState<CriteriaWeights>(STARTER);
  const [presets, setPresets] = useState<RankingPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('Meu ranking');
  const [city, setCity] = useState('');
  const [minReviews, setMinReviews] = useState('3');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: base, error, reload } = useAsync(async () => {
    const [venues, stats, cities] = await Promise.all([data.listVenues(), data.getAllStats(), data.listCities()]);
    return { venues, stats, cities };
  }, [data, version]);

  // Carrega configurações salvas (somente assinantes).
  useEffect(() => {
    if (readOnly) return;
    plus
      .getPreferences()
      .then((p) => {
        setPresets(p.ranking_presets);
        const active = p.ranking_presets.find((x) => x.id === p.active_preset_id) ?? p.ranking_presets[0];
        if (active) {
          setActiveId(active.id);
          setWeights(active.weights);
          setName(active.name);
          setSaved(true);
        }
      })
      .catch(() => {});
  }, [plus, readOnly]);

  const rows = useMemo(() => {
    if (!base) return [];
    const venues = city ? base.venues.filter((v) => v.city === city) : base.venues;
    return rankByPreferences(venues, base.stats, weights, { minReviews: Number(minReviews) });
  }, [base, weights, city, minReviews]);
  const publicPos = useMemo(() => publicPositions(rows), [rows]);
  const shares = weightShares(weights);
  const noWeights = totalWeight(weights) === 0;

  const setWeight = (key: keyof CriteriaWeights, v: number) => {
    setWeights((w) => ({ ...w, [key]: clampWeight(v) }));
    setSaved(false);
  };

  const persist = async (asNew: boolean) => {
    if (noWeights) return toast('Defina pelo menos um critério com peso maior que zero.', 'error');
    setBusy(true);
    try {
      const id = !asNew && activeId ? activeId : uid();
      const preset: RankingPreset = { id, name: name.trim() || 'Meu ranking', weights, updated_at: new Date().toISOString() };
      const list = presets.some((p) => p.id === id) ? presets.map((p) => (p.id === id ? preset : p)) : [...presets, preset];
      const prefs = await plus.savePreferences({ ranking_presets: list, active_preset_id: id });
      setPresets(prefs.ranking_presets);
      setActiveId(id);
      setSaved(true);
      toast('Seu ranking está pronto.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível salvar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectPreset = async (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setActiveId(p.id);
    setWeights(p.weights);
    setName(p.name);
    setSaved(true);
    plus.savePreferences({ active_preset_id: p.id }).catch(() => {});
  };

  const removePreset = async (id: string) => {
    const list = presets.filter((p) => p.id !== id);
    try {
      const prefs = await plus.savePreferences({ ranking_presets: list, active_preset_id: list[0]?.id ?? null });
      setPresets(prefs.ranking_presets);
      if (activeId === id) {
        setActiveId(list[0]?.id ?? null);
        if (list[0]) {
          setWeights(list[0].weights);
          setName(list[0].name);
        } else setName('Meu ranking');
        setSaved(!!list[0]);
      }
      toast('Configuração removida.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao remover.', 'error');
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <div className="grid gap-8 lg:grid-cols-[400px_1fr] xl:grid-cols-[440px_1fr]">
      {/* ---------------------------------------------------- preferências */}
      <aside className="plus-frame h-fit p-6 sm:p-7 lg:sticky lg:top-24">
        <div className="flex items-center justify-between">
          <p className="font-display text-[15px] font-extrabold uppercase tracking-tight">Minhas preferências</p>
          <button
            onClick={() => { setWeights(PUBLIC_WEIGHTS); setSaved(false); }}
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-nav text-mute hover:text-bone"
            title="Volta aos pesos usados na nota pública"
          >
            <RotateCcw className="h-3 w-3" /> Pesos públicos
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {WEIGHT_PRESETS.map((p) => (
            <button key={p.id} title={p.description} onClick={() => { setWeights(p.weights); setSaved(false); }} className="chip h-8 px-3 text-[9px]">
              <Sparkles className="mr-1.5 h-3 w-3 text-blue" /> {p.name}
            </button>
          ))}
        </div>

        <ul className="mt-7 flex flex-col gap-5">
          {CRITERIA.map((c) => (
            <li key={c.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <label htmlFor={`w-${c.key}`} className="text-[13px] font-semibold">{c.label}</label>
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] text-mute">{Math.round(shares[c.key])}%</span>
                  <input
                    aria-label={`Peso de ${c.label}`}
                    type="number" min={0} max={100} value={weights[c.key]}
                    onChange={(e) => setWeight(c.key, Number(e.target.value))}
                    className="w-[4.5rem] rounded-sm border border-line bg-transparent py-0.5 pl-1 pr-1.5 text-right font-display text-[16px] font-bold text-blue focus:border-blue focus:outline-none"
                  />
                </span>
              </div>
              <input
                id={`w-${c.key}`} type="range" min={0} max={100} step={5} value={weights[c.key]}
                onChange={(e) => setWeight(c.key, Number(e.target.value))}
                className="plus-range"
                style={{ background: `linear-gradient(90deg, #83A9F5 ${weights[c.key]}%, #292929 ${weights[c.key]}%)` }}
              />
            </li>
          ))}
        </ul>
        {noWeights && <p className="mt-4 text-[12px] text-bone">Defina ao menos um critério acima de zero. Critérios com peso 0 são desconsiderados.</p>}

        <div className="mt-7 border-t border-line pt-6">
          <label className="field-label" htmlFor="preset-name">Nome desta configuração</label>
          <input id="preset-name" className="field h-11" maxLength={40} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => persist(false)} disabled={busy || noWeights || readOnly} className="btn-primary flex-1">
              <Save className="h-4 w-4" /> Salvar meu ranking
            </button>
            {activeId && (
              <button onClick={() => persist(true)} disabled={busy || noWeights || presets.length >= 10} className="btn-ghost btn-sm h-12">
                Salvar como nova
              </button>
            )}
          </div>
          {presets.length > 0 && (
            <div className="mt-6">
              <p className="field-label">Configurações salvas ({presets.length}/10)</p>
              <ul className="flex flex-col gap-2">
                {presets.map((p) => (
                  <li key={p.id} className={clsx('flex items-center justify-between gap-2 rounded-card border px-3 py-2', p.id === activeId ? 'border-blue/60' : 'border-line')}>
                    <button onClick={() => selectPreset(p.id)} className="flex min-w-0 items-center gap-2 text-left text-[13px]">
                      {p.id === activeId ? <Check className="h-3.5 w-3.5 shrink-0 text-blue" /> : <span className="w-3.5" />}
                      <span className="truncate">{p.name}</span>
                    </button>
                    <button onClick={() => removePreset(p.id)} aria-label={`Remover ${p.name}`} className="text-mute hover:text-bone"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------- resultado */}
      <div>
        {saved && !readOnly && (
          <div className="mb-6 flex animate-fade-up items-center gap-4 rounded-card border border-blue/40 bg-blue-soft px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue text-ink"><Check className="h-4 w-4" /></span>
            <div>
              <p className="font-display text-[18px] font-extrabold uppercase tracking-tight">Seu ranking está pronto.</p>
              <p className="text-[12px] text-mute">As casas mais compatíveis com “{name.trim() || 'Meu ranking'}”. Mova os controles para recalcular na hora.</p>
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <FilterSelect label="Cidade" value={city} onChange={setCity}
            options={[{ value: '', label: 'Todas as cidades' }, ...(base?.cities ?? []).map((c) => ({ value: c.city, label: `${c.city} — ${c.state}` }))]} />
          <FilterSelect label="Mínimo de avaliações" value={minReviews} onChange={setMinReviews}
            options={[{ value: '1', label: '1 ou mais' }, { value: '3', label: '3 ou mais' }, { value: '10', label: '10 ou mais' }, { value: '20', label: '20 ou mais' }]} />
        </div>

        {!base ? (
          <div className="flex flex-col gap-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : noWeights ? (
          <EmptyState title="Sem pesos definidos" text="Aumente a importância de pelo menos um critério para calcular sua nota personalizada." />
        ) : rows.length ? (
          <>
            <ol className="flex flex-col gap-3">
              {rows.slice(0, readOnly ? 5 : 30).map((r) => (
                <PersonalRowCard key={r.venue.id} row={r} publicPosition={publicPos.get(r.venue.id) ?? r.position} />
              ))}
            </ol>
            <p className="mt-6 text-[11px] leading-relaxed text-mute">
              Nota personalizada = Σ(média do critério × seu peso) ÷ Σ(pesos), usando as médias públicas da comunidade (todas as avaliações têm o mesmo peso).
              Critérios com peso 0 são ignorados. A <Link href="/rankings" className="text-bone underline-offset-2 hover:underline">nota pública</Link> e o ranking geral não mudam.
            </p>
          </>
        ) : (
          <EmptyState title="Nenhuma casa com dados suficientes" text="Reduza o mínimo de avaliações ou escolha outra cidade." />
        )}
      </div>
    </div>
  );
}

function PersonalRowCard({ row, publicPosition }: { row: PersonalRow; publicPosition: number }) {
  const moved = publicPosition - row.position; // positivo = sobe no seu ranking
  const strongest = CRITERIA.find((c) => c.key === row.strongest);
  return (
    <li className={clsx('group grid grid-cols-[auto_1fr] items-center gap-4 rounded-card border bg-panel p-3 pr-4 transition-colors hover:border-bone/40 sm:grid-cols-[auto_88px_1fr_auto] sm:gap-5', row.position <= 3 ? 'border-blue/30' : 'border-line')}>
      <span className={clsx('w-9 text-center font-display text-[26px] font-extrabold leading-none', row.position <= 3 ? 'text-blue' : 'text-bone/60')}>{row.position}</span>
      <Link href={`/boates/${row.venue.slug}`} className="relative hidden aspect-square overflow-hidden rounded-sm sm:block">
        <Photo src={row.venue.cover_image} alt="" />
      </Link>
      <div className="min-w-0">
        <Link href={`/boates/${row.venue.slug}`} className="block truncate font-display text-[17px] font-bold uppercase tracking-tight hover:text-blue">{row.venue.name}</Link>
        <p className="mt-1 truncate text-[11px] text-mute">{row.venue.neighborhood} · {row.venue.city} · {row.stats.review_count} aval.</p>
        <div className="mt-2.5 flex items-center gap-3">
          <span className="h-[3px] w-28 overflow-hidden rounded-full bg-line sm:w-40">
            <span className="block h-full bg-blue" style={{ width: `${row.match}%` }} />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-nav text-blue">{row.match}% compatível</span>
          {strongest && <span className="hidden text-[10px] text-mute md:inline">Destaque: {strongest.label}</span>}
        </div>
      </div>
      <div className="col-span-2 flex items-end justify-between gap-6 border-t border-line pt-3 sm:col-span-1 sm:block sm:border-0 sm:pt-0 sm:text-right">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-nav text-mute">Sua nota</p>
          <p className="font-display text-[28px] font-extrabold leading-none text-blue">{formatScore(row.personal)}</p>
        </div>
        <div className="sm:mt-2">
          <p className="text-[10px] text-mute">
            Pública <span className="font-semibold text-bone">{formatScore(row.public)}</span>{' '}
            <span className={clsx('font-semibold', row.delta > 0 ? 'text-blue' : row.delta < 0 ? 'text-bone/60' : 'text-mute')}>
              ({row.delta > 0 ? '+' : ''}{row.delta.toFixed(1)})
            </span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-mute" title="Comparação com a posição pela nota pública nesta mesma lista">
            {moved > 0 ? <ArrowUp className="h-3 w-3 text-blue" /> : moved < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {moved === 0 ? 'mesma posição' : `${Math.abs(moved)} ${moved > 0 ? 'acima' : 'abaixo'} da ordem pública`}
          </p>
        </div>
      </div>
    </li>
  );
}
