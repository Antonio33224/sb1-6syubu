import { NextResponse } from 'next/server';
import { StripeError } from '@/lib/server/stripe';
import { billingConfig, HttpError, type BillingConfig } from '@/lib/server/billing';

/** Executa um handler de cobrança com configuração validada e erros traduzidos. */
export async function handle(fn: (c: BillingConfig) => Promise<unknown>) {
  const cfg = billingConfig();
  if (!cfg.ok) {
    return NextResponse.json({ error: 'Pagamentos ainda não configurados neste ambiente.' }, { status: 503 });
  }
  try {
    return NextResponse.json(await fn(cfg.config));
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof StripeError) {
      console.error('[billing] stripe', err.status, err.code, err.message);
      return NextResponse.json({ error: 'O gateway de pagamento recusou a operação. Tente novamente.' }, { status: 502 });
    }
    console.error('[billing]', err);
    return NextResponse.json({ error: 'Erro inesperado na cobrança.' }, { status: 500 });
  }
}
