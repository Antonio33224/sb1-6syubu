/** Registro de tentativa de login falha + alerta por e-mail ao admin padrão. */
import { createLoginFailedHandler } from '@/lib/server/security/login-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createLoginFailedHandler();
