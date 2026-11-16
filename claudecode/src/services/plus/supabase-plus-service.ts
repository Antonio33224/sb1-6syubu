'use client';
/**
 * SupabasePlusService — Classify+ com backend real.
 *  - Leitura/escrita de dados do próprio usuário: tabelas protegidas por RLS.
 *  - Regras sensíveis (resgate, geração de alertas, métricas): RPCs security definer.
 *  - Pagamentos: rotas do servidor em /api/billing/* (Stripe). O navegador nunca
 *    recebe chaves secretas nem dados de cartão; o status da assinatura só muda
 *    por webhook validado.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ALERTS, normalizeName } from '@/lib/plus/alerts';
import { benefitAvailability, validateBenefit } from '@/lib/plus/metrics';
import { normalizeWeights } from '@/lib/plus/personal-ranking';
import type {
  ActivityEntry,
  ArtistFavorite,
  ArtistKind,
  BenefitRedemption,
  BenefitWithMeta,
  PlanId,
  PlusAdminMetrics,
  PlusNotification,
  PremiumBenefit,
  RankingPreset,
  Subscription,
  SubscriptionPayment,
  UserPreferences,
} from '@/types';
import { ServiceError } from '../data-service';
import type { BillingStatus, CheckoutResult, PlusService } from './plus-service';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new ServiceError(/row-level security/i.test(error.message) ? 'Você não tem permissão para esta ação.' : error.message);
}

type Row = Record<string, unknown>;

const mapPrefs = (userId: string, r: Row | null): UserPreferences => ({
  user_id: userId,
  ranking_presets: ((r?.ranking_presets as RankingPreset[]) ?? []).map((p) => ({ ...p, weights: normalizeWeights(p.weights) })),
  active_preset_id: (r?.active_preset_id as string) ?? null,
  alerts: r
    ? {
        enabled: Boolean(r.alerts_enabled), venues: Boolean(r.alert_venues), artists: Boolean(r.alert_artists),
        events: Boolean(r.alert_events), email: Boolean(r.email_opt_in), push: Boolean(r.push_opt_in),
      }
    : { ...DEFAULT_ALERTS },
  saved_filters: (r?.saved_filters as UserPreferences['saved_filters']) ?? null,
  updated_at: (r?.updated_at as string) ?? new Date().toISOString(),
});

const mapBenefit = (r: Row): PremiumBenefit => ({
  ...(r as unknown as PremiumBenefit),
  total_quantity: r.total_quantity === null || r.total_quantity === undefined ? null : num(r.total_quantity),
});

export class SupabasePlusService implements PlusService {
  readonly mode = 'supabase' as const;

  constructor(private sb: SupabaseClient) {}

  private async session() {
    const { data } = await this.sb.auth.getSession();
    return data.session;
  }

  private async requireUid() {
    const s = await this.session();
    if (!s) throw new ServiceError('Entre na sua conta para continuar.');
    return s.user.id;
  }

  /** Chama uma rota de cobrança do servidor autenticando com o token da sessão. */
  private async billing<T>(path: string, body?: unknown): Promise<T> {
    const s = await this.session();
    if (!s) throw new ServiceError('Entre na sua conta para continuar.');
    const res = await fetch(`/api/billing/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
    if (!res.ok) throw new ServiceError(json.error ?? 'Não foi possível concluir a operação de cobrança.');
    return json;
  }

  // ------------------------------------------------------------ assinatura
  async billingStatus(): Promise<BillingStatus> {
    try {
      const res = await fetch('/api/billing/status', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      return (await res.json()) as BillingStatus;
    } catch {
      return { configured: false, provider: null, message: 'Não foi possível verificar a configuração de pagamentos.' };
    }
  }

  async listMySubscriptions() {
    const s = await this.session();
    if (!s) return [];
    const { data, error } = await this.sb.from('subscriptions').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false });
    fail(error);
    return (data ?? []) as Subscription[];
  }

  async listMyPayments() {
    const s = await this.session();
    if (!s) return [];
    const { data, error } = await this.sb.from('subscription_payments').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false });
    fail(error);
    return (data ?? []).map((p: Row) => ({ ...(p as unknown as SubscriptionPayment), amount_cents: num(p.amount_cents) }));
  }

  async startCheckout(plan: PlanId): Promise<CheckoutResult> {
    const { url } = await this.billing<{ url: string }>('checkout', { plan });
    return { kind: 'redirect', url };
  }

  async cancelSubscription() {
    await this.billing('cancel');
  }

  async resumeSubscription() {
    await this.billing('resume');
  }

  async billingPortalUrl() {
    const { url } = await this.billing<{ url: string | null }>('portal');
    return url;
  }

  // ------------------------------------------------------------ preferências
  async getPreferences() {
    const me = await this.requireUid();
    const { data, error } = await this.sb.from('user_preferences').select('*').eq('user_id', me).maybeSingle();
    fail(error);
    return mapPrefs(me, data);
  }

  async savePreferences(patch: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>) {
    const me = await this.requireUid();
    const cur = await this.getPreferences();
    const next = { ...cur, ...patch, alerts: { ...cur.alerts, ...(patch.alerts ?? {}) } };
    if (next.ranking_presets.length > 10) throw new ServiceError('Máximo de 10 configurações salvas.');
    const payload = {
      user_id: me,
      ranking_presets: next.ranking_presets.map((p) => ({ ...p, name: p.name.trim().slice(0, 40) || 'Meu ranking', weights: normalizeWeights(p.weights) })),
      active_preset_id: next.active_preset_id,
      alerts_enabled: next.alerts.enabled,
      alert_venues: next.alerts.venues,
      alert_artists: next.alerts.artists,
      alert_events: next.alerts.events,
      email_opt_in: next.alerts.email,
      push_opt_in: next.alerts.push,
      saved_filters: next.saved_filters,
    };
    const { data, error } = await this.sb.from('user_preferences').upsert(payload, { onConflict: 'user_id' }).select().single();
    fail(error);
    return mapPrefs(me, data);
  }

  // ------------------------------------------------------------ artistas
  async listArtistFavorites() {
    const s = await this.session();
    if (!s) return [];
    const { data, error } = await this.sb.from('user_favorites').select('*').eq('user_id', s.user.id).order('name');
    fail(error);
    return (data ?? []) as ArtistFavorite[];
  }

  async toggleArtistFavorite(name: string, kind: ArtistKind) {
    const me = await this.requireUid();
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 80) throw new ServiceError('Informe um nome entre 2 e 80 caracteres.');
    const key = normalizeName(clean);
    const { data: existing } = await this.sb.from('user_favorites').select('id').eq('user_id', me).eq('name_key', key).maybeSingle();
    if (existing) {
      const { error } = await this.sb.from('user_favorites').delete().eq('id', existing.id);
      fail(error);
      return false;
    }
    // name_key é recalculado no servidor (trigger) — o valor enviado é apenas conveniência.
    const { error } = await this.sb.from('user_favorites').insert({ user_id: me, kind, name: clean, name_key: key });
    fail(error);
    return true;
  }

  // ------------------------------------------------------------ notificações
  async listNotifications() {
    const s = await this.session();
    if (!s) return [];
    const { data, error } = await this.sb.from('notifications').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(200);
    fail(error);
    return (data ?? []) as PlusNotification[];
  }

  async syncNotifications() {
    const s = await this.session();
    if (!s) return 0;
    const { data, error } = await this.sb.rpc('sync_my_notifications');
    fail(error);
    return num(data);
  }

  async markNotificationsRead(ids?: string[]) {
    const me = await this.requireUid();
    let q = this.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null);
    if (ids?.length) q = q.in('id', ids);
    const { error } = await q;
    fail(error);
  }

  async deleteNotification(id: string) {
    const me = await this.requireUid();
    const { error } = await this.sb.from('notifications').delete().eq('id', id).eq('user_id', me);
    fail(error);
  }

  // ------------------------------------------------------------ benefícios
  private async benefitsWithMeta(onlyActive: boolean): Promise<BenefitWithMeta[]> {
    const s = await this.session();
    let q = this.sb.from('premium_benefits').select('*, venue:venues(name, slug)').order('valid_until');
    if (onlyActive) q = q.eq('active', true);
    const [{ data, error }, counts, mine] = await Promise.all([
      q,
      this.sb.rpc('benefit_redemption_counts'),
      s ? this.sb.from('benefit_redemptions').select('*').eq('user_id', s.user.id) : Promise.resolve({ data: [] as Row[] }),
    ]);
    fail(error);
    const countMap = new Map(((counts.data as { benefit_id: string; redeemed: number }[]) ?? []).map((c) => [c.benefit_id, num(c.redeemed)]));
    const myMap = new Map(((mine.data as BenefitRedemption[]) ?? []).map((r) => [r.benefit_id, r]));
    return (data ?? []).map((r: Row) => {
      const benefit = mapBenefit(r);
      const venue = r.venue as { name: string; slug: string } | null;
      const redeemed = countMap.get(benefit.id) ?? 0;
      return {
        benefit,
        venueName: venue?.name ?? 'Estabelecimento removido',
        venueSlug: venue?.slug ?? null,
        redeemed,
        myRedemption: myMap.get(benefit.id) ?? null,
        availability: benefitAvailability(benefit, redeemed),
      };
    });
  }

  async listBenefits() {
    return this.benefitsWithMeta(true);
  }

  async redeemBenefit(benefitId: string) {
    await this.requireUid();
    const { data, error } = await this.sb.rpc('redeem_benefit', { p_benefit: benefitId });
    fail(error);
    const row = (Array.isArray(data) ? data[0] : data) as BenefitRedemption | null;
    if (!row) throw new ServiceError('Não foi possível resgatar o benefício.');
    return row;
  }

  // ------------------------------------------------------------ histórico
  async listActivity() {
    const s = await this.session();
    if (!s) return [];
    const { data, error } = await this.sb.from('user_activity_history').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(300);
    fail(error);
    return (data ?? []) as ActivityEntry[];
  }

  // ------------------------------------------------------------ admin
  admin = {
    metrics: async (): Promise<PlusAdminMetrics> => {
      const { data, error } = await this.sb.rpc('admin_plus_metrics');
      fail(error);
      const m = (data ?? {}) as Record<string, unknown>;
      return {
        total_users: num(m.total_users), subscribers: num(m.subscribers), monthly_active: num(m.monthly_active),
        annual_active: num(m.annual_active), trialing: num(m.trialing), canceled_with_access: num(m.canceled_with_access),
        expired: num(m.expired), past_due: num(m.past_due), conversion_rate: num(m.conversion_rate),
        mrr_estimated_cents: num(m.mrr_estimated_cents), arr_run_rate_cents: num(m.arr_run_rate_cents),
        annual_contracted_cents: num(m.annual_contracted_cents), received_total_cents: num(m.received_total_cents),
        received_30d_cents: num(m.received_30d_cents), failed_payments_30d: num(m.failed_payments_30d),
        top_benefits: ((m.top_benefits as PlusAdminMetrics['top_benefits']) ?? []).map((b) => ({ ...b, redemptions: num(b.redemptions) })),
      };
    },
    listBenefits: async () => this.benefitsWithMeta(false),
    upsertBenefit: async (b: Partial<PremiumBenefit>) => {
      const err = validateBenefit(b);
      if (err) throw new ServiceError(err);
      const { id, created_at: _c, ...rest } = b;
      const payload = { ...rest, total_quantity: rest.total_quantity ?? null, image_url: rest.image_url ?? '' };
      const q = id ? this.sb.from('premium_benefits').update(payload).eq('id', id) : this.sb.from('premium_benefits').insert(payload);
      const { data, error } = await q.select().single();
      fail(error);
      return mapBenefit(data);
    },
    deleteBenefit: async (id: string) => {
      const { error } = await this.sb.from('premium_benefits').delete().eq('id', id);
      fail(error);
    },
  };
}
