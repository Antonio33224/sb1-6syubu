/** Super admin: vendas de toda a plataforma. */
import { createAdminSalesHandler } from '@/lib/server/platform/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createAdminSalesHandler();
