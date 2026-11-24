'use client';
import Link from 'next/link';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { Tabs, Modal, FieldError, FilterSelect } from '@/components/ui/Controls';
import { EmptyState, PreLaunchTag, Skeleton } from '@/components/ui/States';
import { buildTemplateCsv, parseReviewImport, TEMPLATE_GUIDE, type ImportParseResult } from '@/lib/review-import';
import { computeOverall } from '@/lib/rating';
import { Avatar } from '@/components/ui/Avatar';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { useAsync } from '@/hooks/useAsync';
import { CATEGORY_LABEL, formatBRL, formatDate, slugify } from '@/lib/format';
import { brl, hasAvgPrice } from '@/lib/pricing';
import { localIso } from '@/lib/week';
import type { EventItem, PlatformSettings, ReviewStatus, UserRole, Venue, VenueCategory } from '@/types';

const ROLE_LABEL: Record<UserRole, string> = { comprador: 'Comprador', admin_festa: 'Produtor', super_admin: 'Super admin' };
import { AUDIENCE_OPTIONS } from '@/lib/venue-options';
import { AuditAdmin, SecurityAdmin } from '@/components/admin/AccessAdmin';
import { PlatformEventsAdmin, ProducersAdmin, SalesAdmin } from '@/components/admin/PlatformAdmin';

type Tab = 'geral' | 'festas' | 'produtores' | 'vendas' | 'boates' | 'eventos' | 'usuarios' | 'avaliacoes' | 'denuncias' | 'newsletter' | 'config' | 'seguranca' | 'auditoria';
const TABS: { value: Tab; label: string }[] = [
  { value: 'geral', label: 'Visão geral' },
  { value: 'festas', label: 'Festas e visibilidade' },
  { value: 'produtores', label: 'Produtores' },
  { value: 'vendas', label: 'Vendas' },
  { value: 'boates', label: 'Estabelecimentos' },
  { value: 'eventos', label: 'Agenda (cadastro)' },
  { value: 'usuarios', label: 'Usuários' },
  { value: 'avaliacoes', label: 'Avaliações' },
  { value: 'denuncias', label: 'Denúncias' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'config', label: 'Configurações' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'auditoria', label: 'Auditoria' },
];

export default function AdminPage() {
  const { user, authReady, data } = useApp();
  const [tab, setTab] = useState<Tab>('geral');

  if (!authReady) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!user || user.role !== 'super_admin')
    return (
      <section className="container-site flex min-h-[60vh] flex-col items-start justify-center py-20">
        <p className="eyebrow">Acesso restrito</p>
        <h1 className="mt-4 font-display text-[44px] font-extrabold uppercase leading-[0.95] tracking-tight">Somente<br />super admin.</h1>
        <p className="mt-5 max-w-md text-mute">Esta área exige uma conta com papel de super admin (administrador da plataforma). As permissões também são verificadas no servidor (RLS).</p>
        <Link href={user ? '/' : '/entrar?next=/admin'} className="btn-outline mt-8">{user ? 'Voltar ao início' : 'Entrar'}</Link>
      </section>
    );

  return (
    <section className="container-site py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Painel administrativo</p>
          <h1 className="mt-3 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[48px]">Backstage.</h1>
        </div>
        <span className="rounded-full border border-line px-4 py-2 text-[10px] font-bold uppercase tracking-nav text-mute">
          {data.mode === 'demo' ? 'Modo demonstração' : 'Supabase conectado'}
        </span>
      </div>
      <Tabs className="mt-10" value={tab} onChange={setTab} items={TABS} />
      <div className="mt-10">
        {tab === 'geral' && <Overview />}
        {tab === 'festas' && <PlatformEventsAdmin />}
        {tab === 'produtores' && <ProducersAdmin />}
        {tab === 'vendas' && <SalesAdmin />}
        {tab === 'seguranca' && <SecurityAdmin />}
        {tab === 'auditoria' && <AuditAdmin />}
        {tab === 'boates' && <VenuesAdmin />}
        {tab === 'eventos' && <EventsAdmin />}
        {tab === 'usuarios' && <UsersAdmin />}
        {tab === 'avaliacoes' && <ReviewsAdmin />}
        {tab === 'denuncias' && <ReportsAdmin />}
        {tab === 'newsletter' && <NewsletterAdmin />}
        {tab === 'config' && <SettingsAdmin />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ overview
function Overview() {
  const { data, version } = useApp();
  const { data: m, error } = useAsync(() => data.admin.metrics(), [data, version]);
  if (error) return <FieldError message={error} />;
  if (!m) return <Skeleton className="h-64" />;
  const max = Math.max(1, ...m.popular.map((p) => p.review_count));
  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Usuários', m.users],
          ['Estabelecimentos', m.venues],
          ['Avaliações', m.reviews],
          ['Eventos', m.events],
          ['Média geral', m.avg_rating.toFixed(1)],
          ['Denúncias pendentes', m.pending_reports],
        ].map(([l, v]) => (
          <div key={l} className="bg-ink p-6">
            <p className="font-display text-[36px] font-extrabold leading-none text-red-bright">{typeof v === 'number' ? v.toLocaleString('pt-BR') : v}</p>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{l}</p>
          </div>
        ))}
      </div>
      <div className="card p-6 sm:p-8">
        <p className="eyebrow mb-6">Estabelecimentos mais populares (volume de avaliações)</p>
        <ul className="flex flex-col gap-4">
          {m.popular.map((p) => (
            <li key={p.venue.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[220px_1fr_120px]">
              <Link href={`/boates/${p.venue.slug}`} className="truncate text-[13px] font-semibold hover:text-red-bright">{p.venue.name}</Link>
              <span className="order-last col-span-2 h-[4px] overflow-hidden rounded-full bg-line sm:order-none sm:col-span-1">
                <span className="block h-full bg-red" style={{ width: `${(p.review_count / max) * 100}%` }} />
              </span>
              <span className="text-right text-[12px] text-mute">{p.review_count} · <span className="font-semibold text-bone">{p.avg_rating.toFixed(1)}</span></span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[12px] text-mute">Newsletter: {m.newsletter.toLocaleString('pt-BR')} inscritos.</p>
    </div>
  );
}

// ------------------------------------------------------------------ venues
const EMPTY_VENUE: Partial<Venue> = { name: '', category: 'boate', city: 'Rio de Janeiro', state: 'RJ', price_range: 2, music_styles: [], opening_days: [], gallery: [] };

function VenuesAdmin() {
  const { data, version, bump } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Venue> | null>(null);
  const [confirm, setConfirm] = useState<Venue | null>(null);
  const { data: payload } = useAsync(async () => ({ venues: await data.listVenues(), stats: await data.getAllStats() }), [data, version]);

  const remove = async (v: Venue) => {
    try {
      await data.admin.deleteVenue(v.id);
      bump();
      toast('Registro excluído.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao excluir.', 'error');
    } finally {
      setConfirm(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-[12px] text-mute">{payload?.venues.length ?? '—'} estabelecimentos</p>
        <button onClick={() => setEditing({ ...EMPTY_VENUE })} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Cadastrar</button>
      </div>
      {!payload ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Nome</th><th className="p-4">Categoria</th><th className="p-4">Cidade</th><th className="p-4">Média R$</th><th className="p-4">Nota</th><th className="p-4">Aval.</th><th className="p-4">Selo</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payload.venues.map((v) => (
                <tr key={v.id} className="hover:bg-panel">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 shrink-0 overflow-hidden rounded-[3px]"><Photo src={v.cover_image} alt="" zoom={false} /></div>
                      <Link href={`/boates/${v.slug}`} className="font-semibold hover:text-red-bright">{v.name}</Link>
                      {v.is_demo && <span className="text-[9px] uppercase tracking-nav text-mute">demo</span>}
                    </div>
                  </td>
                  <td className="p-4 text-mute">{CATEGORY_LABEL[v.category]}</td>
                  <td className="p-4 text-mute">{v.city}/{v.state}</td>
                  <td className="p-4">
                    {hasAvgPrice(v) ? <span className="font-display font-bold text-red-bright">{brl(v.avg_price)}</span> : <button onClick={() => setEditing(v)} className="text-[11px] text-mute underline decoration-line underline-offset-4 hover:text-bone">Informar</button>}
                  </td>
                  <td className="p-4"><Score value={payload.stats[v.id]?.review_count ? payload.stats[v.id]!.avg_rating : null} size="xs" showMax={false} /></td>
                  <td className="p-4 text-mute">{payload.stats[v.id]?.review_count ?? 0}</td>
                  <td className="p-4 text-[11px]">{v.approved ? <span className="text-red-bright">Approved</span> : <span className="text-mute">—</span>}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(v)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label={`Editar ${v.name}`}><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setConfirm(v)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label={`Excluir ${v.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <VenueForm initial={editing} onClose={() => setEditing(null)} />}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Excluir estabelecimento">
        <p className="text-sm text-mute">Excluir <span className="text-bone">{confirm?.name}</span> remove também suas avaliações, eventos e favoritos. Esta ação não pode ser desfeita.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setConfirm(null)} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={() => confirm && remove(confirm)} className="btn-outline btn-sm">Excluir definitivamente</button>
        </div>
      </Modal>
    </div>
  );
}

function VenueForm({ initial, onClose }: { initial: Partial<Venue>; onClose: () => void }) {
  const { data, bump } = useApp();
  const toast = useToast();
  const { data: settings } = useAsync(() => data.getSettings(), [data]);
  const [v, setV] = useState<Partial<Venue>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Venue>(k: K, val: Venue[K]) => setV((s) => ({ ...s, [k]: val }));

  const upload = async (f?: File) => {
    if (!f) return;
    try {
      set('cover_image', await data.uploadImage(f, 'venue-images'));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha no envio.', 'error');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await data.admin.upsertVenue({ ...v, name: v.name ?? '', slug: v.slug || slugify(v.name ?? '') });
      bump();
      toast(initial.id ? 'Estabelecimento atualizado.' : 'Estabelecimento cadastrado.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Editar estabelecimento' : 'Novo estabelecimento'} wide>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome"><input className="field" required value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Slug (URL)"><input className="field" value={v.slug ?? ''} placeholder={slugify(v.name ?? '')} onChange={(e) => set('slug', slugify(e.target.value))} /></Field>
        <FilterSelect label="Categoria" value={(v.category ?? 'boate') as VenueCategory} onChange={(c) => set('category', c)}
          options={(['boate', 'festa', 'festival', 'experiencia'] as VenueCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c]! }))} />
        <FilterSelect label="Faixa de preço" value={String(v.price_range ?? 2)} onChange={(p) => set('price_range', Number(p))}
          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `R${'$'.repeat(n)}` }))} />
        <Field label="Cidade"><input className="field" required value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="UF"><input className="field" required maxLength={2} value={v.state ?? ''} onChange={(e) => set('state', e.target.value.toUpperCase())} /></Field>
        <Field label="Bairro"><input className="field" value={v.neighborhood ?? ''} onChange={(e) => set('neighborhood', e.target.value)} /></Field>
        <Field label="Endereço"><input className="field" value={v.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Latitude"><input className="field" type="number" step="any" value={v.latitude ?? ''} onChange={(e) => set('latitude', Number(e.target.value))} /></Field>
        <Field label="Longitude"><input className="field" type="number" step="any" value={v.longitude ?? ''} onChange={(e) => set('longitude', Number(e.target.value))} /></Field>
        <Field label="Instagram (URL)"><input className="field" type="url" value={v.instagram_url ?? ''} onChange={(e) => set('instagram_url', e.target.value || null)} /></Field>
        <Field label="Site (URL)"><input className="field" type="url" value={v.website_url ?? ''} onChange={(e) => set('website_url', e.target.value || null)} /></Field>
        <Field label="Imagem de capa (URL ou envio)" full>
          <div className="flex gap-3">
            <input className="field" value={v.cover_image?.startsWith('data:') ? '(imagem enviada)' : v.cover_image ?? ''} onChange={(e) => set('cover_image', e.target.value)} placeholder="/images/club-red.jpg" />
            <label className="btn-ghost btn-sm h-12 cursor-pointer whitespace-nowrap">Enviar<input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label>
          </div>
        </Field>
        <fieldset className="rounded-card border border-red/30 bg-red-soft p-4 sm:col-span-2 sm:p-5">
          <legend className="px-2 text-[10px] font-extrabold uppercase tracking-wide2 text-red-bright">Média de preços (R$)</legend>
          <p className="mb-4 text-[11px] leading-relaxed text-mute">
            Deixe em branco o que não for confirmado — a página mostrará “não informado”, nunca um valor estimado automaticamente.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Média por pessoa" full>
              <MoneyInput value={v.avg_price} onChange={(n) => set('avg_price', n)} placeholder="Ex.: 120" />
            </Field>
            <Field label="Entrada — mín."><MoneyInput value={v.entry_price_min} onChange={(n) => set('entry_price_min', n)} /></Field>
            <Field label="Entrada — máx."><MoneyInput value={v.entry_price_max} onChange={(n) => set('entry_price_max', n)} /></Field>
            <Field label="Drinks — mín."><MoneyInput value={v.drink_price_min} onChange={(n) => set('drink_price_min', n)} /></Field>
            <Field label="Drinks — máx."><MoneyInput value={v.drink_price_max} onChange={(n) => set('drink_price_max', n)} /></Field>
            <Field label="Consumação média — mín."><MoneyInput value={v.spend_min} onChange={(n) => set('spend_min', n)} /></Field>
            <Field label="Consumação média — máx."><MoneyInput value={v.spend_max} onChange={(n) => set('spend_max', n)} /></Field>
          </div>
        </fieldset>
        <Field label="Galeria (URLs separadas por vírgula)" full>
          <input className="field" value={(v.gallery ?? []).join(', ')} onChange={(e) => set('gallery', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Field>
        <Field label="Dias de funcionamento (separados por vírgula)" full>
          <input className="field" value={(v.opening_days ?? []).join(', ')} onChange={(e) => set('opening_days', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Field>
        <Field label="Estilos musicais" full>
          <div className="flex flex-wrap gap-2">
            {(settings?.music_styles ?? []).map((s) => {
              const on = v.music_styles?.includes(s);
              return (
                <button type="button" key={s} onClick={() => set('music_styles', on ? v.music_styles!.filter((x) => x !== s) : [...(v.music_styles ?? []), s])} className={clsx('chip', on && 'chip-active')}>{s}</button>
              );
            })}
          </div>
        </Field>
        <Field label="Descrição" full><textarea className="field h-auto resize-y py-3" rows={4} value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <fieldset className="rounded-card border border-line p-4 sm:col-span-2 sm:p-5">
          <legend className="px-2 text-[10px] font-extrabold uppercase tracking-wide2 text-mute">Informações adicionais — opcional</legend>
          <p className="mb-4 text-[11px] leading-relaxed text-mute">Deixe em branco o que não for confirmado: a interface nunca inventa um valor.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Capacidade (pessoas)">
              <input className="field" type="number" min={1} placeholder="Não informado" value={v.capacity ?? ''} onChange={(e) => set('capacity', e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))))} />
            </Field>
            <Field label="Abre às (HH:MM)">
              <input className="field" type="time" value={v.opens_at ?? ''} onChange={(e) => set('opens_at', e.target.value || null)} />
            </Field>
            <Field label="Fecha às (HH:MM)">
              <input className="field" type="time" value={v.closes_at ?? ''} onChange={(e) => set('closes_at', e.target.value || null)} />
            </Field>
          </div>
          <p className="field-label mt-4">Tipo de público</p>
          <div className="flex flex-wrap gap-2">
            {AUDIENCE_OPTIONS.map((a) => {
              const on = v.audience_tags?.includes(a);
              return <button type="button" key={a} onClick={() => set('audience_tags', on ? v.audience_tags!.filter((x) => x !== a) : [...(v.audience_tags ?? []), a])} className={clsx('chip', on && 'chip-active')}>{a}</button>;
            })}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line p-4 sm:col-span-2">
          <input type="checkbox" className="mt-1 accent-[#E10600]" checked={!!v.is_indicated} onChange={(e) => set('is_indicated', e.target.checked)} />
          <span>
            <span className="text-[13px] font-semibold">Exibir como INDICADO</span>
            <span className="mt-1 block text-[11px] text-mute">Card de curadoria visível para todos, sempre com o rótulo “Indicado”. Não altera notas nem posições nos rankings.</span>
          </span>
        </label>
        <div className="sm:col-span-2"><FieldError message={error} /></div>
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button disabled={busy} className="btn-primary btn-sm">{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Campo monetário opcional: vazio = null (não informado). */
function MoneyInput({ value, onChange, placeholder }: { value: number | null | undefined; onChange: (n: number | null) => void; placeholder?: string }) {
  return (
    <input
      className="field"
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      placeholder={placeholder ?? 'Não informado'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={clsx('block', full && 'sm:col-span-2')}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

// ------------------------------------------------------------------ events
function EventsAdmin() {
  const { data, version, bump } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<EventItem> | null>(null);
  const [venueFilter, setVenueFilter] = useState('');
  const [when, setWhen] = useState<'todos' | 'proximos' | 'passados'>('todos');
  const [confirmPurge, setConfirmPurge] = useState(false);
  const { data: payload } = useAsync(async () => ({ events: await data.admin.listEvents(), venues: await data.listVenues() }), [data, version]);
  const today = localIso(new Date());
  const past = (payload?.events ?? []).filter((e) => e.event_date < today);
  const list = (payload?.events ?? [])
    .filter((e) => !venueFilter || e.venue_id === venueFilter)
    .filter((e) => when === 'todos' || (when === 'passados' ? e.event_date < today : e.event_date >= today));

  const remove = async (id: string) => {
    try {
      await data.admin.deleteEvent(id);
      bump();
      toast('Evento excluído.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  const purgePast = async () => {
    const targets = past.filter((e) => !venueFilter || e.venue_id === venueFilter);
    try {
      for (const e of targets) await data.admin.deleteEvent(e.id);
      bump();
      toast(`${targets.length} ${targets.length === 1 ? 'atração antiga removida' : 'atrações antigas removidas'}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    } finally {
      setConfirmPurge(false);
    }
  };
  const purgeCount = past.filter((e) => !venueFilter || e.venue_id === venueFilter).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect label="Boate / local" value={venueFilter} onChange={setVenueFilter}
            options={[{ value: '', label: 'Todos os locais' }, ...(payload?.venues ?? []).map((v) => ({ value: v.id, label: v.name }))]} />
          <FilterSelect label="Período" value={when} onChange={setWhen}
            options={[{ value: 'todos', label: 'Todos' }, { value: 'proximos', label: 'Próximos' }, { value: 'passados', label: 'Já realizados' }]} />
          <p className="pb-3 text-[12px] text-mute">{payload ? list.length : '—'} eventos</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setConfirmPurge(true)} disabled={!purgeCount} className="btn-ghost btn-sm"><Trash2 className="h-3.5 w-3.5" /> Remover antigas ({purgeCount})</button>
          <button onClick={() => setEditing({ venue_id: venueFilter || payload?.venues[0]?.id, start_time: '23:00', dj_names: [], music_styles: [] })} className="btn-primary btn-sm"><Plus className="h-3.5 w-3.5" /> Nova atração / evento</button>
        </div>
      </div>
      <p className="mb-6 max-w-2xl text-[12px] leading-relaxed text-mute">
        Cadastro editorial da agenda (todas as festas, inclusive as dos produtores). Visibilidade, suspensão e vendas ficam na aba “Festas e visibilidade”. Os eventos dos próximos 7 dias aparecem automaticamente em “Atrações da semana” na página da casa e na home.
      </p>
      {!payload ? <Skeleton className="h-64" /> : list.length === 0 ? <EmptyState title="Sem eventos" text="Nenhum evento para estes filtros." /> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Data</th><th className="p-4">Evento</th><th className="p-4">DJs / artistas</th><th className="p-4">Local</th><th className="p-4">Preço</th><th className="p-4" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((e) => (
                <tr key={e.id} className={clsx('hover:bg-panel', e.event_date < today && 'opacity-55')}>
                  <td className="p-4 text-mute">{formatDate(e.event_date)} {e.start_time}{e.event_date < today && <span className="ml-2 text-[9px] uppercase tracking-nav">realizado</span>}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 shrink-0 overflow-hidden rounded-[3px]"><Photo src={e.cover_image} alt="" zoom={false} /></div>
                      <Link href={`/eventos/${e.slug}`} className="font-semibold hover:text-red-bright">{e.name}</Link>
                    </div>
                  </td>
                  <td className="max-w-[220px] truncate p-4 text-mute">{e.dj_names.join(', ') || '—'}</td>
                  <td className="p-4 text-mute">{e.venue.name}</td>
                  <td className="p-4 text-mute">{formatBRL(e.ticket_price)}</td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditing(e)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => remove(e.id)} className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && payload && <EventForm initial={editing} venues={payload.venues} onClose={() => setEditing(null)} />}
      <Modal open={confirmPurge} onClose={() => setConfirmPurge(false)} title="Remover atrações antigas">
        <p className="text-sm text-mute">
          Serão excluídos {purgeCount} {purgeCount === 1 ? 'evento já realizado' : 'eventos já realizados'}
          {venueFilter ? <> de <span className="text-bone">{payload?.venues.find((v) => v.id === venueFilter)?.name}</span></> : ' de todas as casas'}, junto com as avaliações dessas edições. Esta ação não pode ser desfeita.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setConfirmPurge(false)} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={purgePast} className="btn-outline btn-sm">Remover</button>
        </div>
      </Modal>
    </div>
  );
}

function EventForm({ initial, venues, onClose }: { initial: Partial<EventItem>; venues: Venue[]; onClose: () => void }) {
  const { data, bump } = useApp();
  const toast = useToast();
  const [e, setE] = useState<Partial<EventItem>>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EventItem>(k: K, val: EventItem[K]) => setE((s) => ({ ...s, [k]: val }));

  const upload = async (f?: File) => {
    if (!f) return;
    try {
      set('cover_image', await data.uploadImage(f, 'venue-images'));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha no envio.', 'error');
    }
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    try {
      await data.admin.upsertEvent({ ...e, name: e.name ?? '', venue_id: e.venue_id ?? '' });
      bump();
      toast('Evento salvo.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  };

  return (
    <Modal open onClose={onClose} title={initial.id ? 'Editar evento' : 'Novo evento'} wide>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da festa / evento"><input className="field" required value={e.name ?? ''} onChange={(x) => set('name', x.target.value)} /></Field>
        <FilterSelect label="Boate / local (obrigatório)" value={e.venue_id ?? ''} onChange={(x) => set('venue_id', x)} options={venues.map((v) => ({ value: v.id, label: `${v.name} — ${v.city}` }))} />
        <Field label="Data"><input className="field" type="date" required value={e.event_date ?? ''} onChange={(x) => set('event_date', x.target.value)} /></Field>
        <Field label="Horário"><input className="field" type="time" value={e.start_time ?? '23:00'} onChange={(x) => set('start_time', x.target.value)} /></Field>
        <Field label="Preço (R$)"><input className="field" type="number" min={0} step="0.01" value={e.ticket_price ?? ''} onChange={(x) => set('ticket_price', x.target.value === '' ? null : Number(x.target.value))} /></Field>
        <Field label="Link de ingressos"><input className="field" type="url" value={e.ticket_url ?? ''} onChange={(x) => set('ticket_url', x.target.value || null)} /></Field>
        <Field label="DJs / artistas (separados por vírgula — o primeiro é o destaque)" full><input className="field" value={(e.dj_names ?? []).join(', ')} onChange={(x) => set('dj_names', x.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
        <Field label="Estilos (separados por vírgula)" full><input className="field" value={(e.music_styles ?? []).join(', ')} onChange={(x) => set('music_styles', x.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
        <Field label="Imagem de divulgação / foto do artista (URL ou envio)" full>
          <div className="flex gap-3">
            {e.cover_image && <div className="h-12 w-16 shrink-0 overflow-hidden rounded-[3px] border border-line"><Photo src={e.cover_image} alt="" zoom={false} /></div>}
            <input className="field" value={e.cover_image?.startsWith('data:') ? '(imagem enviada)' : e.cover_image ?? ''} onChange={(x) => set('cover_image', x.target.value)} placeholder="/images/stage-glow.jpg" />
            <label className="btn-ghost btn-sm h-12 cursor-pointer whitespace-nowrap">Enviar<input type="file" accept="image/*" className="sr-only" onChange={(x) => upload(x.target.files?.[0])} /></label>
          </div>
        </Field>
        <Field label="Informações adicionais (descrição)" full><textarea className="field h-auto py-3" rows={3} value={e.description ?? ''} onChange={(x) => set('description', x.target.value)} /></Field>
        <div className="sm:col-span-2"><FieldError message={error} /></div>
        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">Cancelar</button>
          <button className="btn-primary btn-sm">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ users
function UsersAdmin() {
  const { data, version, bump, user } = useApp();
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data: users } = useAsync(() => data.admin.listProfiles(), [data, version]);
  const list = (users ?? []).filter((u) => !q || `${u.full_name} ${u.username}`.toLowerCase().includes(q.toLowerCase()));

  const changeRole = async (id: string, role: UserRole) => {
    try {
      await data.admin.setRole(id, role);
      bump();
      toast(`Papel alterado para ${ROLE_LABEL[role]}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar usuário" className="field mb-6 max-w-sm" />
      {!users ? <Skeleton className="h-64" /> : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[680px] text-left text-[13px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
              <tr><th className="p-4">Usuário</th><th className="p-4">Cidade</th><th className="p-4">Avaliações</th><th className="p-4">Desde</th><th className="p-4">Papel</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((u) => (
                <tr key={u.id} className="hover:bg-panel">
                  <td className="p-4"><Link href={`/u/${u.username}`} className="flex items-center gap-3 hover:text-red-bright"><Avatar profile={u} size={30} /> <span>{u.full_name || u.username}<span className="ml-2 text-mute">@{u.username}</span></span></Link></td>
                  <td className="p-4 text-mute">{u.city ?? '—'}</td>
                  <td className="p-4 text-mute">{u.review_count}</td>
                  <td className="p-4 text-mute">{formatDate(u.created_at)}</td>
                  <td className="p-4">
                    <select aria-label={`Papel de @${u.username}`} disabled={u.id === user?.id} value={u.role} onChange={(ev) => changeRole(u.id, ev.target.value as UserRole)}
                      className={clsx('h-9 rounded-full border border-line bg-panel px-3 text-[11px] font-semibold uppercase tracking-nav', u.role !== 'comprador' && 'border-red-bright text-red-bright', u.id === user?.id && 'opacity-50')}>
                      {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ reviews
function ReviewsAdmin() {
  const { data, version, bump } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<'all' | ReviewStatus>('all');
  const [limit, setLimit] = useState(30);
  const { data: reviews } = useAsync(() => data.listReviews({ includeHidden: true, sort: 'recent' }), [data, version]);
  const list = (reviews ?? []).filter((r) => status === 'all' || r.review.status === status);

  const change = async (id: string, s: ReviewStatus) => {
    try {
      await data.admin.setReviewStatus(id, s);
      bump();
      toast('Visibilidade atualizada.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  return (
    <div>
      <ReviewImportPanel />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todas' }, { value: 'published', label: 'Publicadas' }, { value: 'flagged', label: 'Sinalizadas' }, { value: 'hidden', label: 'Ocultas' }]} />
        <p className="max-w-md text-[12px] text-mute">A moderação altera apenas a visibilidade. Notas e comentários de avaliações legítimas não podem ser editados por ninguém além do autor.</p>
      </div>
      {!reviews ? <Skeleton className="h-64" /> : (
        <>
          <ul className="divide-y divide-line rounded-card border border-line">
            {list.slice(0, limit).map((r) => (
              <li key={r.review.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="text-[13px]">{r.review.source === 'pre_launch' && <PreLaunchTag className="mr-2" />}<span className="font-semibold">@{r.author.username}</span> <span className="text-mute">em</span> <Link href={`/boates/${r.venue.slug}`} className="font-semibold hover:text-red-bright">{r.venue.name}</Link> <span className="ml-2 font-display font-bold text-red-bright">{r.review.overall_rating.toFixed(1)}</span></p>
                  <p className="mt-1 truncate text-[12px] text-mute">{r.review.comment || '(sem comentário)'}</p>
                </div>
                <select value={r.review.status} onChange={(e) => change(r.review.id, e.target.value as ReviewStatus)} className="field h-9 w-40 text-[12px]" aria-label="Status">
                  <option value="published">Publicada</option>
                  <option value="flagged">Sinalizada</option>
                  <option value="hidden">Oculta</option>
                </select>
              </li>
            ))}
          </ul>
          {limit < list.length && <button onClick={() => setLimit((l) => l + 30)} className="btn-ghost btn-sm mt-6">Carregar mais ({list.length - limit})</button>}
        </>
      )}
    </div>
  );
}

function ReviewImportPanel() {
  const { data, bump } = useApp();
  const toast = useToast();
  const [showGuide, setShowGuide] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const downloadTemplate = async () => {
    const venues = await data.listVenues().catch(() => []);
    const csv = buildTemplateCsv(venues.map((v) => v.slug));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-avaliacoes-nooff.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 2_000_000) return toast('Arquivo muito grande (máx. 2 MB).', 'error');
    if (/\.xlsx?$/i.test(f.name)) return toast('Salve a planilha como CSV (Arquivo › Salvar como › CSV) e envie novamente.', 'error');
    try {
      const [text, venues] = await Promise.all([f.text(), data.listVenues()]);
      setFileName(f.name);
      setConsent(false);
      setServerError(null);
      setParsed(parseReviewImport(text, venues));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.', 'error');
    }
  };

  const close = () => {
    setParsed(null);
    setServerError(null);
  };

  const confirm = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    setServerError(null);
    try {
      const res = await data.admin.importReviews(parsed.rows);
      bump();
      toast(`${res.created} ${res.created === 1 ? 'avaliação importada' : 'avaliações importadas'} · ${res.profiles_created} ${res.profiles_created === 1 ? 'perfil criado' : 'perfis criados'}.`);
      close();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Erro ao importar.');
    } finally {
      setBusy(false);
    }
  };

  const authors = parsed ? new Set(parsed.rows.map((r) => r.author_username)).size : 0;

  return (
    <div className="card mb-8 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="eyebrow">Importar avaliações do pré-lançamento</p>
          <p className="mt-2 text-[12px] leading-relaxed text-mute">
            Para avaliações reais coletadas antes do lançamento (beta, formulário, evento) <span className="text-bone">com autorização de cada pessoa</span>.
            Elas contam nas médias e rankings e aparecem com a tag “Coletada no pré-lançamento”.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={downloadTemplate} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /> Baixar modelo</button>
          <label className="btn-primary btn-sm cursor-pointer">
            <Upload className="h-3.5 w-3.5" /> Importar planilha
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      <button onClick={() => setShowGuide((v) => !v)} className="mt-4 text-[11px] font-semibold text-mute hover:text-bone">
        {showGuide ? 'Ocultar colunas do modelo' : 'Ver colunas do modelo'}
      </button>
      {showGuide && (
        <dl className="mt-3 grid gap-2 text-[12px]">
          {TEMPLATE_GUIDE.map((g) => (
            <div key={g.column} className="grid gap-1 sm:grid-cols-[260px_1fr]">
              <dt className="font-mono text-[11px] text-red-bright">{g.column}</dt>
              <dd className="text-mute">{g.help}</dd>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-mute">Edite no Excel ou Google Sheets e salve como <span className="text-bone">CSV</span>. A nota geral é calculada automaticamente.</p>
        </dl>
      )}

      <Modal open={!!parsed} onClose={close} title="Prévia da importação" wide>
        {parsed && (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-mute">
              <span className="text-bone">{fileName}</span> · {parsed.rows.length} {parsed.rows.length === 1 ? 'avaliação válida' : 'avaliações válidas'} de {authors} {authors === 1 ? 'autor' : 'autores'}
              {parsed.errors.length > 0 && <> · <span className="text-bone">{new Set(parsed.errors.map((e) => e.line)).size} com erro</span></>}
            </p>
            {parsed.errors.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-card border border-line p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-nav text-bone">Corrija na planilha e envie de novo</p>
                <ul className="flex flex-col gap-1 text-[12px] text-mute">
                  {parsed.errors.map((e, i) => <li key={i}><span className="text-bone">Linha {e.line}:</span> {e.message}</li>)}
                </ul>
              </div>
            )}
            {parsed.rows.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-card border border-line">
                <table className="w-full min-w-[640px] text-left text-[12px]">
                  <thead className="sticky top-0 border-b border-line bg-ink text-[10px] uppercase tracking-nav text-mute">
                    <tr><th className="p-3">Linha</th><th className="p-3">Autor</th><th className="p-3">Local</th><th className="p-3">Nota</th><th className="p-3">Comentário</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {parsed.rows.map((r) => (
                      <tr key={r.line}>
                        <td className="p-3 text-mute">{r.line}</td>
                        <td className="p-3">{r.author_name || r.author_username} <span className="text-mute">@{r.author_username}</span></td>
                        <td className="p-3 text-mute">{r.venue_slug}</td>
                        <td className="p-3 font-display font-bold text-red-bright">{computeOverall(r).toFixed(1)}</td>
                        <td className="max-w-[260px] truncate p-3 text-mute">{r.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {parsed.errors.length === 0 && parsed.rows.length > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line p-4">
                <input type="checkbox" className="mt-1 accent-[#E10600]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="text-[12px] leading-relaxed text-mute">
                  Confirmo que estas avaliações foram escritas por pessoas reais, que autorizaram a publicação com o nome/apelido indicado.
                </span>
              </label>
            )}
            <FieldError message={serverError} />
            <div className="flex justify-end gap-3">
              <button onClick={close} className="btn-ghost btn-sm">Cancelar</button>
              <button onClick={confirm} disabled={busy || !consent || parsed.errors.length > 0 || !parsed.rows.length} className="btn-primary btn-sm">
                {busy ? 'Importando…' : `Importar ${parsed.rows.length}`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ reports
function ReportsAdmin() {
  const { data, version, bump } = useApp();
  const toast = useToast();
  const { data: reports } = useAsync(() => data.admin.listReports(), [data, version]);

  const resolve = async (id: string, action: 'dismiss' | 'hide_review') => {
    try {
      await data.admin.resolveReport(id, action);
      bump();
      toast(action === 'dismiss' ? 'Denúncia descartada.' : 'Avaliação ocultada.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  if (!reports) return <Skeleton className="h-64" />;
  if (!reports.length) return <EmptyState title="Nenhuma denúncia" text="Quando a comunidade denunciar uma avaliação, ela aparece aqui." />;
  return (
    <ul className="flex flex-col gap-4">
      {reports.map(({ report, reporter, review, venue, author }) => (
        <li key={report.id} className={clsx('card p-5 sm:p-6', report.status !== 'pending' && 'opacity-60')}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-nav text-red-bright">{report.status === 'pending' ? 'Pendente' : report.status === 'upheld' ? 'Procedente' : 'Descartada'}</p>
              <p className="mt-2 text-[13px]">Motivo: <span className="text-bone">{report.reason}</span></p>
              <p className="mt-1 text-[11px] text-mute">Por @{reporter?.username ?? '—'} · {formatDate(report.created_at)}</p>
            </div>
            {report.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => resolve(report.id, 'dismiss')} className="btn-ghost btn-sm">Descartar</button>
                <button onClick={() => resolve(report.id, 'hide_review')} className="btn-outline btn-sm">Ocultar avaliação</button>
              </div>
            )}
          </div>
          {review && (
            <div className="mt-4 rounded-card border border-line p-4">
              <p className="text-[12px] text-mute">@{author?.username} em <span className="text-bone">{venue?.name}</span> · nota <span className="text-red-bright">{review.overall_rating.toFixed(1)}</span> · status {review.status}</p>
              <p className="mt-2 text-[13px] text-bone/85">{review.comment || '(sem comentário)'}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ newsletter
function NewsletterAdmin() {
  const { data, version, bump } = useApp();
  const { data: list } = useAsync(() => data.admin.listNewsletter(), [data, version]);

  const exportCsv = () => {
    const csv = ['email,created_at', ...(list ?? []).map((n) => `${n.email},${n.created_at}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'newsletter-nooff.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!list) return <Skeleton className="h-64" />;
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-[12px] text-mute">{list.length} inscritos</p>
        <button onClick={exportCsv} disabled={!list.length} className="btn-ghost btn-sm"><Download className="h-3.5 w-3.5" /> Exportar CSV</button>
      </div>
      {list.length === 0 ? <EmptyState title="Nenhum inscrito ainda" text="As inscrições feitas na home aparecem aqui." /> : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {list.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
              <span>{n.email}</span>
              <span className="flex items-center gap-4 text-mute">
                {formatDate(n.created_at)}
                <button onClick={async () => { await data.admin.deleteNewsletter(n.id); bump(); }} aria-label="Remover" className="hover:text-bone"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings
function SettingsAdmin() {
  const { data, bump } = useApp();
  const toast = useToast();
  const { data: initial } = useAsync(() => data.getSettings(), [data]);
  const [s, setS] = useState<PlatformSettings | null>(null);
  const [newStyle, setNewStyle] = useState('');
  const [confirmDemo, setConfirmDemo] = useState(false);
  const cur = s ?? initial;
  if (!cur) return <Skeleton className="h-64" />;
  const upd = (patch: Partial<PlatformSettings>) => setS({ ...cur, ...patch });

  const save = async () => {
    try {
      await data.admin.updateSettings(cur);
      bump();
      toast('Configurações salvas. Selos e rankings recalculados.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    }
  };

  const removeDemo = async () => {
    try {
      await data.admin.removeDemoData();
      bump();
      toast('Dados demonstrativos removidos.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro.', 'error');
    } finally {
      setConfirmDemo(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        <p className="eyebrow">Selo Approved</p>
        <Field label="Nota mínima"><input className="field" type="number" step="0.1" min={0} max={10} value={cur.approved_min_rating} onChange={(e) => upd({ approved_min_rating: Number(e.target.value) })} /></Field>
        <Field label="Avaliações válidas mínimas"><input className="field" type="number" min={1} value={cur.approved_min_reviews} onChange={(e) => upd({ approved_min_reviews: Number(e.target.value) })} /></Field>
        <Field label="Máx. proporção de avaliações denunciadas/ocultas (0–1)"><input className="field" type="number" step="0.01" min={0} max={1} value={cur.approved_max_flag_ratio} onChange={(e) => upd({ approved_max_flag_ratio: Number(e.target.value) })} /></Field>
        <p className="eyebrow mt-4">Algoritmo de ranking</p>
        <Field label="Peso da média bayesiana (m)"><input className="field" type="number" min={0} value={cur.bayes_prior_weight} onChange={(e) => upd({ bayes_prior_weight: Number(e.target.value) })} /></Field>
        <Field label="Meia-vida da recência (dias)"><input className="field" type="number" min={7} value={cur.recency_half_life_days} onChange={(e) => upd({ recency_half_life_days: Number(e.target.value) })} /></Field>
        <button onClick={save} className="btn-primary self-start">Salvar configurações</button>
      </div>

      <div className="flex flex-col gap-6">
        <div className="card p-6 sm:p-8">
          <p className="eyebrow">Categorias — estilos musicais</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {cur.music_styles.map((st) => (
              <span key={st} className="chip gap-2">
                {st}
                <button onClick={() => upd({ music_styles: cur.music_styles.filter((x) => x !== st) })} aria-label={`Remover ${st}`} className="hover:text-bone">×</button>
              </span>
            ))}
          </div>
          <div className="mt-5 flex gap-3">
            <input value={newStyle} onChange={(e) => setNewStyle(e.target.value)} placeholder="Novo estilo" className="field h-10" />
            <button onClick={() => { const v = newStyle.trim(); if (v && !cur.music_styles.includes(v)) upd({ music_styles: [...cur.music_styles, v] }); setNewStyle(''); }} className="btn-ghost btn-sm h-10">Adicionar</button>
          </div>
          <p className="mt-3 text-[11px] text-mute">Clique em “Salvar configurações” para aplicar.</p>
        </div>

        <div className="card p-6 sm:p-8">
          <p className="eyebrow">Dados demonstrativos</p>
          <p className="mt-3 text-[13px] leading-relaxed text-mute">Remove todas as casas, eventos, usuários e avaliações marcados como demonstração (is_demo). Conteúdo criado por usuários reais é mantido.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={() => setConfirmDemo(true)} className="btn-outline btn-sm">Remover dados demo</button>
            {data.admin.resetDemo && (
              <button onClick={async () => { await data.admin.resetDemo!(); location.href = '/'; }} className="btn-ghost btn-sm">Redefinir demonstração</button>
            )}
          </div>
        </div>
      </div>

      <Modal open={confirmDemo} onClose={() => setConfirmDemo(false)} title="Remover dados demonstrativos">
        <p className="text-sm text-mute">Todos os registros marcados como demonstração serão excluídos permanentemente{data.mode === 'demo' ? ' (incluindo a conta demo de usuário, mas não a sua sessão atual)' : ''}. Esta ação não pode ser desfeita.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setConfirmDemo(false)} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={removeDemo} className="btn-outline btn-sm">Remover</button>
        </div>
      </Modal>
    </div>
  );
}
