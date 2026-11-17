'use client';
/**
 * DemoPlusService — Classify+ em MODO DEMONSTRAÇÃO.
 * Persiste no localStorage. NÃO processa pagamentos: a "assinatura" de demo
 * é ativada localmente, identificada como demonstração, e não gera nenhum
 * registro de pagamento recebido.
 */
import { DEMO_BENEFITS } from '@/data/plus-demo';
import { buildAlerts, DEFAULT_ALERTS, normalizeName } from '@/lib/plus/alerts';
import { benefitAvailability, computePlusMetrics, redemptionCode, validateBenefit } from '@/lib/plus/metrics';
import { normalizeWeights } from '@/lib/plus/personal-ranking';
import { hasPremiumAccess, isTrialEligible, PLANS, resolveAccess } from '@/lib/plus/subscription';
import { uid } from '@/lib/format';
import type {
  ActivityEntry,
  ArtistFavorite,
  ArtistKind,
  BenefitRedemption,
  BenefitWithMeta,
  PlanId,
  PlusNotification,
  PremiumBenefit,
  Profile,
  Subscription,
  SubscriptionPayment,
  UserPreferences,
  PremiumGrant,
} from '@/types';
import { ServiceError, type DataService } from '../data-service';
import type { BillingStatus, CheckoutResult, PlusService } from './plus-service';

export const PLUS_DB_KEY = 'classifydj:plus-db';
const PLUS_DB_VERSION = 1;
const DAY = 86_400_000;

interface PlusDB {
  version: number;
  subscriptions: Subscription[];
  payments: SubscriptionPayment[];
  preferences: Record<string, UserPreferences>;
  artists: ArtistFavorite[];
  notifications: PlusNotification[];
  benefits: PremiumBenefit[];
  redemptions: BenefitRedemption[];
  activity: ActivityEntry[];
}

const nowIso = () => new Date().toISOString();

function addPeriod(from: number, plan: PlanId): number {
  const d = new Date(from);
  if (plan === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export class DemoPlusService implements PlusService {
  readonly mode = 'demo' as const;
  private db: PlusDB | null = null;

  constructor(private data: DataService) {}

  // ------------------------------------------------------------ storage
  private async load(): Promise<PlusDB> {
    // Demonstração redefinida em outra parte do app → descarta o cache em memória.
    if (this.db && typeof window !== 'undefined' && !localStorage.getItem(PLUS_DB_KEY)) this.db = null;
    if (this.db) return this.db;
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(PLUS_DB_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as PlusDB;
        if (parsed.version === PLUS_DB_VERSION) return (this.db = parsed);
      }
    } catch {
      /* storage indisponível ou corrompido: recria */
    }
    const venues = await this.data.listVenues();
    const bySlug = new Map(venues.map((v) => [v.slug, v]));
    const benefits: PremiumBenefit[] = DEMO_BENEFITS.flatMap((b, i) => {
      const v = bySlug.get(b.venueSlug);
      if (!v) return [];
      return [{
        id: `demo-benefit-${i + 1}`, venue_id: v.id, title: b.title, description: b.description, rules: b.rules,
        how_to_redeem: b.how_to_redeem, image_url: v.cover_image,
        valid_until: new Date(Date.now() + b.validDays * DAY).toISOString().slice(0, 10),
        total_quantity: b.total_quantity, active: true, is_demo: true, created_at: nowIso(),
      }];
    });
    this.db = { version: PLUS_DB_VERSION, subscriptions: [], payments: [], preferences: {}, artists: [], notifications: [], benefits, redemptions: [], activity: [] };
    this.persist();
    return this.db;
  }

  private persist() {
    if (typeof window === 'undefined' || !this.db) return;
    try {
      localStorage.setItem(PLUS_DB_KEY, JSON.stringify(this.db));
    } catch {
      throw new ServiceError('Armazenamento local cheio.');
    }
  }

  private async requireUser(): Promise<Profile> {
    const u = await this.data.getCurrentUser();
    if (!u) throw new ServiceError('Entre na sua conta para continuar.');
    return u;
  }

  private async requireAdmin() {
    const u = await this.requireUser();
    if (u.role !== 'admin') throw new ServiceError('Acesso restrito a administradores.');
    return this.load();
  }

  private async mySubs(userId: string) {
    const db = await this.load();
    return db.subscriptions.filter((s) => s.user_id === userId);
  }

  private async requirePremium(): Promise<Profile> {
    const u = await this.requireUser();
    if (resolveAccess(await this.mySubs(u.id)).tier !== 'premium') throw new ServiceError('Recurso exclusivo para assinantes Classify+.');
    return u;
  }

  private log(db: PlusDB, entry: Omit<ActivityEntry, 'id' | 'created_at'>) {
    db.activity.push({ ...entry, id: uid(), created_at: nowIso() });
  }

  // ------------------------------------------------------------ assinatura
  async billingStatus(): Promise<BillingStatus> {
    return { configured: true, provider: 'demo', message: 'Modo demonstração: nenhuma cobrança é realizada e nenhum dado de pagamento é solicitado.' };
  }

  /** Cupons e gratuidades existem só com o Supabase (modo demo: nenhuma). */
  async listMyGrants(): Promise<PremiumGrant[]> {
    return [];
  }

  async listMySubscriptions() {
    const u = await this.data.getCurrentUser();
    if (!u) return [];
    return (await this.mySubs(u.id)).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async listMyPayments() {
    const u = await this.data.getCurrentUser();
    if (!u) return [];
    const db = await this.load();
    return db.payments.filter((p) => p.user_id === u.id); // sempre vazio no demo
  }

  async startCheckout(plan: PlanId): Promise<CheckoutResult> {
    const u = await this.requireUser();
    const db = await this.load();
    const subs = db.subscriptions.filter((s) => s.user_id === u.id);
    if (subs.some((s) => hasPremiumAccess(s))) throw new ServiceError('Você já tem uma assinatura Classify+ ativa.');
    const now = Date.now();
    const trial = plan === 'monthly' && PLANS.monthly.trial_days > 0 && isTrialEligible(subs);
    const end = trial ? now + PLANS.monthly.trial_days * DAY : addPeriod(now, plan);
    const ts = new Date(now).toISOString();
    db.subscriptions.push({
      id: uid(), user_id: u.id, plan_id: plan, status: trial ? 'trialing' : 'active', provider: 'demo',
      provider_customer_id: null, provider_subscription_id: null,
      trial_start: trial ? ts : null, trial_end: trial ? new Date(end).toISOString() : null,
      current_period_start: ts, current_period_end: new Date(end).toISOString(),
      cancel_at_period_end: false, canceled_at: null, ended_at: null, created_at: ts, updated_at: ts,
    });
    this.log(db, { user_id: u.id, kind: 'subscription_started', venue_id: null, review_id: null, metadata: { plan, trial, demo: true } });
    this.persist();
    return { kind: 'demo_activated' };
  }

  private async liveSub() {
    const u = await this.requireUser();
    const subs = await this.mySubs(u.id);
    const sub = subs.find((s) => hasPremiumAccess(s));
    if (!sub) throw new ServiceError('Nenhuma assinatura vigente.');
    return { u, sub };
  }

  async cancelSubscription() {
    const { u, sub } = await this.liveSub();
    const db = await this.load();
    Object.assign(sub, { status: 'canceled', cancel_at_period_end: true, canceled_at: nowIso(), updated_at: nowIso() });
    this.log(db, { user_id: u.id, kind: 'subscription_canceled', venue_id: null, review_id: null, metadata: { access_until: sub.current_period_end } });
    this.persist();
  }

  async resumeSubscription() {
    const { sub } = await this.liveSub();
    if (sub.status !== 'canceled') return;
    const inTrial = !!sub.trial_end && new Date(sub.trial_end).getTime() > Date.now();
    Object.assign(sub, { status: inTrial ? 'trialing' : 'active', cancel_at_period_end: false, canceled_at: null, updated_at: nowIso() });
    this.persist();
  }

  async billingPortalUrl() {
    return null;
  }

  async demoExpireNow() {
    const u = await this.requireUser();
    const db = await this.load();
    const past = new Date(Date.now() - 1000).toISOString();
    for (const s of db.subscriptions.filter((x) => x.user_id === u.id && hasPremiumAccess(x))) {
      Object.assign(s, { status: 'expired', current_period_end: past, trial_end: s.trial_end ? past : null, ended_at: past, updated_at: past });
    }
    this.persist();
  }

  // ------------------------------------------------------------ preferências
  private defaults(userId: string): UserPreferences {
    return { user_id: userId, ranking_presets: [], active_preset_id: null, alerts: { ...DEFAULT_ALERTS }, saved_filters: null, updated_at: nowIso() };
  }

  async getPreferences() {
    const u = await this.requireUser();
    const db = await this.load();
    return db.preferences[u.id] ?? this.defaults(u.id);
  }

  async savePreferences(patch: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>) {
    const u = await this.requireUser();
    const db = await this.load();
    const cur = db.preferences[u.id] ?? this.defaults(u.id);
    if (patch.ranking_presets) {
      if (patch.ranking_presets.length > 10) throw new ServiceError('Máximo de 10 configurações salvas.');
      patch.ranking_presets = patch.ranking_presets.map((p) => ({ ...p, name: p.name.trim().slice(0, 40) || 'Meu ranking', weights: normalizeWeights(p.weights) }));
    }
    const next = { ...cur, ...patch, alerts: { ...cur.alerts, ...(patch.alerts ?? {}) }, user_id: u.id, updated_at: nowIso() };
    db.preferences[u.id] = next;
    this.persist();
    return next;
  }

  // ------------------------------------------------------------ artistas
  async listArtistFavorites() {
    const u = await this.data.getCurrentUser();
    if (!u) return [];
    const db = await this.load();
    return db.artists.filter((a) => a.user_id === u.id).sort((a, b) => a.name.localeCompare(b.name));
  }

  async toggleArtistFavorite(name: string, kind: ArtistKind) {
    const u = await this.requireUser();
    const db = await this.load();
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 80) throw new ServiceError('Informe um nome entre 2 e 80 caracteres.');
    const key = normalizeName(clean);
    const idx = db.artists.findIndex((a) => a.user_id === u.id && a.name_key === key);
    if (idx >= 0) db.artists.splice(idx, 1);
    else {
      if (db.artists.filter((a) => a.user_id === u.id).length >= 100) throw new ServiceError('Limite de 100 artistas seguidos.');
      db.artists.push({ id: uid(), user_id: u.id, kind, name: clean, name_key: key, created_at: nowIso() });
    }
    this.persist();
    return idx < 0;
  }

  // ------------------------------------------------------------ notificações
  async listNotifications() {
    const u = await this.data.getCurrentUser();
    if (!u) return [];
    const db = await this.load();
    return db.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async syncNotifications() {
    const u = await this.data.getCurrentUser();
    if (!u) return 0;
    const db = await this.load();
    if (resolveAccess(db.subscriptions.filter((s) => s.user_id === u.id)).tier !== 'premium') return 0;
    const prefs = db.preferences[u.id] ?? this.defaults(u.id);
    const [events, favorites] = await Promise.all([this.data.listEvents({ upcomingOnly: true }), this.data.listFavorites(u.id)]);
    const drafts = buildAlerts({
      events, favorites, artists: db.artists.filter((a) => a.user_id === u.id), settings: prefs.alerts,
      existingKeys: new Set(db.notifications.filter((n) => n.user_id === u.id).map((n) => n.dedupe_key)),
    });
    for (const d of drafts) {
      db.notifications.push({
        ...d, id: uid(), user_id: u.id, read_at: null, created_at: nowIso(),
        // Envio externo não integrado: a preferência é registrada, nada é enviado.
        email_status: prefs.alerts.email ? 'not_configured' : 'not_requested',
        push_status: prefs.alerts.push ? 'not_configured' : 'not_requested',
      });
    }
    if (drafts.length) this.persist();
    return drafts.length;
  }

  async markNotificationsRead(ids?: string[]) {
    const u = await this.requireUser();
    const db = await this.load();
    const ts = nowIso();
    db.notifications.forEach((n) => {
      if (n.user_id === u.id && !n.read_at && (!ids || ids.includes(n.id))) n.read_at = ts;
    });
    this.persist();
  }

  async deleteNotification(id: string) {
    const u = await this.requireUser();
    const db = await this.load();
    db.notifications = db.notifications.filter((n) => !(n.id === id && n.user_id === u.id));
    this.persist();
  }

  // ------------------------------------------------------------ benefícios
  private async withMeta(db: PlusDB, userId: string | null, onlyActive: boolean): Promise<BenefitWithMeta[]> {
    const venues = new Map((await this.data.listVenues()).map((v) => [v.id, v]));
    return db.benefits
      .filter((b) => !onlyActive || b.active)
      .map((benefit) => {
        const redeemed = db.redemptions.filter((r) => r.benefit_id === benefit.id).length;
        const v = venues.get(benefit.venue_id);
        return {
          benefit,
          venueName: v?.name ?? 'Estabelecimento removido',
          venueSlug: v?.slug ?? null,
          redeemed,
          myRedemption: userId ? db.redemptions.find((r) => r.benefit_id === benefit.id && r.user_id === userId) ?? null : null,
          availability: benefitAvailability(benefit, redeemed),
        };
      })
      .sort((a, b) => (a.availability === 'disponivel' ? -1 : 1) - (b.availability === 'disponivel' ? -1 : 1) || a.benefit.valid_until.localeCompare(b.benefit.valid_until));
  }

  async listBenefits() {
    const u = await this.data.getCurrentUser();
    return this.withMeta(await this.load(), u?.id ?? null, true);
  }

  async redeemBenefit(benefitId: string) {
    const u = await this.requirePremium();
    const db = await this.load();
    const b = db.benefits.find((x) => x.id === benefitId);
    if (!b) throw new ServiceError('Benefício não encontrado.');
    const existing = db.redemptions.find((r) => r.benefit_id === benefitId && r.user_id === u.id);
    if (existing) return existing;
    const status = benefitAvailability(b, db.redemptions.filter((r) => r.benefit_id === benefitId).length);
    if (status !== 'disponivel') throw new ServiceError(status === 'esgotado' ? 'Benefício esgotado.' : status === 'expirado' ? 'Benefício expirado.' : 'Benefício indisponível.');
    // Benefício de exemplo → código claramente marcado como demonstrativo.
    const r: BenefitRedemption = { id: uid(), benefit_id: benefitId, user_id: u.id, code: redemptionCode(b.is_demo ? 'DEMO' : 'CPLUS'), created_at: nowIso() };
    db.redemptions.push(r);
    this.log(db, { user_id: u.id, kind: 'benefit_redeemed', venue_id: b.venue_id, review_id: null, metadata: { benefit: b.title } });
    this.persist();
    return r;
  }

  // ------------------------------------------------------------ histórico
  async listActivity() {
    const u = await this.data.getCurrentUser();
    if (!u) return [];
    const db = await this.load();
    const reviews = await this.data.listReviews({ userId: u.id, includeHidden: true, sort: 'recent' });
    const fromReviews: ActivityEntry[] = reviews.map((r) => ({
      id: `rv-${r.review.id}`, user_id: u.id, kind: r.review.updated_at !== r.review.created_at ? 'review_updated' : 'review_published',
      venue_id: r.venue.id, review_id: r.review.id, metadata: { venue: r.venue.name, rating: r.review.overall_rating, photos: r.review.photos.length },
      created_at: r.review.updated_at,
    }));
    return [...fromReviews, ...db.activity.filter((a) => a.user_id === u.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ------------------------------------------------------------ admin
  admin = {
    metrics: async () => {
      const db = await this.requireAdmin();
      const profiles = await this.data.admin.listProfiles();
      const venues = new Map((await this.data.listVenues()).map((v) => [v.id, v.name]));
      return computePlusMetrics({
        totalUsers: profiles.length,
        subscriptions: db.subscriptions,
        payments: db.payments,
        benefits: db.benefits.map((b) => ({ id: b.id, title: b.title, venue_name: venues.get(b.venue_id) ?? '—' })),
        redemptions: db.redemptions,
      });
    },
    listBenefits: async () => {
      const db = await this.requireAdmin();
      return this.withMeta(db, null, false);
    },
    upsertBenefit: async (b: Partial<PremiumBenefit>) => {
      const db = await this.requireAdmin();
      const err = validateBenefit(b);
      if (err) throw new ServiceError(err);
      const clean = {
        venue_id: b.venue_id!, title: b.title!.trim(), description: b.description!.trim(), rules: b.rules!.trim(),
        how_to_redeem: b.how_to_redeem!.trim(), image_url: b.image_url?.trim() || '', valid_until: b.valid_until!,
        total_quantity: b.total_quantity ?? null, active: b.active ?? true, is_demo: b.is_demo ?? false,
      };
      if (b.id) {
        const cur = db.benefits.find((x) => x.id === b.id);
        if (!cur) throw new ServiceError('Benefício não encontrado.');
        Object.assign(cur, clean);
        this.persist();
        return cur;
      }
      const created: PremiumBenefit = { ...clean, id: uid(), created_at: nowIso() };
      db.benefits.push(created);
      this.persist();
      return created;
    },
    deleteBenefit: async (id: string) => {
      const db = await this.requireAdmin();
      db.benefits = db.benefits.filter((b) => b.id !== id);
      db.redemptions = db.redemptions.filter((r) => r.benefit_id !== id);
      this.persist();
    },
  };
}
