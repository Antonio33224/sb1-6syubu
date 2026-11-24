/** Notificações do Mercado Pago (assinatura x-signature validada, idempotente). */
import { createWebhookHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createWebhookHandler();
