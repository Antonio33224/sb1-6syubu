/** Super admin: busca de usuários (nome, usuário, e-mail ou celular). */
import { createAdminUserSearchHandler } from '@/lib/server/admin/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createAdminUserSearchHandler();
