'use client';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { FieldError, FilterSelect, Modal } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { formatCents, PLANNING_MIX, PLANS, weightedTicketCents } from '@/lib/plus/subscription';
import type { PremiumBenefit } from '@/types';

// ------------------------------------------------------------------ métricas
export function PlusMetricsAdmin() {
  const { version } = useApp();
  const { plus } = usePlus();
  const { data: m, error } = useAsync(() => plus.admin.metrics(), [plus, version]);
  if (error) return <FieldError message={error} />;
  if (!m) return <Skeleton className="h-64" />;
  const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  return (
    <div className="flex flex-col gap-10">
      {plus.mode === 'demo' && (
        <p className="rounded-card border border-line px-5 py-4 text-[12px] text-mute">
          Modo demonstração: assinaturas são ativadas localmente, sem cobrança. Por isso os valores <strong className="text-bone">recebidos</strong> ficam em R$ 0,00.
        </p>
      )}
      <div>
        <p className="eyebrow mb-4">Assinantes</p>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
          {[
            ['Total com acesso', m.subscribers],
            ['Mensais ativas', m.monthly_active],
            ['Anuais ativas', m.annual_active],
            ['Em teste grátis', m.trialing],
            ['Canceladas (com acesso até o fim)', m.canceled_with_access],
            ['Expiradas', m.expired],
            ['Pagamento recusado', m.past_due],
            ['Conversão grátis → pagante', pct(m.conversion_rate)],
          ].map(([l, v]) => (
            <div key={l as string} className="bg-ink p-6">
              <p className="font-display text-[32px] font-extrabold leading-none text-blue">{typeof v === 'number' ? v.toLocaleString('pt-BR') : v}</p>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{l as string}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-mute">Conversão = assinantes pagantes com acesso (sem contar teste grátis) ÷ {m.total_users.toLocaleString('pt-BR')} usuários cadastrados.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6 sm:p-7">
          <p className="eyebrow">Receita estimada</p>
          <p className="mt-1 text-[11px] text-mute">Calculada pelos planos vigentes. Não representa dinheiro recebido.</p>
          <dl className="mt-6 grid gap-5">
            <Money label="Receita recorrente mensal (MRR) estimada" value={m.mrr_estimated_cents} hint="mensais ativas × R$ 12,90 + anuais ativas × R$ 109/12" />
            <Money label="Run-rate anual (MRR × 12)" value={m.arr_run_rate_cents} />
            <Money label="Receita anual contratada" value={m.annual_contracted_cents} hint="planos anuais pagos com acesso vigente" />
          </dl>
        </div>
        <div className="plus-frame p-6 sm:p-7">
          <p className="eyebrow text-blue">Pagamentos recebidos</p>
          <p className="mt-1 text-[11px] text-mute">Faturas confirmadas pelo gateway via webhook.</p>
          <dl className="mt-6 grid gap-5">
            <Money label="Recebido nos últimos 30 dias" value={m.received_30d_cents} />
            <Money label="Recebido (total)" value={m.received_total_cents} />
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-nav text-mute">Pagamentos recusados (30 dias)</dt>
              <dd className="mt-1 font-display text-[24px] font-bold">{m.failed_payments_30d}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-6 sm:p-7">
          <p className="eyebrow mb-5">Benefícios mais resgatados</p>
          {m.top_benefits.length ? (
            <ul className="divide-y divide-line">
              {m.top_benefits.map((b) => (
                <li key={b.benefit_id} className="flex items-center justify-between gap-4 py-3 text-[13px]">
                  <span className="min-w-0"><span className="block truncate font-semibold">{b.title}</span><span className="text-[11px] text-mute">{b.venue_name}</span></span>
                  <span className="font-display text-[18px] font-bold text-blue">{b.redemptions}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-mute">Nenhum resgate registrado.</p>}
        </div>
        <div className="card p-6 sm:p-7">
          <p className="eyebrow">Premissa interna de planejamento</p>
          <p className="mt-3 text-[13px] text-bone/85">
            Mix de {PLANNING_MIX.monthly * 100}% mensal / {PLANNING_MIX.annual * 100}% anual → ticket médio mensal ponderado estimado de{' '}
            <strong className="text-blue">{formatCents(Math.floor(weightedTicketCents()))}</strong> por assinante.
          </p>
          <p className="mt-3 text-[11px] text-mute">
            Planos: mensal {formatCents(PLANS.monthly.price_cents)} · anual {formatCents(PLANS.annual.price_cents)} ({formatCents(Math.round(PLANS.annual.price_cents / 12))}/mês).
            Premissa de negócio para projeções — não é garantia de receita e não é exibida aos usuários.
          </p>
        </div>
      </div>
    </div>
  );
}

function Money({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-nav text-mute">{label}</dt>
      <dd className="mt-1 font-display text-[26px] font-bold">{formatCents(value)}</dd>
      {hint && <p className="text-[11px] text-mute">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ benefícios
const EMPTY: Partial<PremiumBenefit> = { title: '', description: '', rules: '', how_to_redeem: '', image_url: '', valid_until: '', total_quantity: null, active: true, is_demo: false };

export function BenefitsAdmin() {
  const { data, version } = useApp();
  const { plus } = usePlus();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<PremiumBenefit> | null>(null);
  const { data: list, reload } = useAsync(() => plus.admin.listBenefits(), [plus, version]);
  const { data: venues } = useAsync(() => data.listVenues(), [data, version]);

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Remover o benefício "${title}"? Os resgates vinculados também serão removidos.`)) return;
    try {
      await plus.admin.deleteBenefit(id);
      reload();
      toast('Benefício removido.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao remover.', 'error');
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-[12px] text-mute">Cadastre apenas acordos confirmados com o estabelecimento. Use “Exemplo/demonstração” para conteúdo ilustrativo — ele é sinalizado na vitrine e não pode ser resgatado no ambiente real.</p>
        <button onClick={() => setEditing(EMPTY)} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Novo benefício</button>
      </div>
      {!list ? <Skeleton className="h-64" /> : list.length ? (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="px-4 py-3">Benefício</th><th className="px-4 py-3">Casa</th><th className="px-4 py-3">Validade</th><th className="px-4 py-3">Resgates</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.benefit.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold">{b.benefit.title}{b.benefit.is_demo && <span className="ml-2 rounded-sm border border-line px-1.5 text-[9px] uppercase text-mute">Exemplo</span>}</td>
                  <td className="px-4 py-3 text-mute">{b.venueName}</td>
                  <td className="px-4 py-3 text-mute">{formatDate(b.benefit.valid_until)}</td>
                  <td className="px-4 py-3">{b.redeemed}{b.benefit.total_quantity !== null ? ` / ${b.benefit.total_quantity}` : ''}</td>
                  <td className="px-4 py-3"><span className={clsx('text-[11px] font-semibold uppercase', b.availability === 'disponivel' ? 'text-blue' : 'text-mute')}>{b.availability}</span></td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(b.benefit)} className="mr-3 text-mute hover:text-bone" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(b.benefit.id, b.benefit.title)} className="text-mute hover:text-bone" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Nenhum benefício cadastrado" />}
      {editing && venues && <BenefitForm initial={editing} venues={venues.map((v) => ({ id: v.id, name: v.name, cover: v.cover_image }))} onClose={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function BenefitForm({ initial, venues, onClose }: { initial: Partial<PremiumBenefit>; venues: { id: string; name: string; cover: string }[]; onClose: () => void }) {
  const { plus } = usePlus();
  const toast = useToast();
  const [b, setB] = useState<Partial<PremiumBenefit>>({ venue_id: venues[0]?.id, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PremiumBenefit>(k: K, v: PremiumBenefit[K]) => setB((s) => ({ ...s, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const venue = venues.find((v) => v.id === b.venue_id);
      await plus.admin.upsertBenefit({ ...b, image_url: b.image_url?.trim() || venue?.cover || '' });
      toast(initial.id ? 'Benefício atualizado.' : 'Benefício cadastrado.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Editar benefício' : 'Novo benefício'} wide>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <FilterSelect className="sm:col-span-2" label="Estabelecimento parceiro" value={b.venue_id ?? ''} onChange={(v) => set('venue_id', v)} options={venues.map((v) => ({ value: v.id, label: v.name }))} />
        <L label="Nome do benefício" full><input className="field" required maxLength={120} value={b.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Entrada antecipada" /></L>
        <L label="Descrição da vantagem" full><textarea className="field h-auto py-3" rows={2} required maxLength={1000} value={b.description ?? ''} onChange={(e) => set('description', e.target.value)} /></L>
        <L label="Regras de utilização" full><textarea className="field h-auto py-3" rows={3} required maxLength={2000} value={b.rules ?? ''} onChange={(e) => set('rules', e.target.value)} /></L>
        <L label="Como resgatar" full><textarea className="field h-auto py-3" rows={2} required maxLength={1000} value={b.how_to_redeem ?? ''} onChange={(e) => set('how_to_redeem', e.target.value)} /></L>
        <L label="Válido até"><input className="field" type="date" required value={b.valid_until ?? ''} onChange={(e) => set('valid_until', e.target.value)} /></L>
        <L label="Quantidade (vazio = ilimitado)"><input className="field" type="number" min={1} value={b.total_quantity ?? ''} onChange={(e) => set('total_quantity', e.target.value === '' ? null : Math.round(Number(e.target.value)))} /></L>
        <L label="Imagem (URL; vazio = capa da casa)" full><input className="field" value={b.image_url ?? ''} onChange={(e) => set('image_url', e.target.value)} placeholder="/images/club-red.jpg" /></L>
        <label className="flex items-center gap-3 text-[13px]"><input type="checkbox" className="accent-[#83A9F5]" checked={b.active ?? true} onChange={(e) => set('active', e.target.checked)} /> Ativo (visível na vitrine)</label>
        <label className="flex items-center gap-3 text-[13px]"><input type="checkbox" className="accent-[#83A9F5]" checked={b.is_demo ?? false} onChange={(e) => set('is_demo', e.target.checked)} /> Exemplo/demonstração (não é acordo real)</label>
        <div className="sm:col-span-2"><FieldError message={error} /></div>
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button disabled={busy} className="btn-primary btn-sm">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function L({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={clsx('block', full && 'sm:col-span-2')}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
