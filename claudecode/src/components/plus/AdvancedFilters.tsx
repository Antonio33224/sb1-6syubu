'use client';
import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Save, SlidersHorizontal, X } from 'lucide-react';
import { usePlus } from '@/components/providers/PlusProvider';
import { useToast } from '@/components/providers/AppProviders';
import {
  activeChips,
  AUDIENCE_OPTIONS,
  CAPACITY_BANDS,
  EVENT_TYPES,
  removeChip,
  WEEKDAYS,
} from '@/lib/plus/advanced-filters';
import { CRITERIA, type AdvancedFilterState, type CriterionKey } from '@/types';
import { Paywall } from './PremiumGate';
import { PlusBadge } from './PlusBadge';

const HOURS = ['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00', '04:00'];

function toggle<T>(list: T[] | undefined, v: T): T[] {
  const l = list ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
}

/**
 * Painel de filtros avançados Classify+. Para quem não assina, mostra a prévia
 * dos controles (desabilitados) com o convite para assinar.
 */
export function AdvancedFilters({
  value,
  onChange,
  onNeedLocation,
  hasLocation,
}: {
  value: AdvancedFilterState;
  onChange: (v: AdvancedFilterState) => void;
  onNeedLocation: () => void;
  hasLocation: boolean;
}) {
  const { isPremium, plus } = usePlus();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const chips = activeChips(value).filter((c) => c.premium);
  const set = (patch: Partial<AdvancedFilterState>) => onChange({ ...value, ...patch });

  const save = async () => {
    try {
      await plus.savePreferences({ saved_filters: value });
      toast('Filtros salvos. Eles serão aplicados nas próximas visitas.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao salvar filtros.', 'error');
    }
  };

  const controls = (
    <fieldset disabled={!isPremium} className="grid gap-7 p-5 sm:p-7 lg:grid-cols-2">
      <Group label="Gasto médio por pessoa (R$)">
        <div className="flex items-center gap-3">
          <input type="number" min={0} inputMode="numeric" placeholder="mín." className="field h-10 w-28"
            value={value.avgPriceMin ?? ''} onChange={(e) => set({ avgPriceMin: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
          <span className="text-mute">—</span>
          <input type="number" min={0} inputMode="numeric" placeholder="máx." className="field h-10 w-28"
            value={value.avgPriceMax ?? ''} onChange={(e) => set({ avgPriceMax: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
        </div>
      </Group>
      <Group label="Tipo de evento">
        <Chips options={EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} selected={value.categories} onToggle={(v) => set({ categories: toggle(value.categories, v) })} />
      </Group>
      <Group label="Tipo de público">
        <Chips options={AUDIENCE_OPTIONS.map((a) => ({ value: a, label: a }))} selected={value.audience} onToggle={(v) => set({ audience: toggle(value.audience, v) })} />
      </Group>
      <Group label="Capacidade informada">
        <Chips options={CAPACITY_BANDS.map((b) => ({ value: b.value, label: b.label }))} selected={value.capacity} onToggle={(v) => set({ capacity: toggle(value.capacity, v as NonNullable<AdvancedFilterState['capacity']>[number]) })} />
      </Group>
      <Group label="Dia da semana">
        <Chips options={WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3) }))} selected={value.weekdays} onToggle={(v) => set({ weekdays: toggle(value.weekdays, v) })} />
      </Group>
      <Group label="Horário de funcionamento">
        <div className="flex flex-wrap gap-2">
          <Select value={value.openAt ?? ''} onChange={(v) => set({ openAt: v || null })} options={[{ value: '', label: 'Qualquer horário' }, ...HOURS.map((h) => ({ value: h, label: `Aberto às ${h}` }))]} />
        </div>
      </Group>
      <Group label="Avaliação por categoria (mínimo)">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CRITERIA.map((c) => (
            <label key={c.key} className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2 text-[12px]">
              <span className="truncate">{c.label}</span>
              <select
                className="bg-transparent text-[12px] font-semibold text-blue focus:outline-none"
                value={value.criteriaMin?.[c.key] ?? 0}
                onChange={(e) => {
                  const next = { ...(value.criteriaMin ?? {}) } as Partial<Record<CriterionKey, number>>;
                  const n = Number(e.target.value);
                  if (n) next[c.key] = n;
                  else delete next[c.key];
                  set({ criteriaMin: next });
                }}
              >
                {[0, 6, 7, 8, 9].map((n) => <option key={n} value={n} className="bg-ink">{n ? `${n}+` : '—'}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Group>
      <div className="grid gap-7 sm:grid-cols-2">
        <Group label="Distância">
          <Select
            value={String(value.maxDistanceKm ?? '')}
            onChange={(v) => {
              if (v && !hasLocation) onNeedLocation();
              set({ maxDistanceKm: v ? Number(v) : null });
            }}
            options={[{ value: '', label: 'Qualquer distância' }, ...[2, 5, 10, 25, 50].map((k) => ({ value: String(k), label: `Até ${k} km` }))]}
          />
          {value.maxDistanceKm && !hasLocation && <p className="mt-2 text-[11px] text-mute">Aguardando sua localização…</p>}
        </Group>
        <Group label="Confiabilidade">
          <Select value={String(value.minReviews ?? '')} onChange={(v) => set({ minReviews: v ? Number(v) : null })}
            options={[{ value: '', label: 'Qualquer nº de avaliações' }, { value: '5', label: '5+ avaliações' }, { value: '15', label: '15+ avaliações' }, { value: '30', label: '30+ avaliações' }]} />
        </Group>
      </div>
    </fieldset>
  );

  return (
    <div className="mt-6">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={clsx('flex w-full items-center justify-between gap-4 rounded-card border px-5 py-4 transition-colors', open ? 'border-blue/50' : 'border-line hover:border-bone/40')}>
        <span className="flex items-center gap-3">
          <SlidersHorizontal className="h-4 w-4 text-blue" />
          <span className="text-[11px] font-bold uppercase tracking-nav">Filtros avançados</span>
          <PlusBadge size="xs" />
          {isPremium && chips.length > 0 && <span className="rounded-full bg-blue px-2 py-0.5 text-[10px] font-extrabold text-ink">{chips.length}</span>}
        </span>
        <ChevronDown className={clsx('h-4 w-4 text-mute transition-transform', open && 'rotate-180')} />
      </button>

      {isPremium && chips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={`${c.key}-${c.value ?? ''}`} onClick={() => onChange(removeChip(value, c))} className="chip chip-active h-8 gap-2 pr-3">
              {c.label} <X className="h-3 w-3" />
            </button>
          ))}
          <button onClick={() => onChange({})} className="text-[10px] font-bold uppercase tracking-nav text-mute hover:text-bone">Limpar avançados</button>
          <button onClick={save} className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-nav text-blue hover:text-bone"><Save className="h-3 w-3" /> Salvar filtros</button>
        </div>
      )}

      {open && (
        <div className="mt-3 animate-fade-in">
          {isPremium ? (
            <div className="plus-frame">
              {controls}
              <p className="border-t border-line px-5 py-3 text-[11px] text-mute sm:px-7">Filtros combinados (todos precisam ser atendidos). Casas sem a informação cadastrada não aparecem quando o filtro correspondente está ativo.</p>
            </div>
          ) : (
            <Paywall feature="filtros_avancados" preview={controls} title="Filtros completos com Classify+" description="Combine gasto médio, público, capacidade, horário, dia da semana, tipo de evento, nota por critério e distância. Os filtros básicos continuam gratuitos." />
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      {children}
    </div>
  );
}

function Chips({ options, selected, onToggle }: { options: { value: string; label: string }[]; selected?: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button type="button" key={o.value} onClick={() => onToggle(o.value)} aria-pressed={selected?.includes(o.value)} className={clsx('chip h-8 px-3 text-[9px]', selected?.includes(o.value) && 'chip-active')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="field h-10 cursor-pointer text-[13px]">
      {options.map((o) => <option key={o.value} value={o.value} className="bg-ink">{o.label}</option>)}
    </select>
  );
}
