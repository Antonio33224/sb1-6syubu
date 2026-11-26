/** Cria (ou reutiliza) a cobrança Pix na MisticPay (QR + copia e cola). Valor sempre do banco. */
import { createPayHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createPayHandler();
