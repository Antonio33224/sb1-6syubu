import { NextResponse } from 'next/server';
import { billingConfig } from '@/lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Informa se o gateway está configurado (sem revelar valores). */
export async function GET() {
  const cfg = billingConfig();
  return NextResponse.json(
    cfg.ok
      ? { configured: true, provider: 'stripe', message: null }
      : { configured: false, provider: null, message: 'O gateway de pagamento ainda não foi configurado pelo administrador.' },
  );
}
