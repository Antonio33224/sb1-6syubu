/** Resgate de cupom (dias de Classify+). Regras e concorrência em public.redeem_coupon(). */
import { createRedeemHandler } from '@/lib/server/coupons/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createRedeemHandler();
