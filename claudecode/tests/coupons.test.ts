/**
 * Cupons: regras (expirado, esgotado, limite por usuário, início futuro),
 * resgate pela rota e uso simultâneo.
 *
 * A rota delega TUDO a public.redeem_coupon() (uma transação com trava de
 * linha no Postgres). Aqui o banco é simulado por um "RPC atômico" que aplica
 * as mesmas regras de src/lib/coupons.ts — como o JS executa a função de uma
 * vez só, ela se comporta como a seção crítica do FOR UPDATE. Os testes provam
 * que a rota não faz "verifica e depois grava" fora dessa seção crítica.
 * A garantia real no Postgres é exercitada por supabase/tests/coupons.sql.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couponRejection, COUPON_CODE_RE, generateCouponCode, MAX_FAILED_REDEEMS_PER_HOUR, nextGrantWindow, normalizeCouponCode, type CouponRule } from '../src/lib/coupons';
import { createRedeemHandler, type CouponDeps } from '../src/lib/server/coupons/handlers';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const rule = (o: Partial<CouponRule> = {}): CouponRule => ({ active: true, starts_at: null, expires_at: null, max_redemptions: null, per_user_limit: 1, redemptions_count: 0, ...o });

// ------------------------------------------------------------------ regras puras

test('regras: expirado, esgotado, limite por usuário, agendado e inativo', () => {
  assert.equal(couponRejection(rule(), 0, NOW), null);
  assert.equal(couponRejection(null, 0, NOW), 'invalid');
  assert.equal(couponRejection(rule({ active: false }), 0, NOW), 'invalid');
  assert.equal(couponRejection(rule({ expires_at: iso(NOW - 1) }), 0, NOW), 'expired');
  assert.equal(couponRejection(rule({ expires_at: iso(NOW) }), 0, NOW), 'expired'); // expira no instante exato
  assert.equal(couponRejection(rule({ expires_at: iso(NOW + DAY) }), 0, NOW), null);
  assert.equal(couponRejection(rule({ starts_at: iso(NOW + DAY) }), 0, NOW), 'not_started');
  assert.equal(couponRejection(rule({ max_redemptions: 5, redemptions_count: 5 }), 0, NOW), 'exhausted');
  assert.equal(couponRejection(rule({ max_redemptions: 5, redemptions_count: 4 }), 0, NOW), null);
  assert.equal(couponRejection(rule({ per_user_limit: 1 }), 1, NOW), 'already_redeemed');
  assert.equal(couponRejection(rule({ per_user_limit: 2 }), 1, NOW), null);
});

test('código: normaliza espaços/caixa e gera códigos válidos', () => {
  assert.equal(normalizeCouponCode('  classify 2026-vip '), 'CLASSIFY2026-VIP');
  for (let i = 0; i < 50; i++) assert.match(generateCouponCode(), COUPON_CODE_RE);
  assert.ok(!COUPON_CODE_RE.test("ABC'; DROP TABLE coupons;--"));
});

test('gratuidades se somam: a nova começa quando a ativa termina', () => {
  const w1 = nextGrantWindow([], 30, NOW);
  assert.equal(w1.starts_at, iso(NOW));
  assert.equal(w1.ends_at, iso(NOW + 30 * DAY));
  const w2 = nextGrantWindow([{ ...w1, revoked_at: null }], 7, NOW);
  assert.equal(w2.starts_at, w1.ends_at);
  assert.equal(w2.ends_at, iso(NOW + 37 * DAY));
  // Revogada não conta.
  assert.equal(nextGrantWindow([{ ...w1, revoked_at: iso(NOW) }], 7, NOW).starts_at, iso(NOW));
});

// ------------------------------------------------------------------ banco simulado

interface Coupon extends CouponRule {
  id: string;
  code: string;
  grant_days: number;
}

function couponDb(coupons: Coupon[]) {
  const state = {
    coupons: new Map(coupons.map((c) => [c.code, { ...c }])),
    redemptions: [] as { coupon_id: string; user_id: string }[],
    grants: [] as { user_id: string; starts_at: string; ends_at: string; revoked_at: null }[],
    attempts: [] as { user_id: string; success: boolean }[],
    tableCalls: 0,
  };

  /** Espelho de public.redeem_coupon: executa inteiro, sem pausas (= seção crítica). */
  function redeem(uid: string, rawCode: string) {
    const code = normalizeCouponCode(rawCode);
    const fails = state.attempts.filter((a) => a.user_id === uid && !a.success).length;
    if (fails >= MAX_FAILED_REDEEMS_PER_HOUR) return { ok: false, reason: 'too_many_attempts' };
    const fail = (reason: string) => {
      state.attempts.push({ user_id: uid, success: false });
      return { ok: false, reason };
    };
    if (!COUPON_CODE_RE.test(code)) return fail('invalid');
    const c = state.coupons.get(code) ?? null;
    const used = c ? state.redemptions.filter((r) => r.coupon_id === c.id && r.user_id === uid).length : 0;
    const reason = couponRejection(c, used, NOW);
    if (reason) return fail(reason);
    const w = nextGrantWindow(state.grants.filter((g) => g.user_id === uid), c!.grant_days, NOW);
    state.grants.push({ user_id: uid, ...w, revoked_at: null });
    state.redemptions.push({ coupon_id: c!.id, user_id: uid });
    c!.redemptions_count += 1;
    state.attempts.push({ user_id: uid, success: true });
    return { ok: true, grant_id: `g${state.grants.length}`, ...w, days: c!.grant_days };
  }

  const dbFor = (uid: string) => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      // Latência de rede ANTES do banco: as requisições simultâneas se intercalam aqui.
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      if (name !== 'redeem_coupon') return { data: null, error: { message: `rpc ${name} não simulada` } };
      return { data: redeem(uid, String(args.p_code)), error: null };
    },
    from: () => {
      state.tableCalls += 1;
      throw new Error('a rota não deve acessar tabelas diretamente');
    },
  });

  const deps: CouponDeps = {
    env: () => ({ url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: null, siteUrl: 'http://localhost:3000' }),
    authenticate: async (req) => {
      const uid = req.headers.get('x-test-user');
      return uid ? { db: dbFor(uid) as never, userId: uid } : null;
    },
  };
  return { state, handler: createRedeemHandler(deps) };
}

const redeemReq = (user: string | null, code: unknown) =>
  new Request('http://localhost/api/coupons/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user, authorization: 'Bearer t' } : {}) },
    body: JSON.stringify({ code }),
  });

const coupon = (o: Partial<Coupon> = {}): Coupon => ({ id: 'c1', code: 'NOITE30', grant_days: 30, ...rule(), ...o });

// ------------------------------------------------------------------ rota

test('resgate válido cria gratuidade de N dias (código sem diferenciar maiúsculas)', async () => {
  const { handler, state } = couponDb([coupon()]);
  const res = await handler(redeemReq('u1', ' noite30 '));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.days, 30);
  assert.equal(body.ends_at, iso(NOW + 30 * DAY));
  assert.equal(state.grants.length, 1);
  assert.equal(state.tableCalls, 0);
});

test('cupom expirado → 410 e nenhuma gratuidade', async () => {
  const { handler, state } = couponDb([coupon({ expires_at: iso(NOW - DAY) })]);
  const res = await handler(redeemReq('u1', 'NOITE30'));
  assert.equal(res.status, 410);
  assert.equal((await res.json()).code, 'expired');
  assert.equal(state.grants.length, 0);
});

test('cupom esgotado → 409', async () => {
  const { handler } = couponDb([coupon({ max_redemptions: 1, redemptions_count: 1 })]);
  const res = await handler(redeemReq('u2', 'NOITE30'));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'exhausted');
});

test('limite por usuário: segundo uso recusado; com limite 2, o terceiro', async () => {
  const one = couponDb([coupon()]);
  assert.equal((await one.handler(redeemReq('u1', 'NOITE30'))).status, 200);
  const again = await one.handler(redeemReq('u1', 'NOITE30'));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'already_redeemed');
  assert.equal((await one.handler(redeemReq('u2', 'NOITE30'))).status, 200, 'outro usuário pode usar');

  const two = couponDb([coupon({ per_user_limit: 2 })]);
  assert.equal((await two.handler(redeemReq('u1', 'NOITE30'))).status, 200);
  assert.equal((await two.handler(redeemReq('u1', 'NOITE30'))).status, 200);
  assert.equal((await two.handler(redeemReq('u1', 'NOITE30'))).status, 409);
  // As duas gratuidades do mesmo usuário se somam (30 + 30 dias).
  assert.equal(two.state.grants[1].ends_at, iso(NOW + 60 * DAY));
});

test('uso duplo SIMULTÂNEO pelo mesmo usuário: exatamente um sucesso', async () => {
  const { handler, state } = couponDb([coupon()]);
  const results = await Promise.all(Array.from({ length: 8 }, () => handler(redeemReq('u1', 'NOITE30'))));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 200).length, 1, `status: ${statuses}`);
  assert.equal(statuses.filter((s) => s === 409).length, 7);
  assert.equal(state.grants.length, 1);
  assert.equal(state.coupons.get('NOITE30')!.redemptions_count, 1);
});

test('corrida entre usuários diferentes nunca passa do limite total', async () => {
  const { handler, state } = couponDb([coupon({ max_redemptions: 3 })]);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => handler(redeemReq(`u${i}`, 'NOITE30'))));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(state.coupons.get('NOITE30')!.redemptions_count, 3);
  assert.equal(state.grants.length, 3);
});

test('cupom agendado, inativo e inexistente', async () => {
  const { handler } = couponDb([coupon({ starts_at: iso(NOW + DAY) }), coupon({ id: 'c2', code: 'DESLIGADO', active: false })]);
  assert.equal((await (await handler(redeemReq('u1', 'NOITE30'))).json()).code, 'not_started');
  // Inativo e inexistente dão a MESMA resposta (não revela códigos).
  const off = await handler(redeemReq('u1', 'DESLIGADO'));
  const none = await handler(redeemReq('u1', 'NAOEXISTE'));
  assert.equal(off.status, 404);
  assert.equal(none.status, 404);
});

test('força bruta: após 10 tentativas inválidas → 429', async () => {
  const { handler, state } = couponDb([coupon()]);
  for (let i = 0; i < 10; i++) assert.equal((await handler(redeemReq('u1', `CHUTE${i}`))).status, 404);
  const blocked = await handler(redeemReq('u1', 'NOITE30')); // até o código certo é bloqueado
  assert.equal(blocked.status, 429);
  assert.equal(state.grants.length, 0);
});

test('sem login → 401; corpo inválido → 400', async () => {
  const { handler } = couponDb([coupon()]);
  assert.equal((await handler(redeemReq(null, 'NOITE30'))).status, 401);
  assert.equal((await handler(redeemReq('u1', ''))).status, 400);
  assert.equal((await handler(redeemReq('u1', { $ne: null }))).status, 400);
  assert.equal((await handler(redeemReq('u1', 'x'.repeat(500)))).status, 400);
});
