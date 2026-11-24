'use client';
/**
 * Chamadas às rotas /api do próprio site com o token Supabase do usuário logado.
 * Usado pelo checkout, painel do produtor, painel do super admin (auditoria,
 * segurança, festas, produtores, vendas) e pelo registro de falhas de login.
 * Toda autorização é conferida de novo no servidor e no banco (RLS + funções).
 */
import type {
  AdminEventRow,
  AdminProducerRow,
  BuyerInfo,
  CartItem,
  EventVisibility,
  OrderStatus,
  UserRole,
} from '@/types';
import { getDataService } from './index';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function accessToken(): Promise<string | null> {
  const { data: s } = await getDataService().client.auth.getSession();
  return s.session?.access_token ?? null;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const t = await accessToken();
    if (!t) throw new ApiError('Entre na sua conta para continuar.', 401, 'unauthenticated');
    headers.authorization = `Bearer ${t}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) throw new ApiError(json.error ?? `Erro ${res.status}`, res.status, json.code);
  return json;
}

// ------------------------------------------------------------------ checkout

export interface ReserveResponse {
  order_id: string;
  total: number;
  expires_at: string;
}

export interface PayResponse {
  status: 'approved' | 'pending' | 'in_process' | 'rejected' | 'cancelled' | string;
  status_detail: string | null;
  payment_id: string;
  order_status: OrderStatus;
  /** Pix: copia-e-cola e QR em base64. */
  pix?: { qr_code: string; qr_code_base64: string; expires_at: string | null } | null;
  /** Boleto: link do PDF. */
  boleto_url?: string | null;
}

export interface OrderStatusResponse {
  order: { id: string; status: OrderStatus; total: number; expires_at: string; payment_method: string | null; event_id: string };
  tickets: number;
}

export const checkoutApi = {
  reserve: (event_id: string, items: CartItem[], buyer: BuyerInfo) => api<ReserveResponse>('POST', '/api/checkout/reserve', { event_id, items, buyer }),
  /** formData = objeto devolvido pelo Payment Brick no onSubmit. O valor é recalculado no servidor. */
  pay: (order_id: string, formData: Record<string, unknown>) => api<PayResponse>('POST', '/api/checkout/pay', { order_id, formData }),
  status: (order_id: string) => api<OrderStatusResponse>('GET', `/api/orders/${order_id}`),
  cancel: (order_id: string) => api<{ ok: true }>('DELETE', `/api/orders/${order_id}`),
};

// ------------------------------------------------------------------ produtor

export const producerApi = {
  /** Gera o relatório e devolve um arquivo (csv | xlsx | pdf). */
  reportFile: async (eventId: string, format: 'csv' | 'xlsx' | 'pdf', section: 'compradores' | 'vip' | 'faturamento' | 'completo') => {
    const t = await accessToken();
    if (!t) throw new ApiError('Entre na sua conta para continuar.', 401, 'unauthenticated');
    const res = await fetch(`/api/producer/events/${eventId}/report?format=${format}&section=${section}`, { headers: { authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(j.error ?? `Erro ${res.status}`, res.status);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `relatorio.${format}`;
    return { blob: await res.blob(), name };
  },
};

// ------------------------------------------------------------------ super admin

export interface AdminUserHit {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: UserRole;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  metadata: Record<string, unknown>;
  actor: { username: string } | null;
}

export interface SecuritySettings {
  admin_alert_email: string | null;
  login_alert_threshold: number;
  login_alert_window_minutes: number;
  login_alert_cooldown_minutes: number;
  last_login_alert_at: string | null;
  updated_at: string;
}

export interface VisibilityInput {
  visibility: EventVisibility;
  hide_price: boolean;
  hide_location: boolean;
  hide_name: boolean;
  hide_capacity: boolean;
}

export interface AdminSales {
  totals: { gross: number; fees: number; orders: number; tickets: number; refunded: number };
  orders: { id: string; buyer_name: string; buyer_email: string; total: number; status: OrderStatus; payment_method: string | null; created_at: string; paid_at: string | null; event_name: string; event_id: string }[];
}

export const adminApi = {
  findUsers: (q: string) => api<{ users: AdminUserHit[] }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.users),

  audit: (params: { before?: number; severity?: string; action?: string; target?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.before) sp.set('before', String(params.before));
    if (params.severity) sp.set('severity', params.severity);
    if (params.action) sp.set('action', params.action);
    if (params.target) sp.set('target', params.target);
    return api<{ entries: AuditEntry[] }>('GET', `/api/admin/audit?${sp}`).then((r) => r.entries);
  },

  security: () => api<{ settings: SecuritySettings | null; smtp_configured: boolean }>('GET', '/api/admin/security'),
  saveSecurity: (s: Pick<SecuritySettings, 'login_alert_threshold' | 'login_alert_window_minutes' | 'login_alert_cooldown_minutes'> & { admin_alert_email: string }) =>
    api<{ settings: SecuritySettings }>('PUT', '/api/admin/security', s).then((r) => r.settings),
  testEmail: () => api<{ ok: true; sent_to: string }>('POST', '/api/admin/security'),

  events: () => api<{ events: AdminEventRow[] }>('GET', '/api/admin/events').then((r) => r.events),
  setVisibility: (id: string, v: VisibilityInput) => api<{ ok: true }>('PATCH', `/api/admin/events/${id}`, { action: 'visibility', ...v }),
  setEventStatus: (id: string, status: 'draft' | 'published' | 'cancelled' | 'suspended', reason = '') =>
    api<{ ok: true }>('PATCH', `/api/admin/events/${id}`, { action: 'status', status, reason }),

  producers: () => api<{ producers: AdminProducerRow[] }>('GET', '/api/admin/producers').then((r) => r.producers),
  setSuspended: (userId: string, suspended: boolean, reason = '') => api<{ ok: true }>('PATCH', '/api/admin/producers', { user_id: userId, suspended, reason }),

  sales: () => api<AdminSales>('GET', '/api/admin/sales'),
};
