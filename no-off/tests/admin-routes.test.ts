/**
 * Rotas /api/admin/*: bloqueadas para comprador/produtor (403) e para visitantes (401),
 * sem tocar no banco além da verificação de papel. Validação das entradas do super admin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdmin } from '../src/lib/server/auth';
import {
  createAdminAuditHandler,
  createAdminSecurityHandlers,
  createAdminUserSearchHandler,
  type AdminDeps,
} from '../src/lib/server/admin/handlers';
import { createAdminEventsHandlers, createAdminProducersHandlers, createAdminSalesHandler } from '../src/lib/server/platform/handlers';
import type { Mailer, MailMessage } from '../src/lib/server/mailer';
import { fakeSupabase } from './helpers/fake-supabase';

const ENV = { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: null, siteUrl: 'http://localhost:3000' };
const UUID = '22222222-2222-4222-8222-222222222222';

type Rpcs = Parameters<typeof fakeSupabase>[1];

function setup(opts: { superAdmin?: boolean; tables?: Record<string, Record<string, unknown>[]>; rpcs?: Rpcs; mailer?: Mailer | null } = {}) {
  const fake = fakeSupabase(opts.tables ?? {}, {
    // Papel conferido no banco, como public.is_admin() (= super_admin).
    is_admin: () => ({ data: opts.superAdmin === true, error: null }),
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

const VIS = { action: 'visibility', visibility: 'partial', hide_price: true, hide_location: false, hide_name: true, hide_capacity: false };

/** Todas as rotas/métodos administrativos. */
function allRoutes(deps: AdminDeps): [string, (r: Request) => Promise<Response>, Request][] {
  const security = createAdminSecurityHandlers(deps);
  const events = createAdminEventsHandlers(deps);
  const producers = createAdminProducersHandlers(deps);
  return [
    ['GET users', createAdminUserSearchHandler(deps), req('/api/admin/users?q=ana')],
    ['GET audit', createAdminAuditHandler(deps), req('/api/admin/audit')],
    ['GET security', security.GET, req('/api/admin/security')],
    ['PUT security', security.PUT, req('/api/admin/security', 'PUT', { admin_alert_email: 'a@b.com', login_alert_threshold: 5, login_alert_window_minutes: 15, login_alert_cooldown_minutes: 60 })],
    ['POST security (teste)', security.POST, req('/api/admin/security', 'POST')],
    ['GET events', events.GET, req('/api/admin/events')],
    ['PATCH event visibility', (r) => events.PATCH(r, UUID), req(`/api/admin/events/${UUID}`, 'PATCH', VIS)],
    ['PATCH event status', (r) => events.PATCH(r, UUID), req(`/api/admin/events/${UUID}`, 'PATCH', { action: 'status', status: 'suspended' })],
    ['GET producers', producers.GET, req('/api/admin/producers')],
    ['PATCH producers', producers.PATCH, req('/api/admin/producers', 'PATCH', { user_id: UUID, suspended: true })],
    ['GET sales', createAdminSalesHandler(deps), req('/api/admin/sales')],
  ];
}

test('comprador/produtor recebe 403 em TODAS as rotas do super admin, sem acesso ao banco', async () => {
  const sent: MailMessage[] = [];
  const { fake, deps } = setup({ superAdmin: false, mailer: { send: async (m) => void sent.push(m) } });
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
  const { fake, deps } = setup({ superAdmin: true });
  for (const [name, handler, r] of allRoutes(deps)) {
    const noAuth = new Request(r.url, { method: r.method, headers: { 'content-type': 'application/json' }, body: r.method === 'GET' ? undefined : await r.text() });
    assert.equal((await handler(noAuth)).status, 401, name);
  }
  assert.equal(fake.rpcCalls.length, 0);
});

test('falha ao verificar o papel (is_admin indisponível) → 403, nunca libera', async () => {
  const { deps } = setup({ rpcs: { is_admin: () => ({ data: null, error: { message: 'boom' } }) } });
  assert.equal((await createAdminEventsHandlers(deps).GET(req('/api/admin/events'))).status, 403);
});

test('Supabase não configurado → 503', async () => {
  const { deps } = setup({ superAdmin: true });
  const res = await createAdminEventsHandlers({ ...deps, env: () => null }).GET(req('/api/admin/events'));
  assert.equal(res.status, 503);
});

test('super admin: visibilidade passa pela função auditada admin_set_event_visibility', async () => {
  const { fake, deps } = setup({ superAdmin: true, rpcs: { admin_set_event_visibility: () => ({ data: null, error: null }) } });
  const res = await createAdminEventsHandlers(deps).PATCH(req(`/api/admin/events/${UUID}`, 'PATCH', VIS), UUID);
  assert.equal(res.status, 200);
  const [name, args] = fake.rpcCalls.at(-1)!;
  assert.equal(name, 'admin_set_event_visibility');
  assert.deepEqual(args, { p_event: UUID, p_visibility: 'partial', p_hide_price: true, p_hide_location: false, p_hide_name: true, p_hide_capacity: false });
  assert.deepEqual(fake.writes(), [], 'nada é gravado direto nas tabelas');
});

test('super admin: entradas inválidas → 400 sem chamar o banco', async () => {
  const { fake, deps } = setup({ superAdmin: true, rpcs: { admin_set_event_visibility: () => ({ data: null, error: null }) } });
  const h = createAdminEventsHandlers(deps);
  for (const bad of [
    { action: 'visibility', visibility: 'secreta', hide_price: true, hide_location: false, hide_name: false, hide_capacity: false },
    { action: 'visibility', visibility: 'partial' },
    { action: 'status', status: 'apagada' },
    { action: 'drop table' },
  ]) {
    assert.equal((await h.PATCH(req(`/api/admin/events/${UUID}`, 'PATCH', bad), UUID)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await h.PATCH(req('/api/admin/events/x', 'PATCH', VIS), 'nao-uuid')).status, 404);
  assert.ok(!fake.rpcCalls.some(([n]) => n === 'admin_set_event_visibility'));
});

test('super admin: suspender produtor — mensagem segura do banco vira 400', async () => {
  const { deps } = setup({
    superAdmin: true,
    rpcs: { admin_set_user_suspended: () => ({ data: null, error: { message: 'Você não pode suspender a própria conta.' } }) },
  });
  const res = await createAdminProducersHandlers(deps).PATCH(req('/api/admin/producers', 'PATCH', { user_id: UUID, suspended: true }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Você não pode suspender a própria conta.');
});

test('admin: e-mail do admin padrão é validado e o teste envia para ele', async () => {
  const sent: MailMessage[] = [];
  const { deps } = setup({
    superAdmin: true,
    tables: { admin_settings: [{ id: 1, admin_alert_email: 'alertas@nooff.com.br' }] },
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
  assert.equal(sent[0].to, 'alertas@nooff.com.br');
  assert.equal((await t.json()).sent_to, 'al***@n***.br', 'a resposta mascara o e-mail');
});

test('admin: e-mail de teste sem SMTP → 503', async () => {
  const { deps } = setup({ superAdmin: true, mailer: null });
  const res = await createAdminSecurityHandlers(deps).POST(req('/api/admin/security', 'POST'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'smtp_not_configured');
});
