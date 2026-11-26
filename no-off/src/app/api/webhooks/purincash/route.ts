/** Webhooks do PurinCash (X-Webhook-Signature no corpo cru, deduplicação por X-Webhook-Id, confirmação por GET). */
import { createWebhookHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createWebhookHandler();
