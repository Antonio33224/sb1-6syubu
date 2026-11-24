/**
 * Rotas administrativas (/api/admin/*). Cada requisição:
 *   1. exige token Supabase válido (401);
 *   2. confere o papel admin NO SERVIDOR via public.is_admin() (403);
 *   3. executa com o token do próprio admin — RLS e as funções admin_* conferem de novo.
 * As escritas passam por funções SQL que gravam em audit_logs.
 */
import { z } from 'zod';
import { authenticate, checkAdmin, json, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { log, maskEmail } from '../log-sanitize';
import { defaultMailer, type Mailer } from '../mailer';

export interface AdminDeps {
  env: () => SupabaseEnv | null;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
  isAdmin: (ctx: AuthContext) => Promise<boolean>;
  mailer: () => Mailer | null;
}

export const defaultAdminDeps: AdminDeps = { env: () => supabaseEnv(), authenticate, isAdmin: checkAdmin, mailer: defaultMailer };

type Guarded = { error: Response } | { error?: undefined; auth: AuthContext; env: SupabaseEnv };

export async function adminGuard(req: Request, deps: AdminDeps): Promise<Guarded> {
  const env = deps.env();
  if (!env) return { error: json(503, { error: 'Recurso disponível apenas com o Supabase configurado.', code: 'not_configured' }) };
  const auth = await deps.authenticate(req, env);
  if (!auth) return { error: json(401, { error: 'Entre na sua conta.', code: 'unauthenticated' }) };
  if (!(await deps.isAdmin(auth))) {
    log.warn('[admin] acesso negado', new URL(req.url).pathname, auth.userId);
    return { error: json(403, { error: 'Acesso restrito a administradores.', code: 'forbidden' }) };
  }
  return { auth, env };
}

const parseBody = async (req: Request) => req.json().catch(() => null);
const dbError = (where: string, e: { message: string }) => {
  log.error(`[admin] ${where}`, e.message);
  // Mensagens de raise exception das funções são seguras para o admin.
  const known = /Acesso restrito|já existe|não encontrad|Informe|último super admin|suspender|inválid/i.test(e.message);
  return json(known ? 400 : 503, { error: known ? e.message.slice(0, 200) : 'Falha ao acessar o banco.', code: 'database' });
};

export function createAdminUserSearchHandler(deps: AdminDeps = defaultAdminDeps) {
  return async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 80);
    if (q.length < 2) return json(200, { users: [] });
    const { data, error } = await g.auth.db.rpc('admin_find_users', { p_query: q });
    if (error) return dbError('users.search', error);
    return json(200, { users: data ?? [] });
  };
}

// ------------------------------------------------------------------ auditoria

const SEVERITIES = ['info', 'warning', 'critical'] as const;

export function createAdminAuditHandler(deps: AdminDeps = defaultAdminDeps) {
  return async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 100));
    let q = g.auth.db
      .from('audit_logs')
      .select('id, created_at, action, target_type, target_id, severity, metadata, actor:profiles!audit_logs_actor_id_fkey(username)')
      .order('id', { ascending: false })
      .limit(limit);
    const before = Number(sp.get('before'));
    if (Number.isInteger(before) && before > 0) q = q.lt('id', before);
    const severity = sp.get('severity');
    if (severity && (SEVERITIES as readonly string[]).includes(severity)) q = q.eq('severity', severity);
    const action = sp.get('action');
    if (action && /^[a-z_.]{3,80}$/.test(action)) q = q.like('action', `${action}%`);
    // Logs de alterações de uma festa específica (ou de um usuário).
    const target = sp.get('target');
    if (target && z.string().uuid().safeParse(target).success) q = q.eq('target_id', target);
    const { data, error } = await q;
    if (error) return dbError('audit.list', error);
    return json(200, { entries: data ?? [] });
  };
}

// ------------------------------------------------------------------ segurança (e-mail do admin padrão)

const securityInput = z.object({
  admin_alert_email: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v.toLowerCase())
    .pipe(z.union([z.literal(''), z.string().email('E-mail inválido.')]))
    .transform((v) => v || null),
  login_alert_threshold: z.number().int().min(3).max(100),
  login_alert_window_minutes: z.number().int().min(1).max(1440),
  login_alert_cooldown_minutes: z.number().int().min(5).max(1440),
});

const SECURITY_COLUMNS = 'admin_alert_email, login_alert_threshold, login_alert_window_minutes, login_alert_cooldown_minutes, last_login_alert_at, updated_at';

export function createAdminSecurityHandlers(deps: AdminDeps = defaultAdminDeps) {
  async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const { data, error } = await g.auth.db.from('admin_settings').select(SECURITY_COLUMNS).eq('id', 1).maybeSingle();
    if (error) return dbError('security.get', error);
    return json(200, { settings: data, smtp_configured: deps.mailer() !== null });
  }

  async function PUT(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const p = securityInput.safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: p.error.issues[0]?.message ?? 'Dados inválidos.', code: 'invalid_input' });
    const { data, error } = await g.auth.db.from('admin_settings').update(p.data).eq('id', 1).select(SECURITY_COLUMNS).maybeSingle();
    if (error) return dbError('security.update', error);
    if (!data) return json(403, { error: 'Acesso restrito a administradores.', code: 'forbidden' });
    return json(200, { settings: data });
  }

  /** Envia um e-mail de teste para o e-mail do admin padrão. */
  async function POST(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const mailer = deps.mailer();
    if (!mailer) return json(503, { error: 'SMTP não configurado no servidor (SMTP_HOST e EMAIL_FROM).', code: 'smtp_not_configured' });
    const { data, error } = await g.auth.db.from('admin_settings').select('admin_alert_email').eq('id', 1).maybeSingle();
    if (error) return dbError('security.test', error);
    const to = (data as { admin_alert_email: string | null } | null)?.admin_alert_email;
    if (!to) return json(400, { error: 'Defina e salve o e-mail do admin padrão antes de testar.', code: 'no_recipient' });
    try {
      await mailer.send({
        to,
        subject: '[NO OFF] Teste de alertas de segurança',
        text: 'Este é um e-mail de teste. Os alertas de tentativas de login falhas serão enviados para este endereço.',
      });
    } catch (err) {
      log.error('[admin] smtp teste', err);
      return json(502, { error: 'O servidor SMTP recusou o envio. Confira as variáveis SMTP_*.', code: 'smtp_failed' });
    }
    await g.auth.db.rpc('admin_security_test_logged');
    return json(200, { ok: true, sent_to: maskEmail(to) });
  }

  return { GET, PUT, POST };
}
