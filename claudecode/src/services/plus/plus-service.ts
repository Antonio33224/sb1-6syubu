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
  PremiumGrant,
  Subscription,
  SubscriptionPayment,
  UserPreferences,
} from '@/types';

/** Resultado de um pedido de checkout. */
export type CheckoutResult =
  /** Redirecionar o navegador para o checkout seguro do gateway. */
  | { kind: 'redirect'; url: string }
  /** Modo demonstração: assinatura de teste ativada localmente, sem cobrança. */
  | { kind: 'demo_activated' };

export interface BillingStatus {
  /** Gateway configurado no servidor (chaves e preços presentes). */
  configured: boolean;
  provider: 'stripe' | 'demo' | null;
  /** Explicação para a interface quando não configurado. */
  message: string | null;
}

/**
 * Contrato Classify+ consumido pela interface. Duas implementações:
 *  - DemoPlusService: localStorage, sem cobrança (modo demonstração).
 *  - SupabasePlusService: tabelas/RPCs do Supabase + rotas /api/billing (Stripe).
 */
export interface PlusService {
  readonly mode: 'demo' | 'supabase';

  // ---- assinatura
  billingStatus(): Promise<BillingStatus>;
  listMySubscriptions(): Promise<Subscription[]>;
  /** Gratuidades (cupom/admin) vigentes ou futuras do usuário logado. */
  listMyGrants(): Promise<PremiumGrant[]>;
  listMyPayments(): Promise<SubscriptionPayment[]>;
  startCheckout(plan: PlanId): Promise<CheckoutResult>;
  /** Cancela ao fim do período já pago. */
  cancelSubscription(): Promise<void>;
  /** Desfaz um cancelamento agendado (enquanto o período não terminou). */
  resumeSubscription(): Promise<void>;
  /** Portal do gateway para atualizar cartão/ver faturas (null quando indisponível). */
  billingPortalUrl(): Promise<string | null>;
  /** Somente modo demo: encerra o período agora para testar expiração. */
  demoExpireNow?(): Promise<void>;

  // ---- preferências (Meu Ranking, alertas, filtros salvos)
  getPreferences(): Promise<UserPreferences>;
  savePreferences(patch: Partial<Omit<UserPreferences, 'user_id' | 'updated_at'>>): Promise<UserPreferences>;

  // ---- DJs / artistas favoritos
  listArtistFavorites(): Promise<ArtistFavorite[]>;
  toggleArtistFavorite(name: string, kind: ArtistKind): Promise<boolean>;

  // ---- notificações
  listNotifications(): Promise<PlusNotification[]>;
  /** Gera alertas pendentes para eventos futuros que envolvem favoritos. Retorna quantos foram criados. */
  syncNotifications(): Promise<number>;
  markNotificationsRead(ids?: string[]): Promise<void>;
  deleteNotification(id: string): Promise<void>;

  // ---- benefícios
  listBenefits(): Promise<BenefitWithMeta[]>;
  redeemBenefit(benefitId: string): Promise<BenefitRedemption>;

  // ---- histórico
  listActivity(): Promise<ActivityEntry[]>;

  // ---- admin
  admin: {
    metrics(): Promise<PlusAdminMetrics>;
    listBenefits(): Promise<BenefitWithMeta[]>;
    upsertBenefit(b: Partial<PremiumBenefit>): Promise<PremiumBenefit>;
    deleteBenefit(id: string): Promise<void>;
  };
}
