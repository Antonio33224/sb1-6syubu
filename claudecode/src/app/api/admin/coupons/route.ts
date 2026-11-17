/** Admin: cupons (listar, criar/editar, ativar/desativar). */
import { createAdminCouponHandlers } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createAdminCouponHandlers();
export const GET = h.GET;
export const POST = h.POST;
export const PATCH = h.PATCH;
