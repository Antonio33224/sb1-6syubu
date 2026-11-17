/**
 * POST /api/auth/login-failed — registra uma tentativa de login falha e, ao
 * passar do limite configurado no painel, envia e-mail ao admin padrão.
 *
 * O login continua direto no Supabase Auth (o servidor não vê senhas). A tela
 * de login avisa este endpoint quando o Supabase recusa as credenciais.
 *
 * - O registro e o controle de intervalo entre alertas ficam no Postgres
 *   (public.record_login_failure, service_role), valendo para todas as instâncias.
 * - O IP é guardado só como hash (HMAC-SHA256), nunca em claro.
 * - A resposta não revela se a conta existe nem dados de outros usuários.
 */
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { clientIp, json, serviceClient, supabaseEnv, type SupabaseEnv } from '../auth';
import { log, maskEmail } from '../log-sanitize';
import { defaultMailer, loginAlertEmail, type Mailer } from '../mailer';

export interface FailureResult {
  recorded: boolean;
  email_failures?: number;
  ip_failures?: number;
  threshold?: number;
  window_minutes?: number;
  too_many: boolean;
  should_alert: boolean;
  alert_email?: string | null;
}

export interface LoginAlertDeps {
  env: () => SupabaseEnv | null;
  /** Grava a falha no banco (null quando não há service_role configurada). */
  record: (env: SupabaseEnv, email: string, ipHash: string) => Promise<FailureResult | null>;
  mailer: () => Mailer | null;
  hashSecret: () => string;
  now: () => Date;
}

async function recordInDb(env: SupabaseEnv, email: string, ipHash: string): Promise<FailureResult | null> {
  const db = serviceClient(env);
  if (!db) return null;
  const { data, error } = await db.rpc('record_login_failure', { p_email: email, p_ip_hash: ipHash });
  if (error) throw new Error(error.message);
  return data as FailureResult;
}

export const defaultLoginAlertDeps: LoginAlertDeps = {
  env: () => supabaseEnv(),
  record: recordInDb,
  mailer: defaultMailer,
  hashSecret: () => process.env.LOG_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'classify-dj',
  now: () => new Date(),
};

export const hashIp = (ip: string, secret: string) => createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);

const body = z.object({ email: z.string().trim().toLowerCase().max(254).email() });

export function createLoginFailedHandler(deps: LoginAlertDeps = defaultLoginAlertDeps) {
  return async function POST(req: Request): Promise<Response> {
    const env = deps.env();
    if (!env) return json(202, { ok: true, tracked: false });
    const p = body.safeParse(await req.json().catch(() => null));
    // Resposta genérica mesmo para entrada inválida (não ajuda enumeração).
    if (!p.success) return json(202, { ok: true, tracked: false });
    const email = p.data.email;

    let r: FailureResult | null;
    try {
      r = await deps.record(env, email, hashIp(clientIp(req), deps.hashSecret()));
    } catch (err) {
      log.error('[auth] registrar falha de login', err);
      return json(202, { ok: true, tracked: false });
    }
    if (!r) {
      log.warn('[auth] SUPABASE_SERVICE_ROLE_KEY ausente: falhas de login não são registradas.');
      return json(202, { ok: true, tracked: false });
    }

    if (r.should_alert && r.alert_email) {
      const mailer = deps.mailer();
      if (!mailer) {
        log.warn('[auth] alerta de login não enviado: SMTP não configurado.');
      } else {
        try {
          await mailer.send({
            to: r.alert_email,
            ...loginAlertEmail({
              email,
              emailFailures: r.email_failures ?? 0,
              ipFailures: r.ip_failures ?? 0,
              windowMinutes: r.window_minutes ?? 15,
              threshold: r.threshold ?? 5,
              at: deps.now(),
              siteUrl: env.siteUrl,
            }),
          });
          log.warn('[auth] alerta de login enviado', maskEmail(email));
        } catch (err) {
          log.error('[auth] falha ao enviar alerta de login', err);
        }
      }
    }

    return json(202, {
      ok: true,
      tracked: r.recorded,
      too_many: r.too_many,
      ...(r.too_many ? { retry_after_minutes: r.window_minutes ?? 15 } : {}),
    });
  };
}
