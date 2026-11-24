/** Vercel Cron: marca reservas vencidas como expiradas (Authorization: Bearer CRON_SECRET). */
import { createExpireOrdersHandler } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createExpireOrdersHandler();
