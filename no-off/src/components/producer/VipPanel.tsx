'use client';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Check, Copy, Link2, Plus, Trash2, Upload, X } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { FieldError, Modal, Tabs } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatCpf, formatPhone, isValidCpf, onlyDigits } from '@/lib/cpf';
import { parseVipCsv, type VipCsvResult } from '@/lib/vip-csv';
import { producerService } from '@/services/ticket-service';
import type { EventItem, VipEntry } from '@/types';

type Filter = 'todos' | 'pending' | 'approved' | 'presentes' | 'rejected';

export function VipPanel({ event }: { event: EventItem }) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('todos');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [csv, setCsv] = useState<VipCsvResult | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const { data, reload } = useAsync(async () => {
    const [list, links] = await Promise.all([producerService.vipList(event.id), producerService.vipLinks(event.id)]);
    return { list, links };
  }, [event.id]);

  const act = async (fn: () => Promise<void>, msg?: string) => {
    try {
      await fn();
      if (msg) toast(msg);
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  const list = useMemo(() => {
    const all = data?.list ?? [];
    return all
      .filter((v) => (filter === 'todos' ? v.status !== 'rejected' : filter === 'presentes' ? !!v.checked_in_at : v.status === filter))
      .filter((v) => !q || `${v.name} ${v.cpf ?? ''} ${v.email ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  }, [data, filter, q]);

  const counts = useMemo(() => {
    const all = data?.list ?? [];
    return {
      approved: all.filter((v) => v.status === 'approved').length,
      pending: all.filter((v) => v.status === 'pending').length,
      present: all.filter((v) => v.checked_in_at).length,
      active: all.filter((v) => v.status !== 'rejected').length,
    };
  }, [data]);

  const readCsv = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_000_000) return toast('Arquivo muito grande (máx. 1 MB).', 'error');
    setCsv(parseVipCsv(await file.text()));
  };

  const importCsv = async () => {
    if (!csv?.rows.length) return;
    await act(
      () => producerService.addVip(csv.rows.map((r) => ({ ...r, event_id: event.id, source: 'csv' as const }))),
      `${csv.rows.length} nomes importados.`,
    );
    setCsv(null);
  };

  const site = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
        <Stat label="Aprovados" value={counts.approved} />
        <Stat label="Aguardando aprovação" value={counts.pending} />
        <Stat label="Presentes" value={counts.present} />
        <Stat label="Limite" value={event.vip_limit ? `${counts.active}/${event.vip_limit}` : 'Sem limite'} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, CPF ou e-mail" className="field h-11 max-w-xs" />
          <Tabs value={filter} onChange={setFilter} items={[{ value: 'todos', label: 'Todos' }, { value: 'pending', label: `Pendentes (${counts.pending})` }, { value: 'approved', label: 'Aprovados' }, { value: 'presentes', label: 'Presentes' }, { value: 'rejected', label: 'Recusados' }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setAdding(true)} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Adicionar nome</button>
          <label className="btn-ghost btn-sm cursor-pointer"><Upload className="h-3.5 w-3.5" /> Importar CSV<input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => { void readCsv(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button onClick={() => setLinkOpen(true)} className="btn-ghost btn-sm"><Link2 className="h-3.5 w-3.5" /> Link de inscrição</button>
        </div>
      </div>

      {!data ? (
        <Skeleton className="h-64" />
      ) : list.length === 0 ? (
        <EmptyState title="Nenhum nome" text="Adicione manualmente, importe um CSV (nome;cpf;email;celular;observacao) ou gere um link de inscrição." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Nome</th><th className="p-4">CPF</th><th className="p-4">Contato</th><th className="p-4">Observação</th><th className="p-4">Status</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((v) => <VipRow key={v.id} v={v} act={act} />)}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddVip eventId={event.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}

      <Modal open={!!csv} onClose={() => setCsv(null)} title="Importar lista VIP">
        {csv && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">{csv.rows.length} nomes prontos para importar.</p>
            {csv.warnings.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-card border border-line p-3 text-[12px] text-mute">
                {csv.warnings.slice(0, 50).map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => setCsv(null)} className="btn-ghost btn-sm">Cancelar</button>
              <button onClick={importCsv} disabled={!csv.rows.length} className="btn-primary btn-sm">Importar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Links de inscrição" wide>
        <LinksManager eventId={event.id} links={data?.links ?? []} site={site} onChange={reload} />
      </Modal>
    </div>
  );
}

function VipRow({ v, act }: { v: VipEntry; act: (fn: () => Promise<void>, msg?: string) => Promise<void> }) {
  const [note, setNote] = useState(v.note);
  return (
    <tr className={clsx('hover:bg-panel', v.status === 'rejected' && 'opacity-50')}>
      <td className="p-4 font-semibold">{v.name}<span className="ml-2 text-[10px] font-normal uppercase tracking-nav text-mute">{v.source === 'link' ? 'link' : v.source === 'csv' ? 'csv' : ''}</span></td>
      <td className="p-4 text-mute">{v.cpf ? formatCpf(v.cpf) : '—'}</td>
      <td className="p-4 text-[12px] text-mute">{[v.email, v.phone ? formatPhone(v.phone) : null].filter(Boolean).join(' · ') || '—'}</td>
      <td className="p-4">
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== v.note && act(() => producerService.updateVipNote(v.id, note), 'Observação salva.')} maxLength={300} placeholder="—" className="w-full min-w-[160px] bg-transparent text-[12px] outline-none focus:text-bone" aria-label={`Observação de ${v.name}`} />
      </td>
      <td className="p-4">
        <span className={clsx('text-[10px] font-bold uppercase tracking-nav', v.checked_in_at ? 'text-red-bright' : 'text-mute')}>
          {v.checked_in_at ? `Presente ${new Date(v.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : v.status === 'pending' ? 'Pendente' : v.status === 'approved' ? 'Aprovado' : 'Recusado'}
        </span>
      </td>
      <td className="p-4">
        <div className="flex justify-end gap-2">
          {v.status !== 'approved' && <button onClick={() => act(() => producerService.setVipStatus(v.id, 'approved'), 'Aprovado.')} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Aprovar" title="Aprovar"><Check className="h-3.5 w-3.5" /></button>}
          {v.status !== 'rejected' && !v.checked_in_at && <button onClick={() => act(() => producerService.setVipStatus(v.id, 'rejected'), 'Recusado.')} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Recusar" title="Recusar"><X className="h-3.5 w-3.5" /></button>}
          {!v.checked_in_at && <button onClick={() => act(() => producerService.deleteVip(v.id), 'Removido.')} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Remover" title="Remover"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
}

function AddVip({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', cpf: '', email: '', phone: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError('Informe o nome.');
    if (f.cpf && !isValidCpf(f.cpf)) return setError('CPF inválido.');
    try {
      await producerService.addVip([{ event_id: eventId, name: f.name.trim(), cpf: onlyDigits(f.cpf) || null, email: f.email.trim().toLowerCase() || null, phone: onlyDigits(f.phone) || null, note: f.note.trim(), source: 'manual' }]);
      toast('Nome adicionado.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  };
  return (
    <Modal open onClose={onClose} title="Adicionar à lista VIP">
      <form onSubmit={save} className="grid gap-4">
        <label><span className="field-label">Nome</span><input className="field" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="field-label">CPF (opcional)</span><input className="field" inputMode="numeric" value={formatCpf(f.cpf)} onChange={(e) => setF({ ...f, cpf: onlyDigits(e.target.value).slice(0, 11) })} /></label>
          <label><span className="field-label">Celular (opcional)</span><input className="field" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: formatPhone(e.target.value) })} /></label>
        </div>
        <label><span className="field-label">E-mail (opcional)</span><input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label><span className="field-label">Observação</span><input className="field" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ex.: +1 acompanhante, camarote 3" /></label>
        <FieldError message={error} />
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button className="btn-primary btn-sm">Adicionar</button>
        </div>
      </form>
    </Modal>
  );
}

function LinksManager({ eventId, links, site, onChange }: { eventId: string; links: { id: string; token: string; max_entries: number | null; active: boolean; expires_at: string | null }[]; site: string; onChange: () => void }) {
  const toast = useToast();
  const [max, setMax] = useState('');
  const [until, setUntil] = useState('');
  const create = async () => {
    try {
      await producerService.createVipLink(eventId, max ? Math.max(1, Number(max)) : null, until ? new Date(until).toISOString() : null);
      toast('Link criado.');
      setMax('');
      setUntil('');
      onChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12px] text-mute">Quem se inscrever pelo link entra como <strong className="text-bone">Pendente</strong> e só vale na portaria depois da sua aprovação.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label><span className="field-label">Limite de inscrições</span><input className="field" type="number" min={1} placeholder="Sem limite" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        <label><span className="field-label">Encerrar em</span><input className="field" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        <button onClick={create} className="btn-primary btn-sm h-12">Gerar link</button>
      </div>
      <ul className="divide-y divide-line rounded-card border border-line">
        {links.length === 0 && <li className="p-4 text-sm text-mute">Nenhum link criado.</li>}
        {links.map((l) => {
          const url = `${site}/lista/${l.token}`;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className={clsx('truncate font-mono text-[12px]', !l.active && 'line-through opacity-50')}>{url}</p>
                <p className="text-[11px] text-mute">{l.max_entries ? `Até ${l.max_entries} inscrições` : 'Sem limite'}{l.expires_at ? ` · encerra ${new Date(l.expires_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => navigator.clipboard.writeText(url).then(() => toast('Link copiado.'))} className="btn-ghost btn-sm"><Copy className="h-3.5 w-3.5" /> Copiar</button>
                <button onClick={() => producerService.setVipLinkActive(l.id, !l.active).then(onChange)} className="btn-ghost btn-sm">{l.active ? 'Desativar' : 'Reativar'}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-ink p-5">
      <p className="font-display text-[26px] font-extrabold leading-none">{value}</p>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
    </div>
  );
}
