/** Admin: e-mail do admin padrão e limites dos alertas de login (GET/PUT) e e-mail de teste (POST). */
import { createAdminSecurityHandlers } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createAdminSecurityHandlers();
export const GET = h.GET;
export const PUT = h.PUT;
export const POST = h.POST;
