/** Admin: leitura do audit log. */
import { createAdminAuditHandler } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createAdminAuditHandler();
