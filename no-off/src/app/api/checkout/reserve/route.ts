/** Reserva de ingressos (trava o estoque por alguns minutos). Comprador logado. */
import { createReserveHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createReserveHandler();
