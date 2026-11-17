'use client';
/**
 * Chamadas às rotas /api do próprio site com o token Supabase do usuário logado.
 * Usado por cupons, painel admin (cupons, gratuidades, auditoria, segurança) e
 * pelo registro de falhas de login.
 */
import type { PremiumGrant } from '@/types';
import { getDataService } from './index';
import { SupabaseService } from './supabase-service';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const apiAvailable = () => getDataService() instanceof SupabaseService;

async function token(): Promise<string | null> {
  const data = getDataService();
  if (!(data instanceof SupabaseService)) return null;
  const { data: s } = await data.client.auth.getSession();
  return s.session?.access_token ?? null;
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const t = await token();
    if (!t) throw new ApiError(apiAvailable() ? 'Entre na sua conta para continuar.' : 'Disponível apenas com o banco de dados (Supabase) configurado.', 401, 'unauthenticated');
    headers.authorization = `Bearer ${t}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) throw new ApiError(json.error ?? `Erro ${res.status}`, res.status, json.code);
  return json;
}

// ------------------------------------------------------------------ cupons (usuário)

export interface RedeemResponse {
  ok: true;
  grant_id: string;
  starts_at: string;
  ends_at: string;
  days: number;
}

export const redeemCoupon = (code: string) => api<RedeemResponse>('POST', '/api/coupons/redeem', { code });

// ------------------------------------------------------------------ admin

export interface AdminCoupon {
  id: string;
  code: string;
  description: string;
  grant_days: number;
  max_redemptions: number | null;
  per_user_limit: number;
  redemptions_count: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  created_at: string;
}

export type CouponInput = Omit<AdminCoupon, 'id' | 'redemptions_count' | 'created_at'> & { id?: string | null };

export interface AdminGrant extends PremiumGrant {
  revoke_reason: string | null;
  user: { id: string; username: string; full_name: string } | null;
  coupon: { code: string } | null;
}

export interface AdminUserHit {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: 'user' | 'admin';
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

export const adminApi = {
  listCoupons: () => api<{ coupons: AdminCoupon[] }>('GET', '/api/admin/coupons').then((r) => r.coupons),
  saveCoupon: (c: CouponInput) => api<{ coupon: AdminCoupon }>('POST', '/api/admin/coupons', c).then((r) => r.coupon),
  setCouponActive: (id: string, active: boolean) => api<{ ok: true }>('PATCH', '/api/admin/coupons', { id, active }),

  listGrants: () => api<{ grants: AdminGrant[] }>('GET', '/api/admin/grants').then((r) => r.grants),
  grant: (user_id: string, days: number, reason: string) => api<{ grant: PremiumGrant }>('POST', '/api/admin/grants', { user_id, days, reason }).then((r) => r.grant),
  revokeGrant: (id: string, reason: string) => api<{ ok: true }>('DELETE', '/api/admin/grants', { id, reason }),
  findUsers: (q: string) => api<{ users: AdminUserHit[] }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}`).then((r) => r.users),

  audit: (params: { before?: number; severity?: string; action?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.before) sp.set('before', String(params.before));
    if (params.severity) sp.set('severity', params.severity);
    if (params.action) sp.set('action', params.action);
    return api<{ entries: AuditEntry[] }>('GET', `/api/admin/audit?${sp}`).then((r) => r.entries);
  },

  security: () => api<{ settings: SecuritySettings | null; smtp_configured: boolean }>('GET', '/api/admin/security'),
  saveSecurity: (s: Pick<SecuritySettings, 'login_alert_threshold' | 'login_alert_window_minutes' | 'login_alert_cooldown_minutes'> & { admin_alert_email: string }) =>
    api<{ settings: SecuritySettings }>('PUT', '/api/admin/security', s).then((r) => r.settings),
  testEmail: () => api<{ ok: true; sent_to: string }>('POST', '/api/admin/security'),
};
