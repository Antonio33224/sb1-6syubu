/** Cria o pagamento no Mercado Pago a partir do Payment Brick (valor recalculado no servidor). */
import { createPayHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createPayHandler();
