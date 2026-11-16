// ---------------------------------------------------------------
// CLASSIFY+ — tipos da assinatura premium
// Espelham supabase/migrations/0003_classify_plus.sql
// ---------------------------------------------------------------
import type { CriterionKey } from './index';

export type PlanId = 'monthly' | 'annual';

/**
 * Estados persistidos de uma assinatura.
 *  - trialing   : teste grátis em andamento
 *  - active     : pagamento em dia
 *  - past_due   : renovação recusada (o gateway ainda tenta cobrar) — sem acesso premium
 *  - canceled   : cancelada pelo usuário, com acesso até o fim do período já pago
 *  - expired    : encerrada (período terminou ou o gateway desistiu da cobrança)
 *  - incomplete : checkout iniciado, primeiro pagamento ainda não confirmado
 * "Usuário gratuito" = nenhuma assinatura com acesso vigente.
 */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'incomplete';
export type BillingProvider = 'stripe' | 'mercadopago' | 'demo';

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price_cents: number;
  currency: 'BRL';
  interval: 'month' | 'year';
  trial_days: number;
  active: boolean;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  provider: BillingProvider;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPayment {
  id: string;
  subscription_id: string | null;
  user_id: string;
  provider_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  status: 'paid' | 'failed' | 'refunded';
  failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Nível de acesso derivado — o que a interface consulta. */
export type AccessTier = 'free' | 'premium';

export interface AccessState {
  tier: AccessTier;
  /** Rótulo do estado para o usuário. */
  label:
    | 'Gratuito'
    | 'Teste grátis'
    | 'Mensal ativa'
    | 'Anual ativa'
    | 'Cancelada'
    | 'Expirada'
    | 'Pagamento recusado'
    | 'Aguardando confirmação';
  subscription: Subscription | null;
  /** Fim do acesso (fim do teste/período). */
  accessUntil: string | null;
  trialEligible: boolean;
}

export type PlusFeature =
  | 'meu_ranking'
  | 'filtros_avancados'
  | 'alertas'
  | 'pulso'
  | 'retrospectiva_completa'
  | 'beneficios'
  | 'sem_anuncios';

// ---------------------------------------------------------------- preferências
export type CriteriaWeights = Record<CriterionKey, number>;

export interface RankingPreset {
  id: string;
  name: string;
  weights: CriteriaWeights;
  updated_at: string;
}

export interface AlertSettings {
  enabled: boolean;
  venues: boolean;
  artists: boolean;
  events: boolean;
  /** Preferência registrada; envio depende de provedor de e-mail (não integrado). */
  email: boolean;
  /** Preferência registrada; envio depende de serviço de push (não integrado). */
  push: boolean;
}

export interface UserPreferences {
  user_id: string;
  ranking_presets: RankingPreset[];
  active_preset_id: string | null;
  alerts: AlertSettings;
  saved_filters: AdvancedFilterState | null;
  updated_at: string;
}

// ---------------------------------------------------------------- favoritos / alertas
export type ArtistKind = 'dj' | 'artist';

export interface ArtistFavorite {
  id: string;
  user_id: string;
  kind: ArtistKind;
  name: string;
  /** Nome normalizado (minúsculas, sem acento) usado para casar com o line-up. */
  name_key: string;
  created_at: string;
}

export type NotificationKind = 'artist_event' | 'venue_event' | 'event_reminder' | 'benefit' | 'system';
export type DeliveryStatus = 'not_requested' | 'not_configured' | 'pending' | 'sent' | 'failed';

export interface PlusNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  venue_id: string | null;
  event_id: string | null;
  dedupe_key: string;
  email_status: DeliveryStatus;
  push_status: DeliveryStatus;
  read_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- benefícios
export interface PremiumBenefit {
  id: string;
  venue_id: string;
  title: string;
  description: string;
  rules: string;
  how_to_redeem: string;
  image_url: string;
  valid_until: string; // YYYY-MM-DD
  /** null = sem limite de resgates. */
  total_quantity: number | null;
  active: boolean;
  /** Benefício de exemplo/demonstração — NÃO é um acordo real com o estabelecimento. */
  is_demo: boolean;
  created_at: string;
}

export interface BenefitRedemption {
  id: string;
  benefit_id: string;
  user_id: string;
  code: string;
  created_at: string;
}

export interface BenefitWithMeta {
  benefit: PremiumBenefit;
  venueName: string;
  venueSlug: string | null;
  redeemed: number;
  myRedemption: BenefitRedemption | null;
  availability: 'disponivel' | 'esgotado' | 'expirado' | 'inativo';
}

// ---------------------------------------------------------------- atividade
export type ActivityKind = 'review_published' | 'review_updated' | 'benefit_redeemed' | 'subscription_started' | 'subscription_canceled';

export interface ActivityEntry {
  id: string;
  user_id: string;
  kind: ActivityKind;
  venue_id: string | null;
  review_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------- filtros
export interface AdvancedFilterState {
  city?: string;
  styles?: string[];
  /** Faixa R$ (1–4). */
  priceRanges?: number[];
  /** Gasto médio por pessoa (R$). */
  avgPriceMin?: number | null;
  avgPriceMax?: number | null;
  audience?: string[];
  capacity?: ('intimista' | 'media' | 'grande' | 'mega')[];
  /** Aberto em determinado horário (HH:MM). */
  openAt?: string | null;
  weekdays?: string[];
  categories?: string[];
  minRating?: number | null;
  /** Nota mínima por critério. */
  criteriaMin?: Partial<Record<CriterionKey, number>>;
  /** Raio em km a partir da localização do usuário. */
  maxDistanceKm?: number | null;
  /** Mínimo de avaliações para considerar a casa. */
  minReviews?: number | null;
}

// ---------------------------------------------------------------- admin
export interface PlusAdminMetrics {
  total_users: number;
  subscribers: number;
  monthly_active: number;
  annual_active: number;
  trialing: number;
  canceled_with_access: number;
  expired: number;
  past_due: number;
  /** Assinantes pagantes (sem teste) ÷ usuários. */
  conversion_rate: number;
  /** Estimativas a partir dos planos vigentes (não são valores recebidos). */
  mrr_estimated_cents: number;
  arr_run_rate_cents: number;
  annual_contracted_cents: number;
  /** Valores efetivamente confirmados pelo gateway (faturas pagas). */
  received_total_cents: number;
  received_30d_cents: number;
  failed_payments_30d: number;
  top_benefits: { benefit_id: string; title: string; venue_name: string; redemptions: number }[];
}
