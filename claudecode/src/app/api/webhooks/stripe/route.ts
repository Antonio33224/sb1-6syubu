import { NextResponse } from 'next/server';
import { adminClient, billingConfig, fetchAndSync, syncStripeSubscription } from '@/lib/server/billing';
import { verifyStripeSignature } from '@/lib/server/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Obj = Record<string, unknown>;
type StripeEvent = { id: string; type: string; data: { object: Obj } };

/** ID da assinatura numa fatura — compatível com versões antigas e novas da API. */
function invoiceSubscriptionId(inv: Obj): string | null {
  if (typeof inv.subscription === 'string') return inv.subscription;
  const parent = inv.parent as { subscription_details?: { subscription?: string } } | undefined;
  return parent?.subscription_details?.subscription ?? null;
}

/**
 * Webhook do Stripe — ÚNICA via que altera o status das assinaturas.
 *  1. Valida a assinatura HMAC do payload bruto (rejeita eventos forjados).
 *  2. Garante processamento único por evento (billing_webhook_events).
 *  3. Sincroniza a assinatura a partir da API do Stripe (fonte da verdade).
 */
export async function POST(req: Request) {
  const cfg = billingConfig();
  if (!cfg.ok) return NextResponse.json({ error: 'Pagamentos não configurados.' }, { status: 503 });
  const c = cfg.config;

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), c.webhookSecret)) {
    return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const db = adminClient(c);
  const { error: dupError } = await db.from('billing_webhook_events').insert({ id: event.id, provider: 'stripe', type: event.type });
  if (dupError) {
    if (/duplicate key/i.test(dupError.message)) return NextResponse.json({ received: true, duplicate: true });
    console.error('[webhook] idempotency', dupError.message);
    return NextResponse.json({ error: 'Falha ao registrar evento.' }, { status: 500 });
  }

  try {
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        if (o.mode === 'subscription' && typeof o.subscription === 'string') {
          const userId = (o.client_reference_id as string) ?? (o.metadata as Obj | undefined)?.user_id;
          await fetchAndSync(db, c, o.subscription, (userId as string) ?? null);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        await syncStripeSubscription(db, c, o as never);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const subId = invoiceSubscriptionId(o);
        const failed = event.type === 'invoice.payment_failed';
        const amount = Number(failed ? o.amount_due : o.amount_paid) || 0;
        let subscriptionRowId: string | null = null;
        let userId: string | null = null;
        if (subId) {
          await fetchAndSync(db, c, subId);
          const { data } = await db.from('subscriptions').select('id, user_id').eq('provider_subscription_id', subId).maybeSingle();
          subscriptionRowId = data?.id ?? null;
          userId = data?.user_id ?? null;
        }
        // Faturas de R$ 0 (início do teste grátis) não são pagamentos recebidos.
        if (amount > 0 && typeof o.id === 'string') {
          const transitions = o.status_transitions as { paid_at?: number } | undefined;
          await db.from('subscription_payments').upsert(
            {
              subscription_id: subscriptionRowId,
              user_id: userId,
              provider_invoice_id: o.id,
              amount_cents: amount,
              currency: String(o.currency ?? 'brl').toUpperCase(),
              status: failed ? 'failed' : 'paid',
              failure_reason: failed ? ((o.last_finalization_error as Obj | undefined)?.message as string) ?? 'Pagamento recusado' : null,
              paid_at: !failed && transitions?.paid_at ? new Date(transitions.paid_at * 1000).toISOString() : failed ? null : new Date().toISOString(),
            },
            { onConflict: 'provider_invoice_id' },
          );
        }
        break;
      }
      default:
        break; // eventos não utilizados são apenas registrados
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // Libera o evento para que o Stripe tente novamente.
    await db.from('billing_webhook_events').delete().eq('id', event.id);
    console.error('[webhook]', event.type, err);
    return NextResponse.json({ error: 'Falha ao processar evento.' }, { status: 500 });
  }
}
