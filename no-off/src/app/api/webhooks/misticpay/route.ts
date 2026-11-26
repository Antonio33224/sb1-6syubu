/** Webhooks da MisticPay (token secreto na URL, deduplicação, confirmação por /transactions/check). */
import { createWebhookHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createWebhookHandler();
