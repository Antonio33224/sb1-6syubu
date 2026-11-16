import { adminClient, HttpError, liveStripeSubscription, requireUser, syncStripeSubscription, userSubscriptions } from '@/lib/server/billing';
import { stripe } from '@/lib/server/stripe';
import { handle } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Desfaz um cancelamento agendado enquanto o período ainda está vigente. */
export async function POST(req: Request) {
  return handle(async (c) => {
    const user = await requireUser(req, c);
    const db = adminClient(c);
    const live = liveStripeSubscription(await userSubscriptions(db, user.id));
    if (!live || !live.cancel_at_period_end) throw new HttpError(404, 'Não há cancelamento agendado.');
    const updated = await stripe('POST', `/subscriptions/${encodeURIComponent(live.provider_subscription_id!)}`, { cancel_at_period_end: false });
    await syncStripeSubscription(db, c, updated as never, user.id);
    return { ok: true };
  });
}
