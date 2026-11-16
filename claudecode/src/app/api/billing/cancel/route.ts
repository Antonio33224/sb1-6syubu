import { adminClient, HttpError, liveStripeSubscription, requireUser, syncStripeSubscription, userSubscriptions } from '@/lib/server/billing';
import { stripe } from '@/lib/server/stripe';
import { handle } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancela ao fim do período já pago (cancel_at_period_end). */
export async function POST(req: Request) {
  return handle(async (c) => {
    const user = await requireUser(req, c);
    const db = adminClient(c);
    const live = liveStripeSubscription(await userSubscriptions(db, user.id));
    if (!live) throw new HttpError(404, 'Nenhuma assinatura vigente para cancelar.');
    const updated = await stripe('POST', `/subscriptions/${encodeURIComponent(live.provider_subscription_id!)}`, { cancel_at_period_end: true });
    // Estado retornado pela API do Stripe (o webhook confirmará o mesmo estado).
    await syncStripeSubscription(db, c, updated as never, user.id);
    return { ok: true };
  });
}
