/** Super admin: produtores (listar, suspender, reativar). */
import { createAdminProducersHandlers } from '@/lib/server/platform/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createAdminProducersHandlers();
export const GET = h.GET;
export const PATCH = h.PATCH;
