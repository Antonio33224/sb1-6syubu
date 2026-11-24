/** Super admin: todas as festas, com produtor, visibilidade e vendas. */
import { createAdminEventsHandlers } from '@/lib/server/platform/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createAdminEventsHandlers().GET;
