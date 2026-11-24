'use client';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Pause, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { FieldError, Modal } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents } from '@/lib/format';
import { producerService } from '@/services/ticket-service';
import { BATCH_STATE_LABEL, TICKET_TYPE_LABEL, type BatchStock, type TicketBatch, type TicketType } from '@/types';

/** ISO ↔ <input type="datetime-local"> (horário local do navegador). */
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function BatchesPanel({ eventId }: { eventId: string }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<TicketBatch> | null>(null);
  const { data, reload } = useAsync(async () => {
    const [batches, dash] = await Promise.all([producerService.batches(eventId), producerService.dashboard(eventId)]);
    const stock = new Map<string, BatchStock>(dash.batches.map((b) => [b.batch_id, b]));
    return { batches, stock };
  }, [eventId]);

  const act = async (fn: () => Promise<void>, msg: string) => {
    try {
      await fn();
      toast(msg);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  const nextOrder = (type: TicketType) => Math.max(0, ...(data?.batches ?? []).filter((b) => b.ticket_type === type).map((b) => b.sort_order)) + 1;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-[12px] leading-relaxed text-mute">
          Para cada tipo (pista, meia, VIP, camarote), os lotes seguem a ordem. Quando um lote esgota, é encerrado ou passa do horário final, o
          próximo é liberado automaticamente. <strong className="text-bone">Pausar</strong> segura a fila daquele tipo; <strong className="text-bone">Encerrar</strong> libera o próximo.
          Ingressos em checkout ficam reservados por 10 minutos.
        </p>
        <button onClick={() => setEditing({ event_id: eventId, ticket_type: 'pista', status: 'active', max_per_order: 10, sort_order: nextOrder('pista') })} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Novo lote</button>
      </div>
      {!data ? (
        <Skeleton className="h-64" />
      ) : data.batches.length === 0 ? (
        <EmptyState title="Nenhum lote" text="Crie o 1º lote (ex.: Pista · 1º lote · R$ 40 · 100 un. até sexta 23h)." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Tipo / ordem</th><th className="p-4">Lote</th><th className="p-4">Preço</th><th className="p-4">Vendidos / total</th><th className="p-4">Janela de vendas</th><th className="p-4">Situação</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.batches.map((b) => {
                const s = data.stock.get(b.id);
                return (
                  <tr key={b.id} className="hover:bg-panel">
                    <td className="p-4 text-mute">{TICKET_TYPE_LABEL[b.ticket_type]} · {b.sort_order}º</td>
                    <td className="p-4 font-semibold">{b.name}</td>
                    <td className="p-4">{brlCents(b.price)}</td>
                    <td className="p-4">{s ? `${s.sold}${s.reserved ? ` (+${s.reserved} reserv.)` : ''} / ${b.quantity}` : `— / ${b.quantity}`}</td>
                    <td className="p-4 text-[12px] text-mute">{fmt(b.sales_start)} → {fmt(b.sales_end)}</td>
                    <td className="p-4"><span className={clsx('text-[10px] font-bold uppercase tracking-nav', s?.state === 'on_sale' ? 'text-red-bright' : 'text-mute')}>{s ? BATCH_STATE_LABEL[s.state] : '—'}</span></td>
                    <td className="p-4">
                      <div className="flex justify-end gap-2">
                        <IconBtn label="Editar" onClick={() => setEditing(b)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
                        {b.status === 'active' && <IconBtn label="Pausar" onClick={() => act(() => producerService.setBatchStatus(b.id, 'paused'), 'Lote pausado.')}><Pause className="h-3.5 w-3.5" /></IconBtn>}
                        {b.status === 'paused' && <IconBtn label="Retomar" onClick={() => act(() => producerService.setBatchStatus(b.id, 'active'), 'Lote retomado.')}><Play className="h-3.5 w-3.5" /></IconBtn>}
                        {b.status !== 'closed' && <IconBtn label="Encerrar" onClick={() => act(() => producerService.setBatchStatus(b.id, 'closed'), 'Lote encerrado — o próximo foi liberado.')}><Square className="h-3.5 w-3.5" /></IconBtn>}
                        {b.status === 'closed' && <IconBtn label="Reabrir" onClick={() => act(() => producerService.setBatchStatus(b.id, 'active'), 'Lote reaberto.')}><Play className="h-3.5 w-3.5" /></IconBtn>}
                        {!s?.sold && !s?.reserved && <IconBtn label="Excluir" onClick={() => act(() => producerService.deleteBatch(b.id), 'Lote excluído.')}><Trash2 className="h-3.5 w-3.5" /></IconBtn>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <BatchForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:border-bone hover:text-bone">
      {children}
    </button>
  );
}

function BatchForm({ initial, onClose, onSaved }: { initial: Partial<TicketBatch>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [b, setB] = useState<Partial<TicketBatch>>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TicketBatch>(k: K, v: TicketBatch[K]) => setB((s) => ({ ...s, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await producerService.saveBatch({ ...b, event_id: initial.event_id! });
      toast('Lote salvo.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Editar lote' : 'Novo lote'} wide>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label><span className="field-label">Nome</span><input className="field" required maxLength={80} placeholder="1º lote" value={b.name ?? ''} onChange={(x) => set('name', x.target.value)} /></label>
        <label><span className="field-label">Tipo</span>
          <select className="field" value={b.ticket_type ?? 'pista'} onChange={(x) => set('ticket_type', x.target.value as TicketType)}>
            {Object.entries(TICKET_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label><span className="field-label">Preço (R$)</span><input className="field" type="number" min={1} step="0.01" required value={b.price ?? ''} onChange={(x) => set('price', Number(x.target.value))} /></label>
        <label><span className="field-label">Quantidade disponível</span><input className="field" type="number" min={1} required value={b.quantity ?? ''} onChange={(x) => set('quantity', Math.round(Number(x.target.value)))} /></label>
        <label><span className="field-label">Início das vendas</span><input className="field" type="datetime-local" value={toLocal(b.sales_start)} onChange={(x) => set('sales_start', fromLocal(x.target.value))} /></label>
        <label><span className="field-label">Fim das vendas (“valor X até tal horário”)</span><input className="field" type="datetime-local" value={toLocal(b.sales_end)} onChange={(x) => set('sales_end', fromLocal(x.target.value))} /></label>
        <label><span className="field-label">Ordem dentro do tipo</span><input className="field" type="number" min={0} value={b.sort_order ?? 1} onChange={(x) => set('sort_order', Math.round(Number(x.target.value)))} /></label>
        <label><span className="field-label">Máximo por pedido</span><input className="field" type="number" min={1} max={10} value={b.max_per_order ?? 10} onChange={(x) => set('max_per_order', Math.min(10, Math.max(1, Math.round(Number(x.target.value)))))} /></label>
        <p className="text-[11px] text-mute sm:col-span-2">Deixe o início vazio para vender assim que o lote anterior acabar. Ao alterar o preço, novos pedidos usam o novo valor; pedidos já pagos não mudam.</p>
        <div className="sm:col-span-2"><FieldError message={error} /></div>
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button className="btn-primary btn-sm">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}
