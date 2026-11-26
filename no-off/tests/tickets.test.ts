/**
 * Venda de ingressos com PurinCash: assinatura do webhook no corpo cru,
 * deduplicação por X-Webhook-Id, confirmação por GET, conferência de valor,
 * reutilização de cobrança, retry em 429, reserva, cron, campos ocultos e utilitários.
 * Sem rede: fetch, sleep e Supabase são falsos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { formatCpf, isValidCpf, toE164 } from '../src/lib/cpf';
import {
  backoffMs,
  cardAmountCents,
  createPixCharge,
  credentialError,
  getCharge,
  metadataOrderId,
  purinConfig,
  PurinError,
  simulatePaid,
  verifyWebhookSignature,
  type PurinConfig,
} from '../src/lib/server/purincash';
import {
  createExpireOrdersHandler,
  createOrderHandlers,
  createPayHandler,
  createReserveHandler,
  createWebhookHandler,
  type TicketDeps,
} from '../src/lib/server/tickets/handlers';
import { redact } from '../src/lib/server/log-sanitize';
import { HIDDEN_TEXT, mapPublicEvent, priceLabel } from '../src/lib/public-events';
import { parseVipCsv } from '../src/lib/vip-csv';
import { buildTables, toCsv } from '../src/lib/server/reports';
import type { MailMessage } from '../src/lib/server/mailer';
import type { EventReport } from '../src/types/tickets';
import { fakeSupabase } from './helpers/fake-supabase';

const ENV = { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc', siteUrl: 'https://nooff.test' };
const SECRET = 'segredo-webhook-purincash';
const SANDBOX: PurinConfig = { apiKey: 'ps_test_abc123', webhookSecret: SECRET, environment: 'sandbox' };
const LIVE: PurinConfig = { apiKey: 'ps_live_abc123', webhookSecret: SECRET, environment: 'live' };
const ORDER = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const BATCH = '55555555-5555-4555-8555-555555555555';
const META = JSON.stringify({ orderId: ORDER });

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ utilitários

test('CPF: dígitos verificadores, sequências repetidas e máscara', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('52998224724'), false);
  assert.equal(isValidCpf('11111111111'), false);
  assert.equal(isValidCpf('123'), false);
  assert.equal(formatCpf('52998224725'), '529.982.247-25');
  assert.equal(toE164('(21) 99999-1234'), '+5521999991234');
  assert.equal(toE164('5521999991234'), '+5521999991234');
  assert.equal(toE164('9999'), null);
});

const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

test('assinatura: HMAC-SHA256 hex do corpo cru — válida, inválida, corpo alterado, ausente', () => {
  const raw = JSON.stringify({ event: 'charge.paid', paymentId: 'psc_1', amountCents: 15000 });
  assert.equal(verifyWebhookSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyWebhookSignature(Buffer.from(raw), sign(raw).toUpperCase(), SECRET), true, 'hex maiúsculo / Buffer');
  assert.equal(verifyWebhookSignature(raw, sign(raw, 'outro-segredo'), SECRET), false, 'outro segredo');
  assert.equal(verifyWebhookSignature(raw.replace('15000', '1'), sign(raw), SECRET), false, 'corpo alterado');
  assert.equal(verifyWebhookSignature(raw + ' ', sign(raw), SECRET), false, 'um byte a mais');
  assert.equal(verifyWebhookSignature(raw, null, SECRET), false);
  assert.equal(verifyWebhookSignature(raw, 'abc', SECRET), false, 'tamanho errado não chega ao timingSafeEqual');
  assert.equal(verifyWebhookSignature(raw, 'z'.repeat(64), SECRET), false);
});

test('config: ambiente pelo prefixo da chave; produção recusa ps_test_; chave nunca aparece nos logs', () => {
  assert.equal(purinConfig({ PURINCASH_API_KEY: 'ps_test_x' })!.environment, 'sandbox');
  assert.equal(purinConfig({ PURINCASH_API_KEY: 'ps_live_x', PURINCASH_WEBHOOK_SECRET: 's' })!.environment, 'live');
  assert.equal(purinConfig({}), null);
  assert.equal(credentialError(SANDBOX, false), null);
  assert.match(credentialError(SANDBOX, true)!, /ps_test_/);
  assert.equal(credentialError(LIVE, true), null);
  assert.match(credentialError({ ...LIVE, apiKey: 'chave-qualquer' }, false)!, /formato/);
  assert.ok(!credentialError(SANDBOX, true)!.includes(SANDBOX.apiKey));
  assert.equal(redact('Authorization falhou para ps_live_AbCdEf123456'), 'Authorization falhou para [chave]');
});

test('utilitários: metadata string JSON, amount em reais, backoff respeita RateLimit-Reset', () => {
  assert.equal(metadataOrderId(META), ORDER);
  assert.equal(metadataOrderId('{"orderId":"x"}'), null);
  assert.equal(metadataOrderId('não é json'), null);
  assert.equal(metadataOrderId(null), null);
  assert.equal(cardAmountCents({ amount: 49.9 }), 4990);
  assert.equal(cardAmountCents({ amount: '150.00' }), 15000);
  assert.equal(cardAmountCents({ amountCents: 4990, amount: 1 }), 4990);
  assert.equal(cardAmountCents({}), null);
  assert.ok(backoffMs(0, '2', () => 0) >= 2000);
  assert.ok(backoffMs(0, '999', () => 0) <= 10_000, 'limitado');
  assert.ok(backoffMs(3, null, () => 1) <= 5_000);
});

// ------------------------------------------------------------------ cliente HTTP

function scriptedFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { f, calls };
}

test('cliente: 429 é repetido com backoff (RateLimit-Reset) e a chave vai só no Authorization', async () => {
  const { f, calls } = scriptedFetch([
    { status: 429, body: { error: 'Too many requests' }, headers: { 'RateLimit-Reset': '1' } },
    { status: 502, body: { error: 'bad gateway' } },
    { status: 200, body: { paymentId: 'psc_1', status: 'pending', amountCents: 100 } },
  ]);
  const sleeps: number[] = [];
  const c = await getCharge(SANDBOX, 'psc_1', { fetch: f, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(c.paymentId, 'psc_1');
  assert.equal(calls.length, 3);
  assert.ok(sleeps[0]! >= 1000, 'esperou o RateLimit-Reset');
  assert.equal(calls[0]!.url, 'https://api.purin.cash/v1/charges/psc_1');
  assert.equal((calls[0]!.init!.headers as Record<string, string>).authorization, 'Bearer ps_test_abc123');
});

test('cliente: 400/401/404 não são repetidos; 429 esgota as tentativas', async () => {
  for (const status of [400, 401, 403, 404]) {
    const { f, calls } = scriptedFetch([{ status, body: { error: 'nope' } }]);
    await assert.rejects(getCharge(SANDBOX, 'psc_1', { fetch: f, sleep: async () => {} }), (e: unknown) => e instanceof PurinError && e.status === status);
    assert.equal(calls.length, 1, `status ${status} sem retry`);
  }
  const { f, calls } = scriptedFetch([{ status: 429, body: { error: 'slow down' } }]);
  await assert.rejects(getCharge(SANDBOX, 'psc_1', { fetch: f, sleep: async () => {}, retries: 2 }), (e: unknown) => e instanceof PurinError && e.retryable);
  assert.equal(calls.length, 3);
});

test('cliente: Pix valida valor mínimo e limita expiresIn; simulate-paid só no sandbox', async () => {
  const { f, calls } = scriptedFetch([{ status: 201, body: { paymentId: 'psc_9', status: 'pending', amountCents: 80 } }]);
  assert.throws(() => createPixCharge(SANDBOX, { valueCents: 79, description: 'x', expiresIn: 600, customer: { name: 'A', email: 'a@b.co' }, metadata: '{}' }));
  await createPixCharge(SANDBOX, { valueCents: 80, description: 'x'.repeat(300), expiresIn: 5, customer: { name: 'A', email: 'a@b.co' }, metadata: '{}' }, { fetch: f });
  const sent = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(sent.expiresIn, 60);
  assert.equal(sent.description.length, 200);
  assert.throws(() => simulatePaid(LIVE, 'psc_9'), /sandbox/);
});

// ------------------------------------------------------------------ handlers

/** apply_payment falso que imita as regras da 0007 (valor em centavos, idempotência, cobrança atual). */
function fakeApply(tables: Record<string, Row[]>) {
  return (a: Record<string, unknown>) => {
    const p = a.p_payment as Row;
    const order = (tables.orders ?? []).find((o) => o.id === a.p_order);
    if (!order) return { data: { result: 'order_not_found' }, error: null };
    const status = p.status === 'paid' ? 'approved' : p.status === 'failed' ? 'rejected' : String(p.status);
    const payments = (tables.payments ??= []);
    let pay = payments.find((x) => x.provider === 'purincash' && x.provider_payment_id === p.id);
    if (!pay) payments.push((pay = { order_id: order.id, provider: 'purincash', provider_payment_id: p.id, created_at: new Date().toISOString() }));
    Object.assign(pay, { status, payment_method: p.method, amount_cents: p.amount_cents });
    for (const k of ['pix_brcode', 'pix_qr_image', 'checkout_url', 'provider_expires_at'] as const) if (p[k]) pay[k] = p[k];
    const mine = !order.provider_payment_id || order.provider_payment_id === p.id;
    if (status === 'approved') {
      if (order.status === 'paid') return { data: { result: 'already_paid' }, error: null };
      if (p.amount_cents !== Math.round(Number(order.total) * 100)) {
        pay.status = 'amount_mismatch';
        return { data: { result: 'amount_mismatch' }, error: null };
      }
      Object.assign(order, { status: 'paid', provider_payment_id: p.id });
      (tables.tickets ??= []).push({ id: 't1', order_id: order.id });
      return { data: { result: 'issued', tickets: 1 }, error: null };
    }
    if (status === 'pending') {
      if (p.register || !order.provider_payment_id) order.provider_payment_id = p.id;
      return { data: { result: 'pending' }, error: null };
    }
    if (status === 'refunded' && mine) order.status = 'refunded';
    return { data: { result: status === 'refunded' ? 'refunded' : 'cancelled' }, error: null };
  };
}

type Route = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;

function deps(opts: { tables?: Record<string, Row[]>; routes?: Route; userId?: string | null; purin?: PurinConfig | null; production?: boolean; mail?: boolean } = {}) {
  const tables = opts.tables ?? {};
  const audits: Record<string, unknown>[] = [];
  const rpcs = {
    apply_payment: fakeApply(tables),
    server_audit: (a: Record<string, unknown>) => (audits.push(a), { data: null, error: null }),
    expire_orders: () => ({ data: 2, error: null }),
  };
  const user = fakeSupabase(tables, rpcs);
  const svc = fakeSupabase(tables, rpcs);
  const fetchCalls: { url: string; method: string; body: Row | null }[] = [];
  const deferred: Promise<unknown>[] = [];
  const sent: MailMessage[] = [];
  const d: TicketDeps = {
    env: () => ENV,
    purin: () => (opts.purin === undefined ? SANDBOX : opts.purin),
    production: () => opts.production ?? false,
    authenticate: async () => (opts.userId === null ? null : { db: user.db, userId: opts.userId ?? 'buyer-1' }),
    service: () => svc.db,
    mailer: () => (opts.mail ? { send: async (m: MailMessage) => void sent.push(m) } : null),
    sleep: async () => {},
    defer: (task) => void deferred.push(task()),
    cronSecret: () => 'cron-secret',
    fetch: (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      fetchCalls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const r = opts.routes?.(String(url), init) ?? { status: 404, body: { error: 'Not found' } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return { d, tables, user, svc, fetchCalls, audits, deferred, sent, flush: () => Promise.all(deferred) };
}

const webhookReq = (body: unknown, o: { id?: string | null; sig?: string | null } = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (o.sig !== null) headers['x-webhook-signature'] = o.sig ?? sign(raw);
  if (o.id !== null) headers['x-webhook-id'] = o.id ?? `${(body as Row).event}:${(body as Row).paymentId ?? (body as Row).orderCode}`;
  return new Request('https://nooff.test/api/webhooks/purincash', { method: 'POST', headers, body: raw });
};

const pendingOrder = (over: Row = {}): Row => ({
  id: ORDER, user_id: 'buyer-1', event_id: EVENT, status: 'pending', total: 150, buyer_name: 'Ana Souza', buyer_cpf: '52998224725',
  buyer_email: 'ana@exemplo.com', expires_at: new Date(Date.now() + 8 * 60_000).toISOString(), provider_payment_id: null, ...over,
});
const chargeGet = (over: Row = {}) => ({ paymentId: 'psc_777', status: 'paid', amountCents: 15000, metadata: META, paidAt: '2030-01-01T00:00:00Z', ...over });

test('webhook: assinatura inválida, ausente ou corpo alterado → 401 e nada é consultado/aplicado', async () => {
  const body = { event: 'charge.paid', paymentId: 'psc_777', amountCents: 15000, metadata: META };
  for (const req of [
    webhookReq(body, { sig: '0'.repeat(64) }),
    webhookReq(body, { sig: null }),
    webhookReq(JSON.stringify({ ...body, amountCents: 1 }), { sig: sign(JSON.stringify(body)) }),
  ]) {
    const { d, svc, fetchCalls } = deps({ tables: { orders: [pendingOrder()] } });
    const res = await createWebhookHandler(d)(req);
    assert.equal(res.status, 401);
    assert.equal(fetchCalls.length, 0, 'não consulta a API');
    assert.equal(svc.rpcCalls.length, 0, 'não aplica pagamento');
    assert.deepEqual(svc.writes(), [], 'nem registra o evento');
  }
});

test('webhook: confirma por GET (não confia no corpo), emite e deduplica pelo X-Webhook-Id', async () => {
  const { d, tables, svc, fetchCalls, flush } = deps({
    tables: { orders: [pendingOrder({ provider_payment_id: 'psc_777' })], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix' }], purincash_webhook_events: [] },
    routes: (url) => (url.endsWith('/charges/psc_777') ? { body: chargeGet() } : undefined),
  });
  const h = createWebhookHandler(d);
  // O corpo diz um valor/pedido falso — vale a consulta à API.
  const body = { event: 'charge.paid', paymentId: 'psc_777', amountCents: 1, status: 'paid', metadata: JSON.stringify({ orderId: '99999999-9999-4999-8999-999999999999' }) };
  const r1 = await h(webhookReq(body, { id: 'charge.paid:psc_777' }));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).result, 'issued');
  assert.equal(fetchCalls[0]!.url, 'https://api.purin.cash/v1/charges/psc_777');
  const apply = svc.rpcCalls.find(([n]) => n === 'apply_payment')!;
  assert.equal(apply[1].p_order, ORDER);
  assert.equal((apply[1].p_payment as Row).amount_cents, 15000, 'valor da API, não do corpo');
  assert.equal(tables.orders![0]!.status, 'paid');
  await flush();

  // Reentrega (mesmo X-Webhook-Id, mesmo corpo) → não processa de novo.
  const r2 = await h(webhookReq(body, { id: 'charge.paid:psc_777' }));
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).duplicate, true);
  assert.equal(svc.rpcCalls.filter(([n]) => n === 'apply_payment').length, 1, 'idempotente');
  assert.equal(fetchCalls.length, 1, 'sem nova consulta');
  assert.equal(tables.purincash_webhook_events!.length, 1);
});

test('webhook: "payment.paid" do simulate-paid no sandbox (psc_) é tratado como Pix pago', async () => {
  const { d, tables, fetchCalls } = deps({
    tables: { orders: [pendingOrder()], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix' }], purincash_webhook_events: [] },
    routes: (url) => (url.endsWith('/charges/psc_777') ? { body: chargeGet() } : undefined),
  });
  const res = await createWebhookHandler(d)(webhookReq({ event: 'payment.paid', paymentId: 'psc_777', amountCents: 15000, status: 'paid', metadata: META, sandbox: true }));
  assert.equal((await res.json()).result, 'issued');
  assert.ok(fetchCalls[0]!.url.endsWith('/charges/psc_777'), 'confirmou em /charges');
  assert.equal(tables.orders![0]!.status, 'paid');

  // payment.paid de outro produto (psa_) não é nosso.
  const other = deps({ tables: { purincash_webhook_events: [] } });
  const r2 = await createWebhookHandler(other.d)(webhookReq({ event: 'payment.paid', paymentId: 'psa_abc', status: 'paid' }));
  assert.equal((await r2.json()).result, 'ignored');
  assert.equal(other.fetchCalls.length, 0);
});

test('webhook: amountCents divergente do pedido NÃO emite ingresso e alerta o admin', async () => {
  const { d, tables, sent, flush } = deps({
    mail: true,
    tables: {
      orders: [pendingOrder()],
      payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix' }],
      purincash_webhook_events: [],
      admin_settings: [{ id: 1, admin_alert_email: 'admin@nooff.test' }],
      tickets: [],
    },
    routes: (url) => (url.endsWith('/charges/psc_777') ? { body: chargeGet({ amountCents: 100 }) } : undefined),
  });
  // O corpo até diz o valor certo — a API diz que foi pago R$ 1,00.
  const res = await createWebhookHandler(d)(webhookReq({ event: 'charge.paid', paymentId: 'psc_777', amountCents: 15000, metadata: META }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result, 'amount_mismatch');
  await flush();
  assert.equal(tables.orders![0]!.status, 'pending', 'pedido não foi pago');
  assert.equal(tables.tickets!.length, 0, 'nenhum ingresso');
  assert.equal(tables.payments![0]!.status, 'amount_mismatch');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, 'admin@nooff.test');
  assert.match(sent[0]!.text, /R\$ 1\.00/);
});

test('webhook: card_payment.paid (amount em REAIS) confirma em /card-payments e emite', async () => {
  const { d, tables, fetchCalls, svc } = deps({
    purin: LIVE,
    tables: { orders: [pendingOrder({ provider_payment_id: 'JUE7Y9MPSX' })], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'JUE7Y9MPSX', status: 'pending', payment_method: 'card' }], purincash_webhook_events: [] },
    // A consulta de cartão não traz metadata nem (aqui) amountCents: só amount em reais.
    routes: (url) => (url.endsWith('/card-payments/JUE7Y9MPSX') ? { body: { orderCode: 'JUE7Y9MPSX', status: 'paid', amount: 150.0, currency: 'BRL', paidAt: '2030-01-01T00:00:00Z' } } : undefined),
  });
  const res = await createWebhookHandler(d)(webhookReq({ event: 'card_payment.paid', orderCode: 'JUE7Y9MPSX', amount: 150.0, status: 'paid', paidAt: '2030-01-01T00:00:00Z', customer: { name: 'Ana', email: 'ana@exemplo.com' }, metadata: META }));
  assert.equal((await res.json()).result, 'issued');
  assert.equal(fetchCalls[0]!.url, 'https://api.purin.cash/v1/card-payments/JUE7Y9MPSX');
  const p = svc.rpcCalls.find(([n]) => n === 'apply_payment')![1].p_payment as Row;
  assert.equal(p.amount_cents, 15000, 'R$ 150,00 → 15000 centavos');
  assert.equal(p.payment_type, 'credit_card');
  assert.equal(tables.orders![0]!.status, 'paid');
});

test('webhook: Pix pago depois do estoque acabar → reembolso integral com idempotencyKey = pedido', async () => {
  const tables: Record<string, Row[]> = { orders: [pendingOrder()], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_888', status: 'pending', payment_method: 'pix' }], purincash_webhook_events: [] };
  const { d, fetchCalls, audits, flush } = deps({
    tables,
    routes: (url, init) => {
      if (url.endsWith('/charges/psc_888')) return { body: chargeGet({ paymentId: 'psc_888' }) };
      if (url.endsWith('/refunds') && init?.method === 'POST') return { status: 201, body: { id: 'rfd_1', status: 'processing' } };
      return undefined;
    },
  });
  // apply_payment devolve needs_refund (reserva vencida e estoque esgotado).
  const noStock = fakeSupabase(tables, { apply_payment: () => ({ data: { result: 'needs_refund' }, error: null }), server_audit: (a) => (audits.push(a), { data: null, error: null }) });
  const h = createWebhookHandler({ ...d, service: () => noStock.db });
  const res = await h(webhookReq({ event: 'charge.paid', paymentId: 'psc_888', metadata: META }));
  assert.equal((await res.json()).result, 'needs_refund');
  await flush();
  const refund = fetchCalls.find((c) => c.url.endsWith('/refunds'))!;
  assert.deepEqual({ paymentId: refund.body!.paymentId, idempotencyKey: refund.body!.idempotencyKey }, { paymentId: 'psc_888', idempotencyKey: ORDER });
  assert.ok(audits.some((a) => a.p_action === 'payment.refund_requested'));
});

test('webhook: sem PURINCASH_WEBHOOK_SECRET → 503; eventos desconhecidos são ignorados; refund.failed vai ao audit log', async () => {
  const a = deps();
  const noSecret = createWebhookHandler({ ...a.d, purin: () => ({ ...SANDBOX, webhookSecret: null }) });
  assert.equal((await noSecret(webhookReq({ event: 'charge.paid', paymentId: 'psc_1' }))).status, 503);

  const b = deps({ tables: { purincash_webhook_events: [] } });
  const r = await createWebhookHandler(b.d)(webhookReq({ event: 'subscription.renewed', paymentId: 'psc_1' }));
  assert.equal((await r.json()).result, 'ignored');
  assert.equal(b.fetchCalls.length, 0);

  const c = deps({ tables: { purincash_webhook_events: [], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_5' }] } });
  const rf = await createWebhookHandler(c.d)(webhookReq({ event: 'refund.failed', paymentId: 'psc_5', refundId: 'rfd_9', failureCode: 'not_sent' }));
  assert.equal((await rf.json()).result, 'refund_failed');
  assert.equal(c.audits[0]!.p_action, 'payment.refund_failed');
  assert.equal(c.audits[0]!.p_severity, 'critical');
  assert.equal(c.audits[0]!.p_target_id, ORDER);
});

test('webhook: falha na API → 500 (PurinCash reenvia) e o evento pode ser reprocessado', async () => {
  let up = false;
  const { d, tables } = deps({
    tables: { orders: [pendingOrder()], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix' }], purincash_webhook_events: [] },
    routes: (url) => (url.endsWith('/charges/psc_777') ? (up ? { body: chargeGet() } : { status: 500, body: { error: 'boom' } }) : undefined),
  });
  const h = createWebhookHandler(d);
  const body = { event: 'charge.paid', paymentId: 'psc_777', metadata: META };
  assert.equal((await h(webhookReq(body))).status, 500);
  assert.equal(tables.purincash_webhook_events![0]!.processed_at, undefined);
  up = true;
  const ok = await h(webhookReq(body));
  assert.equal((await ok.json()).result, 'issued');
});

// ------------------------------------------------------------------ pagamento

const payReq = (body: unknown) => new Request('https://nooff.test/api/checkout/pay', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('pagamento Pix: valor do BANCO em centavos, prazo = reserva, callbackUrl e metadata com orderId', async () => {
  const { d, fetchCalls, tables } = deps({
    tables: { orders: [pendingOrder()], public_events: [{ id: EVENT, name: 'Festa X', name_hidden: false }], payments: [] },
    routes: (url, init) =>
      url.endsWith('/charges') && init?.method === 'POST'
        ? { status: 201, body: { paymentId: 'psc_new', status: 'pending', amountCents: 15000, currency: 'BRL', environment: 'sandbox', pix: { brCode: '000201PIX', qrCodeImage: 'data:image/png;base64,AAA' }, expiresAt: new Date(Date.now() + 8 * 60_000).toISOString() } }
        : undefined,
  });
  const res = await createPayHandler(d)(payReq({ order_id: ORDER, method: 'pix', total: 0.01 }));
  assert.equal(res.status, 200);
  const body = fetchCalls[0]!.body!;
  assert.equal(fetchCalls[0]!.url, 'https://api.purin.cash/v1/charges');
  assert.equal(body.valueCents, 15000, 'ignora qualquer valor do navegador');
  assert.ok(Number(body.expiresIn) > 400 && Number(body.expiresIn) <= 480, 'mesmo prazo da reserva');
  assert.equal(body.callbackUrl, 'https://nooff.test/api/webhooks/purincash');
  assert.equal(body.metadata, META, 'metadata é string JSON');
  assert.deepEqual(body.customer, { name: 'Ana Souza', email: 'ana@exemplo.com', externalId: 'buyer-1' });
  const out = await res.json();
  assert.equal(out.pix.br_code, '000201PIX');
  assert.equal(out.card_available, false, 'sandbox esconde cartão');
  assert.equal(out.reused, false);
  assert.equal(tables.orders![0]!.provider_payment_id, 'psc_new', 'cobrança registrada no pedido');
  assert.equal(tables.payments![0]!.pix_brcode, '000201PIX');
});

test('pagamento: reutiliza a cobrança pendente do pedido em vez de criar outra', async () => {
  const exp = new Date(Date.now() + 6 * 60_000).toISOString();
  const { d, fetchCalls } = deps({
    tables: {
      orders: [pendingOrder({ provider_payment_id: 'psc_old' })],
      payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_old', status: 'pending', payment_method: 'pix', pix_brcode: 'BRCODE-OLD', pix_qr_image: 'https://qr.test/x.png', provider_expires_at: exp }],
    },
  });
  const res = await createPayHandler(d)(payReq({ order_id: ORDER }));
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.reused, true);
  assert.equal(out.pix.br_code, 'BRCODE-OLD');
  assert.equal(fetchCalls.length, 0, 'nenhuma cobrança nova');

  // Cobrança quase vencida não é reutilizada.
  const near = deps({
    tables: { orders: [pendingOrder()], public_events: [], payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_old', status: 'pending', payment_method: 'pix', pix_brcode: 'X', provider_expires_at: new Date(Date.now() + 10_000).toISOString() }] },
    routes: () => ({ status: 201, body: { paymentId: 'psc_new', status: 'pending', amountCents: 15000, pix: { brCode: 'NEW', qrCodeImage: '' } } }),
  });
  assert.equal((await (await createPayHandler(near.d)(payReq({ order_id: ORDER }))).json()).pix.br_code, 'NEW');
});

test('pagamento cartão: indisponível no sandbox; em produção devolve checkoutUrl com successUrl → /pedido/[id]', async () => {
  const sb = deps({ tables: { orders: [pendingOrder()] } });
  const r1 = await createPayHandler(sb.d)(payReq({ order_id: ORDER, method: 'card' }));
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).code, 'card_unavailable');
  assert.equal(sb.fetchCalls.length, 0);

  const live = deps({
    purin: LIVE,
    tables: { orders: [pendingOrder()], public_events: [], payments: [] },
    routes: (url) => (url.endsWith('/card-payments') ? { status: 201, body: { orderCode: 'JUE7Y9MPSX', status: 'pending', amountCents: 15000, currency: 'BRL', checkoutUrl: 'https://pay.purin.cash/c/JUE7Y9MPSX', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } } : undefined),
  });
  const r2 = await createPayHandler(live.d)(payReq({ order_id: ORDER, method: 'card' }));
  const out = await r2.json();
  assert.equal(out.checkout_url, 'https://pay.purin.cash/c/JUE7Y9MPSX');
  assert.equal(out.card_available, true);
  const sent = live.fetchCalls[0]!.body!;
  assert.equal(sent.successUrl, `https://nooff.test/pedido/${ORDER}`);
  assert.equal(sent.valueCents, 15000);
  assert.equal(live.tables.payments![0]!.payment_method, 'card');
});

test('pagamento: pedido de outra pessoa → 404; reserva expirada → 409; sem login → 401; erro 4xx do gateway → 402', async () => {
  const other = deps({ tables: { orders: [pendingOrder({ user_id: 'outra-pessoa' })] } });
  assert.equal((await createPayHandler(other.d)(payReq({ order_id: ORDER }))).status, 404);
  assert.equal(other.fetchCalls.length, 0);

  const expired = deps({ tables: { orders: [pendingOrder({ expires_at: new Date(Date.now() - 1000).toISOString() })] } });
  assert.equal((await createPayHandler(expired.d)(payReq({ order_id: ORDER }))).status, 409);
  assert.equal(expired.fetchCalls.length, 0, 'não cria cobrança');

  const anon = deps({ userId: null });
  assert.equal((await createPayHandler(anon.d)(payReq({ order_id: ORDER }))).status, 401);

  const refused = deps({ tables: { orders: [pendingOrder()], public_events: [], payments: [] }, routes: () => ({ status: 400, body: { error: 'valueCents inválido' } }) });
  assert.equal((await createPayHandler(refused.d)(payReq({ order_id: ORDER }))).status, 402);
  assert.equal(refused.fetchCalls.length, 1, '400 não é repetido');
});

// ------------------------------------------------------------------ pedido / reserva / cron

test('GET do pedido: reconcilia por GET na API enquanto pendente e devolve o Pix', async () => {
  const exp = new Date(Date.now() + 6 * 60_000).toISOString();
  const { d, fetchCalls } = deps({
    tables: {
      orders: [pendingOrder({ provider_payment_id: 'psc_777', created_at: '2030-01-01' })],
      payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix', pix_brcode: 'BR', pix_qr_image: '', provider_expires_at: exp, checked_at: null }],
      tickets: [],
    },
    routes: (url) => (url.endsWith('/charges/psc_777') ? { body: chargeGet() } : undefined),
  });
  const res = await createOrderHandlers(d).GET(new Request(`https://nooff.test/api/orders/${ORDER}`), ORDER);
  const out = await res.json();
  assert.equal(fetchCalls.length, 1);
  assert.equal(out.order.status, 'paid');
  assert.equal(out.order.provider_payment_id, undefined, 'id do provedor não vai ao navegador');
  assert.equal(out.payment.pix, null, 'pago: sem QR');
});

const reserveReq = (body: unknown) => new Request('https://nooff.test/api/checkout/reserve', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const buyer = { name: 'Ana Souza', cpf: '529.982.247-25', email: 'ana@exemplo.com', phone: '(21) 99999-1234' };

test('reserva: valida os dados do comprador antes do banco e repassa a mensagem de estoque', async () => {
  const d0 = deps();
  const user = fakeSupabase({}, { reserve_order: () => ({ data: null, error: { message: 'Restam apenas 2 ingressos do lote "1º lote".' } }) });
  const d: TicketDeps = { ...d0.d, authenticate: async () => ({ db: user.db, userId: 'buyer-1' }) };
  const h = createReserveHandler(d);
  for (const b of [{ ...buyer, cpf: '111.111.111-11' }, { ...buyer, name: 'Ana' }, { ...buyer, email: 'x' }, { ...buyer, phone: '123' }]) {
    assert.equal((await h(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 2 }], buyer: b }))).status, 400, JSON.stringify(b));
  }
  assert.equal((await h(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 11 }], buyer }))).status, 400, 'máx. 10 por item');
  assert.equal(user.rpcCalls.length, 0);

  const res = await h(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 3 }], buyer }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Restam apenas 2/);
  const [, args] = user.rpcCalls[0]!;
  assert.deepEqual(args.p_buyer, { name: 'Ana Souza', cpf: '52998224725', email: 'ana@exemplo.com', phone: '21999991234' });
});

test('reserva: devolve os meios disponíveis; erro interno do banco não vaza detalhes', async () => {
  const d0 = deps();
  const ok = fakeSupabase({}, { reserve_order: () => ({ data: { order_id: ORDER, total: 150, expires_at: 'x' }, error: null }) });
  const r1 = await createReserveHandler({ ...d0.d, authenticate: async () => ({ db: ok.db, userId: 'buyer-1' }) })(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 1 }], buyer }));
  assert.deepEqual((await r1.json()).payment, { environment: 'sandbox', card_available: false });

  const bad = fakeSupabase({}, { reserve_order: () => ({ data: null, error: { message: 'relation "orders" does not exist' } }) });
  const res = await createReserveHandler({ ...d0.d, authenticate: async () => ({ db: bad.db, userId: 'buyer-1' }) })(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 1 }], buyer }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'Falha ao acessar o banco.');
});

test('pagamentos não configurados → 503 e produção com chave ps_test_ é bloqueada', async () => {
  const a = deps({ purin: null });
  assert.equal((await createReserveHandler(a.d)(reserveReq({}))).status, 503);
  const b = deps({ production: true });
  const res = await createReserveHandler(b.d)(reserveReq({}));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'payments_misconfigured');
  const c = deps({ production: true, purin: LIVE, userId: null });
  assert.equal((await createReserveHandler(c.d)(reserveReq({}))).status, 401, 'chave live em produção passa');
});

test('cron: exige CRON_SECRET e confere na API antes de expirar', async () => {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  const { d, svc, fetchCalls, tables } = deps({
    tables: {
      orders: [pendingOrder({ provider: 'purincash', provider_payment_id: 'psc_777', expires_at: past }), pendingOrder({ id: '66666666-6666-4666-8666-666666666666', expires_at: past })],
      payments: [{ order_id: ORDER, provider: 'purincash', provider_payment_id: 'psc_777', status: 'pending', payment_method: 'pix', checked_at: new Date().toISOString() }],
    },
    routes: (url) => (url.endsWith('/charges/psc_777') ? { body: chargeGet() } : undefined),
  });
  const h = createExpireOrdersHandler(d);
  assert.equal((await h(new Request('https://nooff.test/api/cron/expire-orders'))).status, 401);
  const ok = await h(new Request('https://nooff.test/api/cron/expire-orders', { headers: { authorization: 'Bearer cron-secret' } }));
  const out = await ok.json();
  assert.equal(out.expired, 2);
  assert.equal(out.checked, 1);
  assert.equal(fetchCalls.length, 1, 'consultou a API mesmo com checagem recente (force)');
  assert.equal(tables.orders![0]!.status, 'paid', 'pago sem webhook foi salvo antes de expirar');
  const names = svc.rpcCalls.map(([n]) => n);
  assert.ok(names.indexOf('apply_payment') < names.indexOf('expire_orders'));
});

// ------------------------------------------------------------------ campos ocultos

test('view pública: campos ocultos chegam NULL e viram "Em breve" sem dados reais', () => {
  const row = {
    id: EVENT, slug: EVENT, name: null, description: 'd', cover_image: '/c.jpg', gallery: [], event_date: '2030-01-01', start_time: '23:00', category: 'festa',
    ticket_price: null, ticket_url: null, venue_id: null, location_name: null, address: null, city: 'Rio de Janeiro', state: 'RJ',
    capacity: null, tickets_sold: null, dj_names: [], music_styles: [], is_demo: false, created_at: '2029-01-01',
    name_hidden: true, price_hidden: true, location_hidden: true, capacity_hidden: true, has_tickets: true,
  };
  const e = mapPublicEvent(row, new Map());
  assert.equal(e.name, HIDDEN_TEXT.name);
  assert.equal(e.venue.name, HIDDEN_TEXT.location);
  assert.equal(e.venue.slug, '', 'sem link para a casa');
  assert.equal(e.venue.address, '');
  assert.equal(e.venue.latitude, 0);
  assert.equal(priceLabel(e, String), HIDDEN_TEXT.price);
  assert.equal(e.capacity, null);
  assert.equal(e.city, 'Rio de Janeiro', 'cidade continua visível');
});

// ------------------------------------------------------------------ lista VIP / relatório

test('CSV da lista VIP: cabeçalho, ; ou ,, CPF inválido descartado, duplicados ignorados', () => {
  const r = parseVipCsv('﻿nome;cpf;email;celular;observacao\nAna Souza;529.982.247-25;ana@x.com;21999991234;+1\nBruno;123;;;\n"Silva, Carla";;;;camarote\nAna Souza;529.982.247-25;;;\n;;;;');
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0]!.cpf, '52998224725');
  assert.equal(r.rows[1]!.cpf, null);
  assert.equal(r.rows[2]!.name, 'Silva, Carla');
  assert.ok(r.warnings.some((w) => /CPF inválido/.test(w)));
  assert.ok(r.warnings.some((w) => /repetido/.test(w)));
  const noHeader = parseVipCsv('João Lima,,,,\nMaria Dias,,,,');
  assert.equal(noHeader.rows.length, 2);
});

test('relatório CSV: BOM, separador ; e proteção contra injeção de fórmula', () => {
  const report: EventReport = {
    event: { id: EVENT, name: 'Festa', event_date: '2030-01-01', start_time: '23:00', capacity: 100 },
    buyers: [{ order_id: ORDER, buyer_name: '=HYPERLINK("x")', buyer_cpf: '52998224725', buyer_email: 'a@b.com', buyer_phone: '21999991234', batch: '1º lote', ticket_type: 'pista', quantity: 2, unit_price: 50, amount: 100, created_at: '2029-12-01T12:00:00Z', paid_at: '2029-12-01T12:01:00Z', status: 'paid', payment_method: 'pix', installments: 1, checked_in: 1, tickets: 2 }],
    vip: [],
    revenue: { gross: 100, fees: 1, net: 99, refunded: 0, by_batch: [], by_method: [] },
    checkins: { tickets_used: 1, tickets_total: 2, vip_present: 0, vip_total: 0 },
  };
  const csv = toCsv(buildTables(report, 'compradores'));
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('Nome;CPF;E-mail'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'fórmula neutralizada');
  assert.ok(csv.includes('529.982.247-25'));
  assert.ok(csv.includes('Pix'));
  assert.ok(csv.includes('1/2'), 'check-in');
});
