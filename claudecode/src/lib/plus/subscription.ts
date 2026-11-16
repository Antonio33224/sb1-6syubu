/**
 * CLASSIFY+ — planos, estados de assinatura e controle de acesso.
 * Funções puras: a mesma regra é espelhada no Postgres por `public.has_premium()`
 * (supabase/migrations/0003_classify_plus.sql).
 */
import type { AccessState, PlanId, PlusFeature, Subscription, SubscriptionPlan, SubscriptionStatus } from '@/types';

export const PLANS: Record<PlanId, SubscriptionPlan> = {
  monthly: { id: 'monthly', name: 'Classify+ Mensal', price_cents: 1290, currency: 'BRL', interval: 'month', trial_days: 7, active: true },
  annual: { id: 'annual', name: 'Classify+ Anual', price_cents: 10900, currency: 'BRL', interval: 'year', trial_days: 0, active: true },
};

/** Preço mensal equivalente do plano anual (centavos, arredondado). */
export const annualMonthlyEquivalentCents = () => Math.round(PLANS.annual.price_cents / 12);

/** Economia do anual em relação a 12 mensalidades (0–1). */
export const annualSavingsRatio = () => 1 - PLANS.annual.price_cents / (PLANS.monthly.price_cents * 12);

/**
 * PREMISSA INTERNA DE PLANEJAMENTO — não é garantia de receita.
 * 70% mensal / 30% anual → ticket médio mensal ponderado ≈ R$ 11,75.
 */
export const PLANNING_MIX = { monthly: 0.7, annual: 0.3 } as const;
export const weightedTicketCents = () =>
  PLANNING_MIX.monthly * PLANS.monthly.price_cents + PLANNING_MIX.annual * (PLANS.annual.price_cents / 12);

export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

/** Estados que dão acesso premium enquanto o período vigente não terminou. */
const ACCESS_STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'canceled'];

export function hasPremiumAccess(sub: Subscription | null | undefined, now = Date.now()): boolean {
  if (!sub || !ACCESS_STATUSES.includes(sub.status)) return false;
  const end = sub.status === 'trialing' ? sub.trial_end ?? sub.current_period_end : sub.current_period_end;
  return !!end && new Date(end).getTime() > now;
}

/** Assinatura mais relevante do usuário: a que dá acesso; senão a mais recente. */
export function currentSubscription(subs: Subscription[], now = Date.now()): Subscription | null {
  if (!subs.length) return null;
  const sorted = subs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.find((s) => hasPremiumAccess(s, now)) ?? sorted[0]!;
}

/**
 * Teste grátis apenas para quem nunca iniciou um teste com esta conta.
 * (Também validado no servidor antes de criar o checkout.)
 */
export function isTrialEligible(subs: Subscription[]): boolean {
  return !subs.some((s) => s.trial_start !== null);
}

/** Converte o estado bruto em algo que a interface entende. */
export function resolveAccess(subs: Subscription[], now = Date.now()): AccessState {
  const sub = currentSubscription(subs, now);
  const trialEligible = isTrialEligible(subs);
  if (!sub) return { tier: 'free', label: 'Gratuito', subscription: null, accessUntil: null, trialEligible };

  const premium = hasPremiumAccess(sub, now);
  const accessUntil = sub.status === 'trialing' ? sub.trial_end ?? sub.current_period_end : sub.current_period_end;
  // Período encerrado sem atualização do gateway → tratado como expirado.
  const effective: SubscriptionStatus =
    !premium && ACCESS_STATUSES.includes(sub.status) ? 'expired' : sub.status;

  const label: AccessState['label'] =
    effective === 'trialing'
      ? 'Teste grátis'
      : effective === 'active'
        ? sub.plan_id === 'annual'
          ? 'Anual ativa'
          : 'Mensal ativa'
        : effective === 'canceled'
          ? 'Cancelada'
          : effective === 'past_due'
            ? 'Pagamento recusado'
            : effective === 'incomplete'
              ? 'Aguardando confirmação'
              : 'Expirada';

  return { tier: premium ? 'premium' : 'free', label, subscription: sub, accessUntil, trialEligible };
}

export const PLUS_FEATURES: Record<PlusFeature, { label: string; href: string }> = {
  meu_ranking: { label: 'Meu Ranking', href: '/meu-ranking' },
  filtros_avancados: { label: 'Filtros avançados', href: '/descobrir' },
  alertas: { label: 'Alertas personalizados', href: '/alertas' },
  pulso: { label: 'Pulso da Noite', href: '/pulso' },
  retrospectiva_completa: { label: 'Minha Retrospectiva completa', href: '/retrospectiva' },
  beneficios: { label: 'Benefícios Classify+', href: '/beneficios' },
  sem_anuncios: { label: 'Sem banners de terceiros', href: '/classify-plus' },
};

/** Todas as funcionalidades Classify+ exigem acesso premium vigente. */
export function canUse(_feature: PlusFeature, access: Pick<AccessState, 'tier'>): boolean {
  return access.tier === 'premium';
}

/**
 * Banners publicitários de TERCEIROS: nunca para assinantes. Para os demais,
 * apenas quando há provedor de anúncios habilitado (ou marcador no modo demo).
 * Cards "INDICADO" (curadoria) NÃO passam por esta regra — aparecem para todos.
 */
export function showThirdPartyAds(input: { isPremium: boolean; adsEnabled: boolean; demoMode: boolean }): boolean {
  if (input.isPremium) return false;
  return input.adsEnabled || input.demoMode;
}

/** Mapeia o status do Stripe para o estado interno. */
export function mapStripeStatus(status: string, cancelAtPeriodEnd: boolean): SubscriptionStatus {
  switch (status) {
    case 'trialing':
    case 'active':
      return cancelAtPeriodEnd ? 'canceled' : status;
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
      return 'incomplete';
    case 'canceled':
    case 'incomplete_expired':
    default:
      return 'expired';
  }
}
