'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError, Modal } from '@/components/ui/Controls';
import { Photo } from '@/components/ui/Photo';
import { useAsync } from '@/hooks/useAsync';
import { CATEGORY_LABEL } from '@/lib/format';
import { producerService } from '@/services/ticket-service';
import type { EventItem, VenueCategory } from '@/types';

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Criar/editar festa (dados públicos). Dono e visibilidade são definidos no banco. */
export function EventForm({ initial, onSaved }: { initial?: EventItem; onSaved?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { bump } = useApp();
  const [e, setE] = useState<Partial<EventItem>>(
    initial ?? { status: 'draft', start_time: '23:00', category: 'festa', dj_names: [], music_styles: [], gallery: [] },
  );
  const [useVenue, setUseVenue] = useState(Boolean(initial?.venue_id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: venues } = useAsync(() => producerService.venues(), []);
  const set = <K extends keyof EventItem>(k: K, v: EventItem[K]) => setE((s) => ({ ...s, [k]: v }));

  const upload = async (file: File | undefined, target: 'cover' | 'gallery') => {
    if (!file) return;
    try {
      const url = await producerService.uploadImage(file);
      if (target === 'cover') set('cover_image', url);
      else set('gallery', [...(e.gallery ?? []), url].slice(0, 12));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha no envio.', 'error');
    }
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = { ...e, name: e.name ?? '', event_date: e.event_date ?? '' } as EventItem;
      if (useVenue) {
        payload.location_name = null;
        payload.address = null;
      } else payload.venue_id = null;
      const saved = await producerService.saveEvent(payload);
      toast(initial ? 'Festa atualizada.' : 'Festa criada. Agora configure os lotes.');
      bump();
      if (!initial) router.push(`/produtor/festas/${saved.id}?tab=lotes`);
      else onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await producerService.deleteEvent(initial.id);
      toast('Festa excluída.');
      router.push('/produtor');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível excluir (festas com pedidos não podem ser excluídas — cancele-as).', 'error');
    }
  };

  return (
    <form onSubmit={save} className="grid gap-5 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="field-label">Nome da festa</span><input className="field" required maxLength={140} value={e.name ?? ''} onChange={(x) => set('name', x.target.value)} /></label>
      <label className="sm:col-span-2"><span className="field-label">Descrição</span><textarea className="field h-auto resize-y py-3" rows={5} value={e.description ?? ''} onChange={(x) => set('description', x.target.value)} /></label>
      <label><span className="field-label">Data</span><input className="field" type="date" required value={e.event_date ?? ''} onChange={(x) => set('event_date', x.target.value)} /></label>
      <label><span className="field-label">Horário de início</span><input className="field" type="time" required value={e.start_time ?? '23:00'} onChange={(x) => set('start_time', x.target.value)} /></label>
      <label><span className="field-label">Categoria</span>
        <select className="field" value={e.category ?? 'festa'} onChange={(x) => set('category', x.target.value as VenueCategory)}>
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label><span className="field-label">Capacidade (pessoas)</span><input className="field" type="number" min={1} placeholder="Opcional" value={e.capacity ?? ''} onChange={(x) => set('capacity', x.target.value === '' ? null : Math.max(1, Math.round(Number(x.target.value))))} /></label>

      <fieldset className="rounded-card border border-line p-4 sm:col-span-2 sm:p-5">
        <legend className="px-2 text-[10px] font-extrabold uppercase tracking-wide2 text-mute">Local</legend>
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setUseVenue(true)} className={`chip ${useVenue ? 'chip-active' : ''}`}>Casa cadastrada na NO OFF</button>
          <button type="button" onClick={() => setUseVenue(false)} className={`chip ${!useVenue ? 'chip-active' : ''}`}>Outro local</button>
        </div>
        {useVenue ? (
          <label className="block"><span className="field-label">Casa</span>
            <select className="field" value={e.venue_id ?? ''} onChange={(x) => set('venue_id', x.target.value || null)}>
              <option value="">Selecione…</option>
              {(venues ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} — {v.city}/{v.state}</option>)}
            </select>
          </label>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="field-label">Nome do local</span><input className="field" maxLength={140} value={e.location_name ?? ''} onChange={(x) => set('location_name', x.target.value)} /></label>
            <label><span className="field-label">Endereço</span><input className="field" maxLength={240} value={e.address ?? ''} onChange={(x) => set('address', x.target.value)} /></label>
            <label><span className="field-label">Cidade</span><input className="field" required={!useVenue} maxLength={80} value={e.city ?? ''} onChange={(x) => set('city', x.target.value)} /></label>
            <label><span className="field-label">UF</span><input className="field uppercase" maxLength={2} value={e.state ?? ''} onChange={(x) => set('state', x.target.value.toUpperCase())} /></label>
          </div>
        )}
      </fieldset>

      <label className="sm:col-span-2"><span className="field-label">Line-up (separado por vírgula — o primeiro é o destaque)</span><input className="field" value={(e.dj_names ?? []).join(', ')} onChange={(x) => set('dj_names', splitList(x.target.value))} /></label>
      <label className="sm:col-span-2"><span className="field-label">Estilos musicais (separados por vírgula)</span><input className="field" value={(e.music_styles ?? []).join(', ')} onChange={(x) => set('music_styles', splitList(x.target.value))} /></label>

      <div className="sm:col-span-2">
        <span className="field-label">Imagem de capa</span>
        <div className="flex items-center gap-3">
          {e.cover_image && <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-[3px] border border-line"><Photo src={e.cover_image} alt="" zoom={false} /></div>}
          <label className="btn-ghost btn-sm cursor-pointer"><Upload className="h-3.5 w-3.5" /> Enviar capa<input type="file" accept="image/*" className="sr-only" onChange={(x) => upload(x.target.files?.[0], 'cover')} /></label>
        </div>
      </div>
      <div className="sm:col-span-2">
        <span className="field-label">Galeria (até 12 imagens)</span>
        <div className="flex flex-wrap items-center gap-3">
          {(e.gallery ?? []).map((src) => (
            <div key={src} className="group relative h-16 w-24 overflow-hidden rounded-[3px] border border-line">
              <Photo src={src} alt="" zoom={false} />
              <button type="button" onClick={() => set('gallery', (e.gallery ?? []).filter((g) => g !== src))} className="absolute right-1 top-1 rounded-full bg-ink/80 p-1" aria-label="Remover imagem"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <label className="btn-ghost btn-sm cursor-pointer"><Upload className="h-3.5 w-3.5" /> Adicionar<input type="file" accept="image/*" className="sr-only" onChange={(x) => upload(x.target.files?.[0], 'gallery')} /></label>
        </div>
      </div>

      <label><span className="field-label">Limite da lista VIP</span><input className="field" type="number" min={1} placeholder="Sem limite" value={e.vip_limit ?? ''} onChange={(x) => set('vip_limit', x.target.value === '' ? null : Math.max(1, Math.round(Number(x.target.value))))} /></label>
      <label><span className="field-label">Status</span>
        <select className="field" value={e.status === 'suspended' ? 'suspended' : e.status ?? 'draft'} disabled={e.status === 'suspended'} onChange={(x) => set('status', x.target.value as EventItem['status'])}>
          <option value="draft">Rascunho (não aparece no site)</option>
          <option value="published">Publicada</option>
          <option value="cancelled">Cancelada</option>
          {e.status === 'suspended' && <option value="suspended">Suspensa pela NO OFF</option>}
        </select>
      </label>

      <div className="sm:col-span-2"><FieldError message={error} /></div>
      <div className="flex flex-wrap justify-between gap-3 sm:col-span-2">
        {initial ? <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost btn-sm"><Trash2 className="h-3.5 w-3.5" /> Excluir festa</button> : <span />}
        <button disabled={busy} className="btn-primary">{busy ? 'Salvando…' : initial ? 'Salvar alterações' : 'Criar festa'}</button>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir festa">
        <p className="text-sm text-mute">A festa, os lotes e a lista VIP serão excluídos. Festas com pedidos não podem ser excluídas — nesse caso, altere o status para Cancelada.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={() => setConfirmDelete(false)} className="btn-ghost btn-sm">Voltar</button>
          <button type="button" onClick={remove} className="btn-outline btn-sm">Excluir</button>
        </div>
      </Modal>
    </form>
  );
}
