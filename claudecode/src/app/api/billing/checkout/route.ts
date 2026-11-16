import { adminClient, checkoutParams, HttpError, isTrialEligible, liveStripeSubscription, requireUser, userSubscriptions } from '@/lib/server/billing';
import { hasPremiumAccess } from '@/lib/plus/subscription';
import { stripe } from '@/lib/server/stripe';
import type { PlanId } from '@/types';
import { handle } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cria uma sessão de Checkout do Stripe (página de pagamento hospedada e segura).
 * O acesso NÃO é liberado aqui: só o webhook confirma a assinatura.
 */
export async function POST(req: Request) {
  return handle(async (c) => {
    const user = await requireUser(req, c);
    const body = (await req.json().catch(() => ({}))) as { plan?: string };
    const plan = body.plan as PlanId;
    if (plan !== 'monthly' && plan !== 'annual') throw new HttpError(400, 'Plano inválido.');

    const db = adminClient(c);
    const subs = await userSubscriptions(db, user.id);
    if (subs.some((s) => hasPremiumAccess(s)) || liveStripeSubscription(subs)) throw new HttpError(409, 'Você já tem uma assinatura Classify+ ativa.');

    // Teste grátis: apenas plano mensal e apenas para contas que nunca iniciaram um teste.
    const trial = plan === 'monthly' && isTrialEligible(subs);
    const customerId = subs.find((s) => s.provider === 'stripe' && s.provider_customer_id)?.provider_customer_id ?? null;

    const session = await stripe<{ url: string }>('POST', '/checkout/sessions', checkoutParams(c, { plan, userId: user.id, email: user.email, customerId, trial }));
    return { url: session.url };
  });
}
