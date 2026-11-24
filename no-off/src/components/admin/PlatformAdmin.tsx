'use client';
/**
 * Super admin: festas (visibilidade e suspensão), produtores e vendas.
 * Rotas /api/admin/* conferem o papel no servidor; as funções admin_* conferem
 * de novo e gravam em audit_logs.
 */
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Eye, EyeOff, History, ShieldOff, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { FilterSelect, Modal } from '@/components/ui/Controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatDate } from '@/lib/format';
import { adminApi, apiAvailable, type AuditEntry, type VisibilityInput } from '@/services/api-client';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type AdminEventRow } from '@/types';

function SupabaseOnly({ children }: { children: ReactNode }) {
  if (apiAvailable()) return <>{children}</>;
  return <EmptyState title="Disponível apenas com Supabase" text="Festas, produtores e vendas exigem o banco de dados real." />;
}

const VIS_LABEL = { hidden: 'Oculta', partial: 'Visível com informações ocultas', visible: 'Visível' } as const;
const STATUS_LABEL: Record<string, string> = { draft: 'Rascunho', published: 'Publicada', cancelled: 'Cancelada', suspended: 'Suspensa' };

// ------------------------------------------------------------------ festas

export function PlatformEventsAdmin() {
  return <SupabaseOnly><EventsInner /></SupabaseOnly>;
}

function EventsInner() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi.events(), []);
  const [q, setQ] = useState('');
  const [vis, setVis] = useState('');
  const [editing, setEditing] = useState<AdminEventRow | null>(null);
  const [logsFor, setLogsFor] = useState<AdminEventRow | null>(null);

  const list = useMemo(
    () => (data ?? []).filter((e) => (!vis || e.visibility === vis) && (!q || `${e.name} ${e.producer_username ?? ''} ${e.city ?? ''}`.toLowerCase().includes(q.toLowerCase()))),
    [data, q, vis],
  );

  const setStatus = async (e: AdminEventRow, status: 'published' | 'suspended') => {
    try {
      await adminApi.setEventStatus(e.event_id, status, status === 'suspended' ? 'Suspensa pelo super admin' : '');
      toast(status === 'suspended' ? 'Festa suspensa (saiu do site e as vendas pararam).' : 'Festa reativada.');
      void reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar festa, produtor ou cidade" className="field h-11 max-w-sm" />
        <FilterSelect label="Visibilidade" value={vis} onChange={setVis} options={[{ value: '', label: 'Todas' }, { value: 'visible', label: 'Visíveis' }, { value: 'partial', label: 'Info. ocultas' }, { value: 'hidden', label: 'Ocultas' }]} />
        <p className="pb-3 text-[12px] text-mute">{data ? `${list.length} festas` : ''}</p>
      </div>
      <p className="mb-6 max-w-3xl text-[12px] leading-relaxed text-mute">
        <strong className="text-bone">Oculta</strong>: some de listagens, busca, rankings e sitemap, e a URL direta retorna 404.{' '}
        <strong className="text-bone">Informações ocultas</strong>: a festa aparece, mas os campos escolhidos saem do servidor como vazios e o site mostra “Em breve”.
        Com o preço oculto, as vendas ficam bloqueadas até a revelação.
      </p>
      {!data ? (
        <Skeleton className="h-64" />
      ) : list.length === 0 ? (
        <EmptyState title="Nenhuma festa" text="Nada para estes filtros." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[1040px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Data</th><th className="p-4">Festa</th><th className="p-4">Produtor</th><th className="p-4">Status</th><th className="p-4">Visibilidade</th><th className="p-4">Vendidos</th><th className="p-4">Bruto</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((e) => (
                <tr key={e.event_id} className="hover:bg-panel">
                  <td className="p-4 text-mute">{formatDate(e.event_date)}</td>
                  <td className="p-4"><span className="font-semibold">{e.name}</span><span className="block text-[11px] text-mute">{e.city ?? '—'}</span></td>
                  <td className="p-4 text-mute">{e.producer_username ? <>@{e.producer_username}{e.producer_suspended && <span className="ml-1 text-red-bright">(suspenso)</span>}</> : 'Curadoria'}</td>
                  <td className="p-4"><span className={clsx('text-[10px] font-bold uppercase tracking-nav', e.status === 'suspended' ? 'text-red-bright' : e.status === 'published' ? 'text-bone' : 'text-mute')}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                  <td className="p-4">
                    <span className="text-[12px]">{VIS_LABEL[e.visibility]}</span>
                    {e.visibility === 'partial' && (
                      <span className="block text-[10px] uppercase tracking-nav text-mute">
                        {[e.hide_name && 'nome', e.hide_price && 'preço', e.hide_location && 'local', e.hide_capacity && 'público'].filter(Boolean).join(' · ') || 'nada oculto'}
                      </span>
                    )}
                  </td>
                  <td className="p-4">{e.sold}{e.capacity ? <span className="text-mute">/{e.capacity}</span> : ''}</td>
                  <td className="p-4 font-semibold">{brlCents(Number(e.gross))}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <Icon label="Visibilidade" onClick={() => setEditing(e)}>{e.visibility === 'visible' ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</Icon>
                      <Icon label="Logs de alterações" onClick={() => setLogsFor(e)}><History className="h-3.5 w-3.5" /></Icon>
                      {e.status === 'suspended' ? (
                        <Icon label="Reativar" onClick={() => setStatus(e, 'published')}><ShieldCheck className="h-3.5 w-3.5" /></Icon>
                      ) : (
                        <Icon label="Suspender" onClick={() => setStatus(e, 'suspended')}><ShieldOff className="h-3.5 w-3.5" /></Icon>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <VisibilityModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {logsFor && <LogsModal title={`Logs — ${logsFor.name}`} target={logsFor.event_id} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function VisibilityModal({ row, onClose, onSaved }: { row: AdminEventRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<VisibilityInput>({ visibility: row.visibility, hide_price: row.hide_price, hide_location: row.hide_location, hide_name: row.hide_name, hide_capacity: row.hide_capacity });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await adminApi.setVisibility(row.event_id, v);
      toast('Visibilidade atualizada.');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggles: { key: keyof Omit<VisibilityInput, 'visibility'>; label: string; hint: string }[] = [
    { key: 'hide_name', label: 'Nome da festa', hint: 'Aparece “Nome revelado em breve”; a URL usa um código.' },
    { key: 'hide_price', label: 'Preço', hint: 'Aparece “Em breve”; as vendas ficam bloqueadas.' },
    { key: 'hide_location', label: 'Local', hint: 'Aparece “Local revelado em breve” (a cidade continua visível).' },
    { key: 'hide_capacity', label: 'Quantidade de pessoas', hint: 'Capacidade e vendidos aparecem como “Em breve”.' },
  ];
  return (
    <Modal open onClose={onClose} title={`Visibilidade — ${row.name}`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Visibilidade">
          {(['visible', 'partial', 'hidden'] as const).map((opt) => (
            <label key={opt} className={clsx('flex cursor-pointer items-center gap-3 rounded-card border p-4', v.visibility === opt ? 'border-red-bright' : 'border-line')}>
              <input type="radio" name="vis" checked={v.visibility === opt} onChange={() => setV({ ...v, visibility: opt })} className="accent-[#E10600]" />
              <span className="text-[13px] font-semibold">{VIS_LABEL[opt]}</span>
            </label>
          ))}
        </div>
        {v.visibility === 'partial' && (
          <div className="flex flex-col gap-3 rounded-card border border-line p-4">
            <p className="field-label">Esconder no site</p>
            {toggles.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 accent-[#E10600]" checked={v[t.key]} onChange={(e) => setV({ ...v, [t.key]: e.target.checked })} />
                <span><span className="text-[13px] font-semibold">{t.label}</span><span className="block text-[11px] text-mute">{t.hint}</span></span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={save} disabled={busy} className="btn-primary btn-sm">Salvar</button>
        </div>
      </div>
    </Modal>
  );
}

function LogsModal({ title, target, onClose }: { title: string; target: string; onClose: () => void }) {
  const { data, error } = useAsync(() => adminApi.audit({ target }), [target]);
  return (
    <Modal open onClose={onClose} title={title} wide>
      {error ? <p className="text-sm text-mute">{error}</p> : !data ? <Skeleton className="h-40" /> : data.length === 0 ? <p className="text-sm text-mute">Nenhum registro.</p> : (
        <ul className="divide-y divide-line">
          {data.map((e: AuditEntry) => (
            <li key={e.id} className="py-3 text-[12px]">
              <p><span className="font-semibold">{e.action}</span> <span className="text-mute">· {new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {e.actor ? `@${e.actor.username}` : 'sistema'}</span></p>
              <p className="mt-1 break-all font-mono text-[11px] text-mute">{JSON.stringify(e.metadata)}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ produtores

export function ProducersAdmin() {
  return <SupabaseOnly><ProducersInner /></SupabaseOnly>;
}

function ProducersInner() {
  const toast = useToast();
  const { data, error, reload } = useAsync(() => adminApi.producers(), []);
  const [logsFor, setLogsFor] = useState<{ id: string; username: string } | null>(null);

  const toggle = async (id: string, suspend: boolean) => {
    try {
      await adminApi.setSuspended(id, suspend, suspend ? 'Suspenso pelo super admin' : '');
      toast(suspend ? 'Produtor suspenso: as festas dele saíram do site e o painel foi bloqueado.' : 'Produtor reativado.');
      void reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div>
      <p className="mb-6 max-w-3xl text-[12px] text-mute">Para tornar alguém produtor, altere o papel na aba <strong className="text-bone">Usuários</strong> para “Produtor”. Suspender bloqueia o painel e tira todas as festas do produtor do site.</p>
      {!data ? <Skeleton className="h-64" /> : data.length === 0 ? <EmptyState title="Nenhum produtor" text="Promova um usuário a Produtor na aba Usuários." /> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Produtor</th><th className="p-4">Contato</th><th className="p-4">Festas</th><th className="p-4">Vendidos</th><th className="p-4">Bruto</th><th className="p-4">Situação</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-panel">
                  <td className="p-4"><Link href={`/u/${p.username}`} className="font-semibold hover:text-red-bright">{p.full_name || p.username}</Link><span className="ml-2 text-mute">@{p.username}</span>{p.role === 'super_admin' && <span className="ml-2 text-[10px] uppercase tracking-nav text-mute">super admin</span>}</td>
                  <td className="p-4 text-mute">{p.contact ?? '—'}</td>
                  <td className="p-4">{p.events}</td>
                  <td className="p-4">{p.sold}</td>
                  <td className="p-4 font-semibold">{brlCents(Number(p.gross))}</td>
                  <td className="p-4">{p.suspended_at ? <span className="text-[10px] font-bold uppercase tracking-nav text-red-bright">Suspenso</span> : <span className="text-[10px] font-bold uppercase tracking-nav text-mute">Ativo</span>}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <Icon label="Logs" onClick={() => setLogsFor({ id: p.id, username: p.username })}><History className="h-3.5 w-3.5" /></Icon>
                      {p.role !== 'super_admin' && (p.suspended_at ? (
                        <button onClick={() => toggle(p.id, false)} className="btn-ghost btn-sm">Reativar</button>
                      ) : (
                        <button onClick={() => toggle(p.id, true)} className="btn-outline btn-sm">Suspender</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {logsFor && <LogsModal title={`Logs — @${logsFor.username}`} target={logsFor.id} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ vendas

export function SalesAdmin() {
  return <SupabaseOnly><SalesInner /></SupabaseOnly>;
}

function SalesInner() {
  const { data, error, reload } = useAsync(() => adminApi.sales(), []);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-64" />;
  const t = data.totals;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-5">
        {[
          ['Faturamento bruto', brlCents(Number(t.gross))],
          ['Taxas (MP)', brlCents(Number(t.fees))],
          ['Pedidos pagos', String(t.orders)],
          ['Ingressos emitidos', String(t.tickets)],
          ['Estornos', brlCents(Number(t.refunded))],
        ].map(([l, v]) => (
          <div key={l} className="bg-ink p-5"><p className="font-display text-[24px] font-extrabold leading-none">{v}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-nav text-mute">{l}</p></div>
        ))}
      </div>
      {data.orders.length === 0 ? <EmptyState title="Nenhuma venda ainda" text="Os pedidos de todas as festas aparecem aqui." /> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Data</th><th className="p-4">Festa</th><th className="p-4">Comprador</th><th className="p-4">Forma</th><th className="p-4">Status</th><th className="p-4">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.orders.map((o) => (
                <tr key={o.id} className="hover:bg-panel">
                  <td className="p-4 text-mute">{new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="p-4">{o.event_name}</td>
                  <td className="p-4">{o.buyer_name}<span className="block text-[11px] text-mute">{o.buyer_email}</span></td>
                  <td className="p-4 text-mute">{o.payment_method ? PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method : '—'}</td>
                  <td className="p-4"><span className={clsx('text-[10px] font-bold uppercase tracking-nav', o.status === 'paid' ? 'text-red-bright' : 'text-mute')}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                  <td className="p-4 font-semibold">{brlCents(Number(o.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Icon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:border-bone hover:text-bone">
      {children}
    </button>
  );
}
