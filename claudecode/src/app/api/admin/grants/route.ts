/** Admin: gratuidades de Classify+ (listar, conceder, revogar). */
import { createAdminGrantHandlers } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createAdminGrantHandlers();
export const GET = h.GET;
export const POST = h.POST;
export const DELETE = h.DELETE;
