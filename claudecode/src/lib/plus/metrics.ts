/**
 * Métricas administrativas Classify+ e regras de disponibilidade de benefícios.
 * Valores ESTIMADOS (MRR/ARR a partir dos planos vigentes) são sempre separados
 * dos valores RECEBIDOS (faturas confirmadas pelo gateway).
 * Espelhado no Postgres por `admin_plus_metrics()`.
 */
import type { BenefitRedemption, BenefitWithMeta, PlusAdminMetrics, PremiumBenefit, Subscription, SubscriptionPayment } from '@/types';
import { hasPremiumAccess, PLANS } from './subscription';

const DAY = 86_400_000;

export function computePlusMetrics(input: {
  totalUsers: number;
  subscriptions: Subscription[];
  payments: SubscriptionPayment[];
  benefits: { id: string; title: string; venue_name: string }[];
  redemptions: BenefitRedemption[];
  now?: number;
}): PlusAdminMetrics {
  const now = input.now ?? Date.now();
  // Considera a assinatura mais recente de cada usuário.
  const latest = new Map<string, Subscription>();
  for (const s of input.subscriptions) {
    const cur = latest.get(s.user_id);
    if (!cur || s.created_at > cur.created_at) latest.set(s.user_id, s);
  }
  const subs = [...latest.values()];
  const withAccess = subs.filter((s) => hasPremiumAccess(s, now));
  const paying = withAccess.filter((s) => s.status === 'active' || s.status === 'canceled');
  const monthly = paying.filter((s) => s.status === 'active' && s.plan_id === 'monthly').length;
  const annual = paying.filter((s) => s.status === 'active' && s.plan_id === 'annual').length;
  // Receita recorrente estimada: só assinaturas pagantes que vão renovar.
  const renewing = paying.filter((s) => s.status === 'active');
  const mrr = renewing.reduce((sum, s) => sum + (s.plan_id === 'annual' ? PLANS.annual.price_cents / 12 : PLANS.monthly.price_cents), 0);
  const annualContracted = paying.filter((s) => s.plan_id === 'annual').length * PLANS.annual.price_cents;

  const paid = input.payments.filter((p) => p.status === 'paid');
  const redemptionCount = new Map<string, number>();
  for (const r of input.redemptions) redemptionCount.set(r.benefit_id, (redemptionCount.get(r.benefit_id) ?? 0) + 1);

  return {
    total_users: input.totalUsers,
    subscribers: withAccess.length,
    monthly_active: monthly,
    annual_active: annual,
    trialing: withAccess.filter((s) => s.status === 'trialing').length,
    canceled_with_access: withAccess.filter((s) => s.status === 'canceled').length,
    expired: subs.filter((s) => !hasPremiumAccess(s, now) && s.status !== 'past_due' && s.status !== 'incomplete').length,
    past_due: subs.filter((s) => s.status === 'past_due').length,
    conversion_rate: input.totalUsers ? paying.length / input.totalUsers : 0,
    mrr_estimated_cents: Math.round(mrr),
    arr_run_rate_cents: Math.round(mrr * 12),
    annual_contracted_cents: annualContracted,
    received_total_cents: paid.reduce((s, p) => s + p.amount_cents, 0),
    received_30d_cents: paid.filter((p) => p.paid_at && now - new Date(p.paid_at).getTime() <= 30 * DAY).reduce((s, p) => s + p.amount_cents, 0),
    failed_payments_30d: input.payments.filter((p) => p.status === 'failed' && now - new Date(p.created_at).getTime() <= 30 * DAY).length,
    top_benefits: input.benefits
      .map((b) => ({ benefit_id: b.id, title: b.title, venue_name: b.venue_name, redemptions: redemptionCount.get(b.id) ?? 0 }))
      .filter((b) => b.redemptions > 0)
      .sort((a, b) => b.redemptions - a.redemptions)
      .slice(0, 5),
  };
}

export function benefitAvailability(b: PremiumBenefit, redeemed: number, now = Date.now()): BenefitWithMeta['availability'] {
  if (!b.active) return 'inativo';
  const today = new Date(now).toISOString().slice(0, 10);
  if (b.valid_until < today) return 'expirado';
  if (b.total_quantity !== null && redeemed >= b.total_quantity) return 'esgotado';
  return 'disponivel';
}

export function validateBenefit(b: Partial<PremiumBenefit>): string | null {
  if (!b.venue_id) return 'Selecione o estabelecimento parceiro.';
  if (!b.title?.trim()) return 'Informe o nome do benefício.';
  if (!b.description?.trim()) return 'Descreva a vantagem.';
  if (!b.rules?.trim()) return 'Informe as regras de utilização.';
  if (!b.how_to_redeem?.trim()) return 'Explique como resgatar.';
  if (!b.valid_until || !/^\d{4}-\d{2}-\d{2}$/.test(b.valid_until)) return 'Informe a data de validade.';
  if (b.total_quantity != null && (!Number.isInteger(b.total_quantity) || b.total_quantity < 1)) return 'Quantidade deve ser um inteiro positivo (ou vazio para ilimitado).';
  return null;
}

/** Código de resgate legível (sem caracteres ambíguos). */
export function redemptionCode(prefix = 'CPLUS'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}
