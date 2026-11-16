/**
 * Núcleo de cobrança no servidor: configuração, autenticação do usuário,
 * acesso administrativo ao Supabase e sincronização de assinaturas Stripe.
 * Importado SOMENTE por route handlers (src/app/api/**).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hasPremiumAccess, isTrialEligible, mapStripeStatus, PLANS } from '@/lib/plus/subscription';
import type { PlanId, Subscription } from '@/types';
import { stripe } from './stripe';

export interface BillingConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  stripeSecret: string;
  webhookSecret: string;
  prices: Record<PlanId, string>;
  siteUrl: string;
}

/** Lê a configuração. Retorna a lista do que falta quando incompleta. */
export function billingConfig(): { ok: true; config: BillingConfig } | { ok: false; missing: string[] } {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_MONTHLY: process.env.STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_ANNUAL: process.env.STRIPE_PRICE_ANNUAL,
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
      stripeSecret: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
      prices: { monthly: env.STRIPE_PRICE_MONTHLY!, annual: env.STRIPE_PRICE_ANNUAL! },
      siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    },
  };
}

/** Client com service_role — ignora RLS. Uso exclusivo do servidor. */
export function adminClient(c: BillingConfig): SupabaseClient {
  return createClient(c.supabaseUrl, c.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Identifica o usuário pelo token de acesso Supabase (cabeçalho Authorization). */
export async function requireUser(req: Request, c: BillingConfig) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Entre na sua conta para continuar.');
  const anon = createClient(c.supabaseUrl, c.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida. Entre novamente.');
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function userSubscriptions(db: SupabaseClient, userId: string): Promise<Subscription[]> {
  const { data, error } = await db.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw new HttpError(500, error.message);
  return (data ?? []) as Subscription[];
}

export const liveStripeSubscription = (subs: Subscription[]) =>
  subs.find((s) => s.provider === 'stripe' && s.provider_subscription_id && hasPremiumAccess(s)) ?? null;

export { isTrialEligible };

// ------------------------------------------------------------------ sincronização
type StripeSub = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  ended_at: number | null;
  trial_start: number | null;
  trial_end: number | null;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data: { price: { id: string }; current_period_start?: number; current_period_end?: number }[] };
};

const ts = (n: number | null | undefined) => (n ? new Date(n * 1000).toISOString() : null);

export function planFromPrice(priceId: string | undefined, c: BillingConfig): PlanId | null {
  if (!priceId) return null;
  return priceId === c.prices.annual ? 'annual' : priceId === c.prices.monthly ? 'monthly' : null;
}

/**
 * Grava no banco o estado da assinatura conforme o Stripe (fonte da verdade).
 * Os dados vêm da API/webhook validados no servidor — nunca do navegador.
 */
export async function syncStripeSubscription(db: SupabaseClient, c: BillingConfig, sub: StripeSub, userIdHint?: string | null) {
  const item = sub.items?.data?.[0];
  const plan = planFromPrice(item?.price.id, c);
  if (!plan) throw new Error(`Preço desconhecido na assinatura ${sub.id}.`);

  const { data: existing } = await db.from('subscriptions').select('id, user_id').eq('provider_subscription_id', sub.id).maybeSingle();
  const userId = existing?.user_id ?? sub.metadata?.user_id ?? userIdHint;
  if (!userId) throw new Error(`Assinatura ${sub.id} sem usuário associado.`);

  // Versões novas da API movem o período para os itens da assinatura.
  const periodStart = sub.current_period_start ?? item?.current_period_start;
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  const row = {
    user_id: userId,
    plan_id: plan,
    status: mapStripeStatus(sub.status, sub.cancel_at_period_end),
    provider: 'stripe' as const,
    provider_customer_id: sub.customer,
    provider_subscription_id: sub.id,
    trial_start: ts(sub.trial_start),
    trial_end: ts(sub.trial_end),
    current_period_start: ts(periodStart),
    current_period_end: ts(periodEnd),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: ts(sub.canceled_at),
    ended_at: ts(sub.ended_at),
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await db.from('subscriptions').update(row).eq('id', existing.id)
    : await db.from('subscriptions').insert(row);
  if (error) throw new Error(error.message);
}

export async function fetchAndSync(db: SupabaseClient, c: BillingConfig, subscriptionId: string, userIdHint?: string | null) {
  const sub = await stripe<StripeSub>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  await syncStripeSubscription(db, c, sub, userIdHint);
  return sub;
}

export function checkoutParams(c: BillingConfig, input: { plan: PlanId; userId: string; email: string | null; customerId: string | null; trial: boolean }) {
  return {
    mode: 'subscription',
    'line_items': [{ price: c.prices[input.plan], quantity: 1 }],
    client_reference_id: input.userId,
    ...(input.customerId ? { customer: input.customerId } : input.email ? { customer_email: input.email } : {}),
    metadata: { user_id: input.userId, plan: input.plan },
    subscription_data: {
      metadata: { user_id: input.userId, plan: input.plan },
      ...(input.trial ? { trial_period_days: PLANS.monthly.trial_days } : {}),
    },
    payment_method_collection: 'always',
    allow_promotion_codes: 'false',
    locale: 'pt-BR',
    success_url: `${c.siteUrl}/assinatura?checkout=success`,
    cancel_url: `${c.siteUrl}/assinatura?checkout=canceled`,
  };
}
