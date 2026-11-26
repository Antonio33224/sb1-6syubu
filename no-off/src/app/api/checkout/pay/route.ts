/** Cria (ou reutiliza) a cobrança no PurinCash: Pix (padrão, QR + copia e cola) ou cartão (checkoutUrl). Valor sempre do banco. */
import { createPayHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createPayHandler();
