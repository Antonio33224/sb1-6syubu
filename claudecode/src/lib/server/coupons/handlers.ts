/**
 * POST /api/coupons/redeem — resgate de cupom pelo usuário logado.
 * Toda a regra (validade, limites, concorrência) roda em public.redeem_coupon(),
 * numa única transação: este handler NÃO faz "verifica e depois grava".
 */
import { z } from 'zod';
import { normalizeCouponCode, REDEEM_ERRORS, type RedeemReason } from '@/lib/coupons';
import { authenticate, json, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { log } from '../log-sanitize';

export interface CouponDeps {
  env: () => SupabaseEnv | null;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
}

export const defaultCouponDeps: CouponDeps = { env: () => supabaseEnv(), authenticate };

const body = z.object({ code: z.string().trim().min(1).max(64) });

interface RedeemResult {
  ok: boolean;
  reason?: RedeemReason;
  grant_id?: string;
  starts_at?: string;
  ends_at?: string;
  days?: number;
}

export function createRedeemHandler(deps: CouponDeps = defaultCouponDeps) {
  return async function POST(req: Request): Promise<Response> {
    const env = deps.env();
    if (!env) return json(503, { error: 'Cupons exigem o banco de dados (Supabase) configurado.', code: 'not_configured' });
    const auth = await deps.authenticate(req, env);
    if (!auth) return json(401, { error: REDEEM_ERRORS.unauthenticated[1], code: 'unauthenticated' });

    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return json(400, { error: 'Informe o código do cupom.', code: 'invalid_input' });

    const { data, error } = await auth.db.rpc('redeem_coupon', { p_code: normalizeCouponCode(p.data.code) });
    if (error) {
      log.error('[coupons] redeem', error.message);
      return json(503, { error: 'Não foi possível resgatar o cupom agora. Tente de novo.', code: 'database' });
    }
    const r = data as RedeemResult;
    if (!r?.ok) {
      const reason: RedeemReason = r?.reason && r.reason in REDEEM_ERRORS ? r.reason : 'invalid';
      const [status, message] = REDEEM_ERRORS[reason];
      return json(status, { error: message, code: reason });
    }
    return json(200, { ok: true, grant_id: r.grant_id, starts_at: r.starts_at, ends_at: r.ends_at, days: r.days });
  };
}
