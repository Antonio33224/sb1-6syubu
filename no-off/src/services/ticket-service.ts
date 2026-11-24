'use client';
/**
 * Ingressos, painel do produtor e lista VIP — lado do navegador.
 *
 * Tudo usa o client Supabase com o token do usuário: a RLS e as funções
 * security definer (owns_event, reserve_order, checkin_*, producer_*) decidem
 * o que cada papel pode ver/alterar. Operações com dinheiro (reserva,
 * pagamento, emissão) passam pelas rotas /api (ver api-client.ts).
 * No modo demonstração estas funções não estão disponíveis.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDataService } from './index';
import { ServiceError } from './data-service';
import { SupabaseService } from './supabase-service';
import { mapPublicEvent, PUBLIC_EVENT_COLUMNS } from '@/lib/public-events';
import type {
  AttendeeHit,
  CheckinResult,
  EventDashboard,
  EventItem,
  EventWithVenue,
  Order,
  ProducerEventSummary,
  PublicBatch,
  Ticket,
  TicketBatch,
  TicketType,
  Venue,
  VipEntry,
  VipLink,
} from '@/types';

export const ticketsAvailable = () => getDataService() instanceof SupabaseService;

function sb(): SupabaseClient {
  const d = getDataService();
  if (!(d instanceof SupabaseService)) throw new ServiceError('Venda de ingressos disponível apenas com o Supabase configurado.');
  return d.client;
}

function fail(error: { message: string } | null): asserts error is null {
  if (!error) return;
  if (/row-level security|permission denied/i.test(error.message)) throw new ServiceError('Você não tem permissão para esta ação.');
  if (/duplicate key.*slug/i.test(error.message)) throw new ServiceError('Já existe uma festa com este endereço (slug).');
  throw new ServiceError(error.message);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function publicEventsByIds(ids: string[]): Promise<Map<string, EventWithVenue>> {
  if (!ids.length) return new Map();
  const { data, error } = await sb().from('public_events').select(PUBLIC_EVENT_COLUMNS).in('id', ids);
  fail(error);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const venueIds = [...new Set(rows.map((r) => r.venue_id).filter(Boolean) as string[])];
  const venues = new Map<string, Venue>();
  if (venueIds.length) {
    const { data: vs } = await sb().from('venues').select('*').in('id', venueIds);
    for (const v of (vs ?? []) as Venue[]) venues.set(v.id, { ...v, latitude: Number(v.latitude), longitude: Number(v.longitude) });
  }
  return new Map(rows.map((r) => [String(r.id), mapPublicEvent(r, venues)]));
}

// ------------------------------------------------------------------ comprador

export interface MyTicket extends Ticket {
  batch: { name: string; ticket_type: TicketType } | null;
  event: EventWithVenue | null;
}

export interface MyOrder extends Order {
  event: EventWithVenue | null;
  items: { quantity: number; unit_price: number; batch: { name: string } | null }[];
}

export const ticketService = {
  batches: async (eventId: string): Promise<PublicBatch[]> => {
    const { data, error } = await sb().rpc('public_event_batches', { p_event: eventId });
    fail(error);
    return ((data ?? []) as PublicBatch[]).map((b) => ({ ...b, price: num(b.price), available: num(b.available) }));
  },

  myTickets: async (): Promise<MyTicket[]> => {
    const { data, error } = await sb()
      .from('tickets')
      .select('id, order_id, event_id, batch_id, holder_name, code, status, used_at, created_at, batch:ticket_batches(name, ticket_type)')
      .order('created_at', { ascending: false });
    fail(error);
    const rows = (data ?? []) as unknown as MyTicket[];
    const events = await publicEventsByIds([...new Set(rows.map((t) => t.event_id))]);
    return rows.map((t) => ({ ...t, event: events.get(t.event_id) ?? null }));
  },

  myOrders: async (): Promise<MyOrder[]> => {
    const { data, error } = await sb()
      .from('orders')
      .select('*, items:order_items(quantity, unit_price, batch:ticket_batches(name))')
      .order('created_at', { ascending: false })
      .limit(50);
    fail(error);
    const rows = (data ?? []) as unknown as MyOrder[];
    const events = await publicEventsByIds([...new Set(rows.map((o) => o.event_id))]);
    return rows.map((o) => ({ ...o, total: Number(o.total), event: events.get(o.event_id) ?? null }));
  },

  getOrder: async (id: string): Promise<MyOrder | null> => {
    const { data, error } = await sb().from('orders').select('*, items:order_items(quantity, unit_price, batch:ticket_batches(name))').eq('id', id).maybeSingle();
    fail(error);
    if (!data) return null;
    const o = data as unknown as MyOrder;
    const events = await publicEventsByIds([o.event_id]);
    return { ...o, total: Number(o.total), event: events.get(o.event_id) ?? null };
  },

  eventById: async (id: string) => (await publicEventsByIds([id])).get(id) ?? null,

  /** E-mail/celular da sessão (pré-preenche os dados do comprador). */
  sessionContact: async (): Promise<{ email: string; phone: string }> => {
    const { data } = await sb().auth.getUser();
    return { email: data.user?.email ?? '', phone: data.user?.phone ?? '' };
  },
};

// ------------------------------------------------------------------ produtor

export type ProducerEventInput = Partial<EventItem> & { name: string; event_date: string };

const EVENT_COLUMNS = new Set([
  'name', 'slug', 'description', 'cover_image', 'event_date', 'start_time', 'ticket_price', 'ticket_url', 'dj_names', 'music_styles',
  'venue_id', 'location_name', 'address', 'city', 'state', 'category', 'gallery', 'capacity', 'status', 'vip_limit',
]);

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const producerService = {
  overview: async (): Promise<ProducerEventSummary[]> => {
    const { data, error } = await sb().rpc('producer_overview');
    fail(error);
    return ((data ?? []) as ProducerEventSummary[]).map((e) => ({ ...e, gross: Number(e.gross), sold: Number(e.sold) }));
  },

  /** Lê a festa da TABELA (RLS: só o dono ou o super admin). */
  getEvent: async (id: string): Promise<EventItem | null> => {
    const { data, error } = await sb().from('events').select('*').eq('id', id).maybeSingle();
    fail(error);
    return data ? ({ ...(data as EventItem), ticket_price: num((data as EventItem).ticket_price) } as EventItem) : null;
  },

  saveEvent: async (e: ProducerEventInput): Promise<EventItem> => {
    if (!e.name.trim()) throw new ServiceError('Informe o nome da festa.');
    if (!e.event_date) throw new ServiceError('Informe a data.');
    if (!e.venue_id && !e.city?.trim()) throw new ServiceError('Informe a cidade (ou escolha uma casa cadastrada).');
    if (e.state && e.state.trim().length !== 2) throw new ServiceError('UF com 2 letras.');
    const payload: Record<string, unknown> = Object.fromEntries(Object.entries(e).filter(([k]) => EVENT_COLUMNS.has(k)));
    payload.slug = (e.slug?.trim() || slugify(`${e.name}-${e.event_date}`)).slice(0, 120);
    if (typeof payload.state === 'string') payload.state = payload.state.toUpperCase();
    // Dono e visibilidade são definidos no banco (trigger protect_event_fields).
    const q = e.id ? sb().from('events').update(payload).eq('id', e.id) : sb().from('events').insert(payload);
    const { data, error } = await q.select().single();
    fail(error);
    return data as EventItem;
  },

  deleteEvent: async (id: string) => {
    const { error } = await sb().from('events').delete().eq('id', id);
    fail(error);
  },

  venues: async (): Promise<Venue[]> => {
    const { data, error } = await sb().from('venues').select('id, name, city, state, address, slug').order('name');
    fail(error);
    return (data ?? []) as Venue[];
  },

  // ---- lotes
  batches: async (eventId: string): Promise<TicketBatch[]> => {
    const { data, error } = await sb().from('ticket_batches').select('*').eq('event_id', eventId).order('ticket_type').order('sort_order');
    fail(error);
    return ((data ?? []) as TicketBatch[]).map((b) => ({ ...b, price: Number(b.price) }));
  },
  saveBatch: async (b: Partial<TicketBatch> & { event_id: string }): Promise<void> => {
    if (!b.name?.trim()) throw new ServiceError('Informe o nome do lote.');
    if (!b.price || b.price < 1) throw new ServiceError('Preço mínimo de R$ 1,00.');
    if (!b.quantity || b.quantity < 1) throw new ServiceError('Quantidade inválida.');
    if (b.sales_start && b.sales_end && b.sales_end <= b.sales_start) throw new ServiceError('O fim das vendas deve ser depois do início.');
    const { id, created_at: _c, ...rest } = b;
    const q = id ? sb().from('ticket_batches').update(rest).eq('id', id) : sb().from('ticket_batches').insert(rest);
    const { error } = await q;
    if (error && /foreign key|violates/i.test(error.message)) throw new ServiceError('Este lote já tem vendas e não pode ser excluído — encerre-o.');
    fail(error);
  },
  setBatchStatus: async (id: string, status: TicketBatch['status']) => {
    const { error } = await sb().from('ticket_batches').update({ status }).eq('id', id);
    fail(error);
  },
  deleteBatch: async (id: string) => {
    const { error } = await sb().from('ticket_batches').delete().eq('id', id);
    if (error && /foreign key|violates/i.test(error.message)) throw new ServiceError('Este lote já tem vendas e não pode ser excluído — encerre-o.');
    fail(error);
  },

  dashboard: async (eventId: string): Promise<EventDashboard> => {
    const { data, error } = await sb().rpc('producer_event_dashboard', { p_event: eventId });
    fail(error);
    const d = data as EventDashboard;
    return { ...d, gross: Number(d.gross), fees: Number(d.fees) };
  },

  /** Atualiza o dashboard a cada novo pedido/pagamento (Supabase Realtime + RLS). */
  subscribeOrders: (eventId: string, cb: () => void) => {
    const ch = sb()
      .channel(`orders-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `event_id=eq.${eventId}` }, cb)
      .subscribe();
    return () => {
      void sb().removeChannel(ch);
    };
  },

  // ---- lista VIP
  vipList: async (eventId: string): Promise<VipEntry[]> => {
    const { data, error } = await sb().from('vip_list').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
    fail(error);
    return (data ?? []) as VipEntry[];
  },
  addVip: async (rows: Pick<VipEntry, 'event_id' | 'name' | 'cpf' | 'email' | 'phone' | 'note' | 'source'>[]) => {
    if (!rows.length) return;
    const { error } = await sb().from('vip_list').insert(rows.map((r) => ({ ...r, status: 'approved' })));
    fail(error);
  },
  setVipStatus: async (id: string, status: VipEntry['status']) => {
    const { error } = await sb().from('vip_list').update({ status }).eq('id', id);
    fail(error);
  },
  updateVipNote: async (id: string, note: string) => {
    const { error } = await sb().from('vip_list').update({ note: note.slice(0, 300) }).eq('id', id);
    fail(error);
  },
  deleteVip: async (id: string) => {
    const { error } = await sb().from('vip_list').delete().eq('id', id);
    fail(error);
  },
  vipLinks: async (eventId: string): Promise<VipLink[]> => {
    const { data, error } = await sb().from('vip_signup_links').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
    fail(error);
    return (data ?? []) as VipLink[];
  },
  createVipLink: async (eventId: string, maxEntries: number | null, expiresAt: string | null) => {
    const { error } = await sb().from('vip_signup_links').insert({ event_id: eventId, max_entries: maxEntries, expires_at: expiresAt });
    fail(error);
  },
  setVipLinkActive: async (id: string, active: boolean) => {
    const { error } = await sb().from('vip_signup_links').update({ active }).eq('id', id);
    fail(error);
  },

  // ---- check-in
  checkinCode: async (eventId: string, code: string): Promise<CheckinResult> => {
    const { data, error } = await sb().rpc('checkin_ticket', { p_event: eventId, p_code: code });
    fail(error);
    return data as CheckinResult;
  },
  checkinTicket: async (ticketId: string): Promise<CheckinResult> => {
    const { data, error } = await sb().rpc('checkin_ticket_id', { p_ticket: ticketId });
    fail(error);
    return data as CheckinResult;
  },
  checkinVip: async (vipId: string): Promise<CheckinResult> => {
    const { data, error } = await sb().rpc('checkin_vip', { p_vip: vipId });
    fail(error);
    return data as CheckinResult;
  },
  searchAttendees: async (eventId: string, q: string): Promise<AttendeeHit[]> => {
    const { data, error } = await sb().rpc('search_attendees', { p_event: eventId, p_query: q });
    fail(error);
    return (data ?? []) as AttendeeHit[];
  },

  uploadImage: async (file: File) => getDataService().uploadImage(file, 'event-images'),
};

// ------------------------------------------------------------------ lista VIP pública

export interface PublicVipLink {
  event: { id: string; slug: string; name: string | null; event_date: string; start_time: string; city: string | null; state: string | null; cover_image: string };
  open: boolean;
}

export const vipPublicService = {
  link: async (token: string): Promise<PublicVipLink | null> => {
    const { data, error } = await sb().rpc('public_vip_link', { p_token: token });
    fail(error);
    return (data as PublicVipLink | null) ?? null;
  },
  signup: async (token: string, input: { name: string; email: string; phone: string; cpf: string }) => {
    const { data, error } = await sb().rpc('vip_signup', { p_token: token, p_name: input.name, p_email: input.email, p_phone: input.phone, p_cpf: input.cpf });
    fail(error);
    return data as { ok: true; duplicate?: boolean };
  },
};
