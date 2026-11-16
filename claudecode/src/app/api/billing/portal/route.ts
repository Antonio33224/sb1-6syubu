import { adminClient, requireUser, userSubscriptions } from '@/lib/server/billing';
import { stripe } from '@/lib/server/stripe';
import { handle } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Portal do cliente Stripe: atualizar cartão, ver faturas, cancelar. */
export async function POST(req: Request) {
  return handle(async (c) => {
    const user = await requireUser(req, c);
    const subs = await userSubscriptions(adminClient(c), user.id);
    const customer = subs.find((s) => s.provider === 'stripe' && s.provider_customer_id)?.provider_customer_id;
    if (!customer) return { url: null };
    const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer, return_url: `${c.siteUrl}/assinatura`, locale: 'pt-BR' });
    return { url: session.url };
  });
}
