/** Admin: busca de usuários (nome, usuário ou e-mail) para conceder gratuidade. */
import { createAdminUserSearchHandler } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createAdminUserSearchHandler();
