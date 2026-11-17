/**
 * Rotas /api/admin/*: bloqueadas para usuário comum (403) e para visitantes (401),
 * sem tocar no banco além da verificação de papel. Validação das entradas do admin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdmin } from '../src/lib/server/auth';
import {
  createAdminAuditHandler,
  createAdminCouponHandlers,
  createAdminGrantHandlers,
  createAdminSecurityHandlers,
  createAdminUserSearchHandler,
  type AdminDeps,
} from '../src/lib/server/admin/handlers';
import type { Mailer, MailMessage } from '../src/lib/server/mailer';
import { fakeSupabase } from './helpers/fake-supabase';

const ENV = { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: null, siteUrl: 'http://localhost:3000' };
const UUID = '22222222-2222-4222-8222-222222222222';

type Rpcs = Parameters<typeof fakeSupabase>[1];

function setup(opts: { role?: 'admin' | 'user'; tables?: Record<string, Record<string, unknown>[]>; rpcs?: Rpcs; mailer?: Mailer | null } = {}) {
  const fake = fakeSupabase(opts.tables ?? {}, {
    // Papel conferido no banco, como public.is_admin().
    is_admin: () => ({ data: opts.role === 'admin', error: null }),
    ...(opts.rpcs ?? {}),
  });
  const deps: AdminDeps = {
    env: () => ENV,
    authenticate: async (req) => (req.headers.get('authorization') ? { db: fake.db, userId: 'u1' } : null),
    isAdmin: checkAdmin,
    mailer: () => opts.mailer ?? null,
  };
  return { fake, deps };
}

const req = (path: string, method = 'GET', body?: unknown, auth = true) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { ...(auth ? { authorization: 'Bearer t' } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Todas as rotas/métodos administrativos. */
function allRoutes(deps: AdminDeps): [string, (r: Request) => Promise<Response>, Request][] {
  const coupons = createAdminCouponHandlers(deps);
  const grants = createAdminGrantHandlers(deps);
  const security = createAdminSecurityHandlers(deps);
  const validCoupon = { code: 'NOITE30', grant_days: 30 };
  return [
    ['GET coupons', coupons.GET, req('/api/admin/coupons')],
    ['POST coupons', coupons.POST, req('/api/admin/coupons', 'POST', validCoupon)],
    ['PATCH coupons', coupons.PATCH, req('/api/admin/coupons', 'PATCH', { id: UUID, active: false })],
    ['GET grants', grants.GET, req('/api/admin/grants')],
    ['POST grants', grants.POST, req('/api/admin/grants', 'POST', { user_id: UUID, days: 30, reason: 'parceria' })],
    ['DELETE grants', grants.DELETE, req('/api/admin/grants', 'DELETE', { id: UUID, reason: 'x' })],
    ['GET users', createAdminUserSearchHandler(deps), req('/api/admin/users?q=ana')],
    ['GET audit', createAdminAuditHandler(deps), req('/api/admin/audit')],
    ['GET security', security.GET, req('/api/admin/security')],
    ['PUT security', security.PUT, req('/api/admin/security', 'PUT', { admin_alert_email: 'a@b.com', login_alert_threshold: 5, login_alert_window_minutes: 15, login_alert_cooldown_minutes: 60 })],
    ['POST security (teste)', security.POST, req('/api/admin/security', 'POST')],
  ];
}

test('usuário comum recebe 403 em TODAS as rotas admin, sem acesso ao banco', async () => {
  const sent: MailMessage[] = [];
  const { fake, deps } = setup({ role: 'user', mailer: { send: async (m) => void sent.push(m) } });
  for (const [name, handler, r] of allRoutes(deps)) {
    const res = await handler(r);
    assert.equal(res.status, 403, name);
    assert.equal((await res.json()).code, 'forbidden', name);
  }
  assert.deepEqual(fake.calls, [], 'nenhuma tabela consultada');
  assert.deepEqual([...new Set(fake.rpcCalls.map(([n]) => n))], ['is_admin'], 'só a verificação de papel');
  assert.equal(sent.length, 0, 'nenhum e-mail enviado');
});

test('visitante sem login recebe 401 em todas as rotas admin', async () => {
  const { fake, deps } = setup({ role: 'admin' });
  for (const [name, handler, r] of allRoutes(deps)) {
    const noAuth = new Request(r.url, { method: r.method, headers: { 'content-type': 'application/json' }, body: r.method === 'GET' ? undefined : await r.text() });
    assert.equal((await handler(noAuth)).status, 401, name);
  }
  assert.equal(fake.rpcCalls.length, 0);
});

test('falha ao verificar o papel (is_admin indisponível) → 403, nunca libera', async () => {
  const { deps } = setup({ rpcs: { is_admin: () => ({ data: null, error: { message: 'boom' } }) } });
  assert.equal((await createAdminCouponHandlers(deps).GET(req('/api/admin/coupons'))).status, 403);
});

test('Supabase não configurado → 503', async () => {
  const { deps } = setup({ role: 'admin' });
  const res = await createAdminCouponHandlers({ ...deps, env: () => null }).GET(req('/api/admin/coupons'));
  assert.equal(res.status, 503);
});

test('admin: lista cupons e cria via função auditada admin_upsert_coupon', async () => {
  const { fake, deps } = setup({
    role: 'admin',
    tables: { coupons: [{ id: UUID, code: 'NOITE30' }] },
    rpcs: { admin_upsert_coupon: (a) => ({ data: { id: UUID, code: a.p_code }, error: null }) },
  });
  const h = createAdminCouponHandlers(deps);
  const list = await h.GET(req('/api/admin/coupons'));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).coupons[0].code, 'NOITE30');

  const created = await h.POST(req('/api/admin/coupons', 'POST', { code: ' noite 30 ', grant_days: 30, max_redemptions: 100, expires_at: '2026-12-31T23:59:00.000Z' }));
  assert.equal(created.status, 200);
  const [name, args] = fake.rpcCalls.at(-1)!;
  assert.equal(name, 'admin_upsert_coupon');
  assert.equal(args.p_code, 'NOITE30');
  assert.equal(args.p_per_user_limit, 1);
  assert.equal(args.p_max_redemptions, 100);
  assert.deepEqual(fake.writes(), [], 'nada é gravado direto nas tabelas');
});

test('admin: entradas de cupom inválidas → 400', async () => {
  const { fake, deps } = setup({ role: 'admin', rpcs: { admin_upsert_coupon: () => ({ data: {}, error: null }) } });
  const h = createAdminCouponHandlers(deps);
  for (const bad of [
    { code: 'AB', grant_days: 30 },
    { code: "X'; DROP TABLE coupons;--", grant_days: 30 },
    { code: 'NOITE30', grant_days: 0 },
    { code: 'NOITE30', grant_days: 30, per_user_limit: 99 },
    { code: 'NOITE30', grant_days: 30, starts_at: '2026-12-31T00:00:00Z', expires_at: '2026-12-01T00:00:00Z' },
  ]) {
    assert.equal((await h.POST(req('/api/admin/coupons', 'POST', bad))).status, 400, JSON.stringify(bad));
  }
  assert.ok(!fake.rpcCalls.some(([n]) => n === 'admin_upsert_coupon'));
});

test('admin: conceder gratuidade exige motivo e dias válidos; erro do banco vira mensagem', async () => {
  const { deps } = setup({
    role: 'admin',
    rpcs: { admin_grant_premium: () => ({ data: null, error: { message: 'Usuário não encontrado.' } }) },
  });
  const h = createAdminGrantHandlers(deps);
  assert.equal((await h.POST(req('/api/admin/grants', 'POST', { user_id: UUID, days: 30, reason: '' }))).status, 400);
  assert.equal((await h.POST(req('/api/admin/grants', 'POST', { user_id: 'nao-uuid', days: 30, reason: 'teste' }))).status, 400);
  assert.equal((await h.POST(req('/api/admin/grants', 'POST', { user_id: UUID, days: 99999, reason: 'teste' }))).status, 400);
  const res = await h.POST(req('/api/admin/grants', 'POST', { user_id: UUID, days: 30, reason: 'parceria' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Usuário não encontrado.');
});

test('admin: e-mail do admin padrão é validado e o teste envia para ele', async () => {
  const sent: MailMessage[] = [];
  const { deps } = setup({
    role: 'admin',
    tables: { admin_settings: [{ id: 1, admin_alert_email: 'alertas@classifydj.com' }] },
    rpcs: { admin_security_test_logged: () => ({ data: null, error: null }) },
    mailer: { send: async (m) => void sent.push(m) },
  });
  const h = createAdminSecurityHandlers(deps);
  const bad = await h.PUT(req('/api/admin/security', 'PUT', { admin_alert_email: 'nao-e-email', login_alert_threshold: 5, login_alert_window_minutes: 15, login_alert_cooldown_minutes: 60 }));
  assert.equal(bad.status, 400);
  const low = await h.PUT(req('/api/admin/security', 'PUT', { admin_alert_email: 'a@b.com', login_alert_threshold: 1, login_alert_window_minutes: 15, login_alert_cooldown_minutes: 60 }));
  assert.equal(low.status, 400);

  const t = await h.POST(req('/api/admin/security', 'POST'));
  assert.equal(t.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'alertas@classifydj.com');
  assert.equal((await t.json()).sent_to, 'al***@c***.com', 'a resposta mascara o e-mail');
});

test('admin: e-mail de teste sem SMTP → 503', async () => {
  const { deps } = setup({ role: 'admin', mailer: null });
  const res = await createAdminSecurityHandlers(deps).POST(req('/api/admin/security', 'POST'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'smtp_not_configured');
});
