/**
 * Venda de ingressos com MisticPay (Pix): token do webhook, deduplicação,
 * reconfirmação por /transactions/check, valores em reais × centavos,
 * reutilização do Pix, retry em 429, reserva, cron, campos ocultos e utilitários.
 * Sem rede: fetch, sleep e Supabase são falsos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCpf, isValidCpf, toE164 } from '../src/lib/cpf';
import {
  backoffMs,
  basicAuth,
  checkTransaction,
  createPixCharge,
  credentialError,
  mapState,
  misticConfig,
  MisticError,
  normalizeAmountCents,
  orderIdFromTransactionId,
  ourTransactionId,
  qrImageSrc,
  verifyWebhookToken,
  type MisticConfig,
} from '../src/lib/server/misticpay';
import {
  createExpireOrdersHandler,
  createOrderHandlers,
  createPayHandler,
  createReserveHandler,
  createWebhookHandler,
  webhookUrl,
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
const TOKEN = 'token-secreto-do-webhook-0123456789';
const MISTIC: MisticConfig = { clientId: 'pk_test1234abcd', clientSecret: 'sk_test1234abcd', webhookToken: TOKEN, environment: 'live' };
const ORDER = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const BATCH = '55555555-5555-4555-8555-555555555555';
const TX = '31484480';

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

test('config: exige pk_/sk_, token longo; chaves nunca aparecem em mensagens nem logs', () => {
  assert.equal(misticConfig({}), null);
  assert.equal(misticConfig({ MISTICPAY_CLIENT_ID: 'pk_x' }), null, 'precisa do secret');
  const c = misticConfig({ MISTICPAY_CLIENT_ID: ' pk_abc123456 ', MISTICPAY_CLIENT_SECRET: 'sk_abc123456', MISTICPAY_WEBHOOK_TOKEN: TOKEN })!;
  assert.equal(c.clientId, 'pk_abc123456');
  assert.equal(c.environment, 'live');
  assert.equal(credentialError(MISTIC), null);
  assert.match(credentialError({ ...MISTIC, clientId: 'abc' })!, /pk_/);
  assert.match(credentialError({ ...MISTIC, clientSecret: 'pk_trocado123' })!, /sk_/);
  assert.match(credentialError({ ...MISTIC, webhookToken: 'curto' })!, /curto/);
  assert.equal(credentialError({ ...MISTIC, webhookToken: null }), null, 'sem token: funciona só por consulta');
  assert.ok(!credentialError({ ...MISTIC, clientId: 'xx_segredo' })!.includes('segredo'));
  assert.equal(redact('chave pk_live9876543210 e sk_abcdef12345'), 'chave [chave] e [chave]');
  assert.equal(redact(`POST /api/webhooks/misticpay?token=${TOKEN}&x=1`), 'POST /api/webhooks/misticpay?token=[redigido]&x=1');
  assert.equal(redact(`Authorization: ${basicAuth(MISTIC)}`), 'Authorization: Basic [redigido]');
});

test('valores: reais e centavos aceitos; divergência detectada', () => {
  assert.deepEqual(normalizeAmountCents(15000, 15000), { cents: 15000, matched: true }, 'centavos');
  assert.deepEqual(normalizeAmountCents(150, 15000), { cents: 15000, matched: true }, 'reais inteiros');
  assert.deepEqual(normalizeAmountCents(150.0, 15000), { cents: 15000, matched: true });
  assert.deepEqual(normalizeAmountCents(4.55, 455), { cents: 455, matched: true }, 'reais com centavos');
  assert.deepEqual(normalizeAmountCents(455, 455), { cents: 455, matched: true });
  assert.equal(normalizeAmountCents(1, 15000).matched, false);
  assert.equal(normalizeAmountCents(100, 15000).matched, false);
  assert.equal(normalizeAmountCents(null, 15000).cents, null);
});

test('utilitários: estados, ids, QR, token e backoff', () => {
  assert.equal(mapState('COMPLETO'), 'paid');
  assert.equal(mapState('pendente'), 'pending');
  assert.equal(mapState('FALHA'), 'failed');
  assert.equal(mapState('CANCELADO'), 'cancelled');
  assert.equal(mapState('DEVOLVIDO'), 'refunded');
  assert.equal(mapState('DEVOLVIDO_PARCIAL'), 'partially_refunded');
  assert.equal(mapState('???'), 'unknown');
  const id = ourTransactionId(ORDER, 1_700_000_000_000);
  assert.match(id, /^nooff-33333333-3333-4333-8333-333333333333-[0-9a-z]+$/);
  assert.equal(orderIdFromTransactionId(id), ORDER);
  assert.equal(orderIdFromTransactionId(TX), null);
  assert.equal(qrImageSrc({ qrCodeBase64: 'iVBORw0', qrcodeUrl: null }), 'data:image/png;base64,iVBORw0');
  assert.equal(qrImageSrc({ qrCodeBase64: null, qrcodeUrl: 'https://qr.test/x.png' }), 'https://qr.test/x.png');
  assert.equal(verifyWebhookToken(TOKEN, TOKEN), true);
  assert.equal(verifyWebhookToken(TOKEN + 'x', TOKEN), false);
  assert.equal(verifyWebhookToken('', TOKEN), false);
  assert.equal(verifyWebhookToken(TOKEN, null), false);
  assert.equal(webhookUrl('https://www.no-off.site/', TOKEN), `https://www.no-off.site/api/webhooks/misticpay?token=${TOKEN}`);
  assert.equal(webhookUrl('http://localhost:3000', TOKEN), undefined);
  assert.equal(webhookUrl('https://x.test', null), undefined);
  assert.ok(backoffMs(0, '1', () => 0) >= 1000, 'Retry-After');
  assert.ok(backoffMs(0, '999', () => 0) <= 10_250);
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

test('cliente: Basic auth, 429 com Retry-After e 5xx são repetidos', async () => {
  const { f, calls } = scriptedFetch([
    { status: 429, body: { code: 'RATE_LIMITED', message: 'slow' }, headers: { 'Retry-After': '1' } },
    { status: 502, body: { code: 'INTERNAL_ERROR' } },
    { status: 200, body: { transaction: { transactionId: TX, value: 150, fee: 2, transactionState: 'COMPLETO', transactionType: 'DEPOSITO' } } },
  ]);
  const sleeps: number[] = [];
  const t = await checkTransaction(MISTIC, TX, { fetch: f, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(t.state, 'COMPLETO');
  assert.equal(t.rawAmount, 150);
  assert.equal(calls.length, 3);
  assert.ok(sleeps[0]! >= 1000);
  assert.equal(calls[0]!.url, 'https://api.misticpay.com/api/transactions/check');
  const h = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(h.authorization, `Basic ${Buffer.from('pk_test1234abcd:sk_test1234abcd').toString('base64')}`);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { transactionId: TX });
});

test('cliente: 400/401/403/404 não são repetidos; 429 esgota as tentativas', async () => {
  for (const status of [400, 401, 403, 404]) {
    const { f, calls } = scriptedFetch([{ status, body: { code: 'X', message: 'nope' } }]);
    await assert.rejects(checkTransaction(MISTIC, TX, { fetch: f, sleep: async () => {} }), (e: unknown) => e instanceof MisticError && e.status === status);
    assert.equal(calls.length, 1, `status ${status} sem retry`);
  }
  const { f, calls } = scriptedFetch([{ status: 429, body: { code: 'RATE_LIMITED' } }]);
  await assert.rejects(checkTransaction(MISTIC, TX, { fetch: f, sleep: async () => {}, retries: 2 }), (e: unknown) => e instanceof MisticError && e.retryable);
  assert.equal(calls.length, 3);
});

test('cliente: criação envia REAIS, CPF só dígitos e lê a resposta em "data"', async () => {
  const { f, calls } = scriptedFetch([{ status: 201, body: { message: 'ok', data: { transactionId: TX, transactionAmount: 455, transactionState: 'PENDENTE', qrCodeBase64: 'iVBOR', qrcodeUrl: 'https://qr/x', copyPaste: '000201...' } } }]);
  await assert.rejects(createPixCharge(MISTIC, { valueCents: 99, payerName: 'A B', payerDocument: '52998224725', description: 'x', transactionId: 't' }), /mínimo/);
  await assert.rejects(createPixCharge(MISTIC, { valueCents: 455, payerName: 'A B', payerDocument: '123', description: 'x', transactionId: 't' }), /CPF/);
  const c = await createPixCharge(MISTIC, { valueCents: 455, payerName: 'Ana Souza', payerDocument: '529.982.247-25', description: 'd'.repeat(300), transactionId: 'nooff-x', projectWebhook: 'https://h' }, { fetch: f });
  const sent = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(calls[0]!.url, 'https://api.misticpay.com/api/transactions/create');
  assert.equal(sent.amount, 4.55);
  assert.equal(sent.payerDocument, '52998224725');
  assert.equal(sent.description.length, 140);
  assert.equal(sent.projectWebhook, 'https://h');
  assert.equal(c.transactionId, TX, 'usa o id devolvido pela MisticPay');
  assert.equal(c.copyPaste, '000201...');
  assert.equal(c.rawAmount, 455);
});

// ------------------------------------------------------------------ handlers

/** apply_payment falso que imita as regras da 0008 (valor em centavos, idempotência, cobrança atual). */
function fakeApply(tables: Record<string, Row[]>) {
  return (a: Record<string, unknown>) => {
    const p = a.p_payment as Row;
    const order = (tables.orders ?? []).find((o) => o.id === a.p_order);
    if (!order) return { data: { result: 'order_not_found' }, error: null };
    const status = p.status === 'paid' ? 'approved' : p.status === 'failed' ? 'rejected' : String(p.status);
    const payments = (tables.payments ??= []);
    let pay = payments.find((x) => x.provider === 'misticpay' && x.provider_payment_id === p.id);
    if (!pay) payments.push((pay = { order_id: order.id, provider: 'misticpay', provider_payment_id: p.id, created_at: new Date().toISOString() }));
    Object.assign(pay, { status, payment_method: p.method, amount_cents: p.amount_cents });
    for (const k of ['pix_brcode', 'pix_qr_image', 'provider_expires_at'] as const) if (p[k]) pay[k] = p[k];
    const mine = !order.provider_payment_id || order.provider_payment_id === p.id;
    if (status === 'approved') {
      if (order.status === 'paid') return { data: { result: 'already_paid' }, error: null };
      if (p.amount_cents !== Math.round(Number(order.total) * 100)) {
        pay.status = 'amount_mismatch';
        return { data: { result: 'amount_mismatch' }, error: null };
      }
      Object.assign(order, { status: 'paid', provider: 'misticpay', provider_payment_id: p.id });
      (tables.tickets ??= []).push({ id: 't1', order_id: order.id });
      return { data: { result: 'issued', tickets: 1 }, error: null };
    }
    if (status === 'pending') {
      if (p.register || !order.provider_payment_id) Object.assign(order, { provider: 'misticpay', provider_payment_id: p.id });
      return { data: { result: 'pending' }, error: null };
    }
    if (status === 'refunded' && mine) order.status = 'refunded';
    return { data: { result: status === 'refunded' ? 'refunded' : status === 'rejected' ? 'rejected' : 'cancelled' }, error: null };
  };
}

type Route = (url: string, body: Row | null) => { status?: number; body: unknown } | undefined;

function deps(opts: { tables?: Record<string, Row[]>; routes?: Route; userId?: string | null; mistic?: MisticConfig | null; mail?: boolean } = {}) {
  const tables = opts.tables ?? {};
  const audits: Record<string, unknown>[] = [];
  const rpcs = {
    apply_payment: fakeApply(tables),
    server_audit: (a: Record<string, unknown>) => (audits.push(a), { data: null, error: null }),
    expire_orders: () => ({ data: 2, error: null }),
  };
  const user = fakeSupabase(tables, rpcs);
  const svc = fakeSupabase(tables, rpcs);
  const fetchCalls: { url: string; body: Row | null }[] = [];
  const deferred: Promise<unknown>[] = [];
  const sent: MailMessage[] = [];
  const sleeps: number[] = [];
  const d: TicketDeps = {
    env: () => ENV,
    mistic: () => (opts.mistic === undefined ? MISTIC : opts.mistic),
    authenticate: async () => (opts.userId === null ? null : { db: user.db, userId: opts.userId ?? 'buyer-1' }),
    service: () => svc.db,
    mailer: () => (opts.mail ? { send: async (m: MailMessage) => void sent.push(m) } : null),
    sleep: async (ms) => void sleeps.push(ms),
    defer: (task) => void deferred.push(task()),
    cronSecret: () => 'cron-secret',
    fetch: (async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Row) : null;
      fetchCalls.push({ url: String(url), body });
      const r = opts.routes?.(String(url), body) ?? { status: 404, body: { code: 'TRANSACTION_NOT_FOUND' } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return { d, tables, user, svc, fetchCalls, audits, deferred, sent, sleeps, flush: () => Promise.all(deferred) };
}

/** Resposta do /transactions/check. */
const checkBody = (over: Row = {}) => ({ transaction: { transactionId: TX, value: 15000, fee: 23, transactionState: 'COMPLETO', transactionType: 'DEPOSITO', ...over } });
const checkRoute = (over: Row = {}): Route => (url) => (url.endsWith('/transactions/check') ? { body: checkBody(over) } : undefined);

const hookReq = (body: unknown, token: string | null = TOKEN) =>
  new Request(`https://nooff.test/api/webhooks/misticpay${token === null ? '' : `?token=${encodeURIComponent(token)}`}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const deposit = (over: Row = {}) => ({ transactionId: Number(TX), transactionType: 'DEPOSITO', transactionMethod: 'PIX', clientName: 'Ana', status: 'COMPLETO', value: 15000, fee: 23, e2e: 'E123', ...over });

const pendingOrder = (over: Row = {}): Row => ({
  id: ORDER, user_id: 'buyer-1', event_id: EVENT, status: 'pending', total: 150, buyer_name: 'Ana Souza', buyer_cpf: '52998224725',
  buyer_email: 'ana@exemplo.com', expires_at: new Date(Date.now() + 8 * 60_000).toISOString(), provider_payment_id: null, ...over,
});
const pendingPay = (over: Row = {}): Row => ({ order_id: ORDER, provider: 'misticpay', provider_payment_id: TX, status: 'pending', payment_method: 'pix', ...over });

test('webhook: token inválido ou ausente → 401 e nada é consultado/aplicado; sem token configurado → 503', async () => {
  for (const req of [hookReq(deposit(), 'errado'), hookReq(deposit(), null), hookReq(deposit(), TOKEN.slice(0, -1))]) {
    const { d, svc, fetchCalls } = deps({ tables: { orders: [pendingOrder()] } });
    const res = await createWebhookHandler(d)(req);
    assert.equal(res.status, 401);
    assert.equal(fetchCalls.length, 0, 'não consulta a API');
    assert.equal(svc.rpcCalls.length, 0, 'não aplica pagamento');
    assert.deepEqual(svc.writes(), [], 'nem registra o evento');
  }
  const a = deps({ mistic: { ...MISTIC, webhookToken: null } });
  assert.equal((await createWebhookHandler(a.d)(hookReq(deposit()))).status, 503);
});

test('webhook: confirma em /transactions/check (não confia no corpo), emite e deduplica', async () => {
  const { d, tables, svc, fetchCalls, flush } = deps({
    tables: { orders: [pendingOrder({ provider: 'misticpay', provider_payment_id: TX })], payments: [pendingPay()], misticpay_webhook_events: [] },
    routes: checkRoute(),
  });
  const h = createWebhookHandler(d);
  // O corpo diz um valor falso — vale a consulta à API.
  const r1 = await h(hookReq(deposit({ value: 1 })));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).result, 'issued');
  assert.equal(fetchCalls[0]!.url, 'https://api.misticpay.com/api/transactions/check');
  assert.deepEqual(fetchCalls[0]!.body, { transactionId: TX });
  const apply = svc.rpcCalls.find(([n]) => n === 'apply_payment')!;
  assert.equal(apply[1].p_order, ORDER);
  assert.equal((apply[1].p_payment as Row).amount_cents, 15000, 'valor da API, não do corpo');
  assert.equal((apply[1].p_payment as Row).provider, 'misticpay');
  assert.equal(tables.orders![0]!.status, 'paid');
  await flush();

  // Reentrega (mesma transação e estado) → não processa de novo.
  const r2 = await h(hookReq(deposit({ value: 1 })));
  assert.equal((await r2.json()).duplicate, true);
  assert.equal(svc.rpcCalls.filter(([n]) => n === 'apply_payment').length, 1, 'idempotente');
  assert.equal(fetchCalls.length, 1, 'sem nova consulta');
  assert.equal(tables.misticpay_webhook_events!.length, 1);
});

test('webhook: valor em REAIS (150.00) ou em CENTAVOS (15000) emite; o pedido vem do nosso transactionId se a cobrança não estiver registrada', async () => {
  for (const value of [150, 150.0, 15000]) {
    const { d, tables } = deps({ tables: { orders: [pendingOrder()], payments: [pendingPay()], misticpay_webhook_events: [] }, routes: checkRoute({ value }) });
    const res = await createWebhookHandler(d)(hookReq(deposit()));
    assert.equal((await res.json()).result, 'issued', `value=${value}`);
    assert.equal(tables.orders![0]!.status, 'paid');
  }
  const ours = ourTransactionId(ORDER);
  const { d, tables } = deps({ tables: { orders: [pendingOrder()], payments: [], misticpay_webhook_events: [] }, routes: checkRoute({ transactionId: ours }) });
  const res = await createWebhookHandler(d)(hookReq(deposit({ transactionId: ours })));
  assert.equal((await res.json()).result, 'issued');
  assert.equal(tables.orders![0]!.status, 'paid');
});

test('webhook: aviso COMPLETO mas consulta ainda PENDENTE → espera, reconfere e devolve 500 sem marcar como processado', async () => {
  let state = 'PENDENTE';
  const { d, tables, sleeps } = deps({
    tables: { orders: [pendingOrder({ provider_payment_id: TX })], payments: [pendingPay()], misticpay_webhook_events: [] },
    routes: (url) => (url.endsWith('/transactions/check') ? { body: checkBody({ transactionState: state }) } : undefined),
  });
  const h = createWebhookHandler(d);
  const r1 = await h(hookReq(deposit()));
  assert.equal(r1.status, 500);
  assert.ok(sleeps.includes(2000), 'esperou o cache do check');
  assert.equal(tables.misticpay_webhook_events![0]!.processed_at, undefined);
  state = 'COMPLETO';
  const r2 = await h(hookReq(deposit()));
  assert.equal((await r2.json()).result, 'issued');
});

test('webhook: valor confirmado diferente do pedido NÃO emite ingresso e alerta o admin', async () => {
  const { d, tables, sent, flush } = deps({
    mail: true,
    tables: { orders: [pendingOrder()], payments: [pendingPay()], misticpay_webhook_events: [], admin_settings: [{ id: 1, admin_alert_email: 'admin@nooff.test' }], tickets: [] },
    routes: checkRoute({ value: 100 }),
  });
  const res = await createWebhookHandler(d)(hookReq(deposit()));
  assert.equal((await res.json()).result, 'amount_mismatch');
  await flush();
  assert.equal(tables.orders![0]!.status, 'pending', 'pedido não foi pago');
  assert.equal(tables.tickets!.length, 0, 'nenhum ingresso');
  assert.equal(tables.payments![0]!.status, 'amount_mismatch');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, 'admin@nooff.test');
  assert.match(sent[0]!.text, /bruto da API: 100\)/);
});

test('webhook: DEVOLVIDO cancela os ingressos; reembolso RECUSADO vai ao audit log', async () => {
  const a = deps({ tables: { orders: [pendingOrder({ status: 'paid', provider_payment_id: TX })], payments: [pendingPay({ status: 'approved' })], misticpay_webhook_events: [] }, routes: checkRoute({ transactionState: 'DEVOLVIDO' }) });
  const r = await createWebhookHandler(a.d)(hookReq(deposit({ status: 'DEVOLVIDO', refund: { status: 'CONCLUIDO', refundId: 'r1', refundedValue: 150 } })));
  assert.equal((await r.json()).result, 'refunded');
  assert.equal(a.tables.orders![0]!.status, 'refunded');

  const b = deps({ tables: { orders: [pendingOrder({ status: 'paid', provider_payment_id: TX })], payments: [pendingPay({ status: 'approved' })], misticpay_webhook_events: [] }, routes: checkRoute() });
  const r2 = await createWebhookHandler(b.d)(hookReq(deposit({ status: 'COMPLETO', refund: { status: 'RECUSADO', refundId: 'r1' } })));
  assert.equal((await r2.json()).result, 'already_paid');
  assert.ok(b.audits.some((x) => x.p_action === 'payment.refund_refused'));
});

test('webhook: pago depois do estoque acabar → devolução manual (audit crítico + e-mail ao admin)', async () => {
  const tables: Record<string, Row[]> = { orders: [pendingOrder()], payments: [pendingPay()], misticpay_webhook_events: [], admin_settings: [{ id: 1, admin_alert_email: 'admin@nooff.test' }] };
  const { d, audits, sent, flush } = deps({ tables, mail: true, routes: checkRoute() });
  const noStock = fakeSupabase(tables, { apply_payment: () => ({ data: { result: 'needs_refund' }, error: null }), server_audit: (a) => (audits.push(a), { data: null, error: null }) });
  const res = await createWebhookHandler({ ...d, service: () => noStock.db })(hookReq(deposit()));
  assert.equal((await res.json()).result, 'needs_refund');
  await flush();
  const a = audits.find((x) => x.p_action === 'payment.refund_manual_required')!;
  assert.equal(a.p_severity, 'critical');
  assert.equal(a.p_target_id, ORDER);
  assert.match(sent[0]!.subject, /devolver um Pix/);
});

test('webhook: saque e transação desconhecida são ignorados; MED vai ao audit log', async () => {
  const a = deps({ tables: { misticpay_webhook_events: [] } });
  const r = await createWebhookHandler(a.d)(hookReq(deposit({ transactionType: 'SAQUE' })));
  assert.equal((await r.json()).result, 'ignored');
  assert.equal(a.fetchCalls.length, 0);

  const b = deps({ tables: { misticpay_webhook_events: [], payments: [] }, routes: checkRoute() });
  const r2 = await createWebhookHandler(b.d)(hookReq(deposit({ transactionId: 999 })));
  assert.equal((await r2.json()).result, 'order_not_found');

  const c = deps({ tables: { misticpay_webhook_events: [], payments: [pendingPay()] } });
  const r3 = await createWebhookHandler(c.d)(hookReq({ event: 'INFRACTION', transactionId: Number(TX) }));
  assert.equal((await r3.json()).result, 'dispute_logged');
  assert.equal(c.audits[0]!.p_action, 'payment.dispute');
  assert.equal(c.audits[0]!.p_target_id, ORDER);
});

// ------------------------------------------------------------------ pagamento

const payReq = (body: unknown) => new Request('https://nooff.test/api/checkout/pay', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const createRoute: Route = (url) =>
  url.endsWith('/transactions/create') ? { status: 201, body: { data: { transactionId: TX, transactionAmount: 15000, transactionState: 'PENDENTE', qrCodeBase64: 'iVBOR', qrcodeUrl: 'https://qr/x', copyPaste: '000201PIX' } } } : undefined;

test('pagamento: valor do BANCO em reais, CPF e nome do pedido, webhook com token; registra o id da MisticPay', async () => {
  const { d, fetchCalls, tables } = deps({ tables: { orders: [pendingOrder()], public_events: [{ id: EVENT, name: 'Festa X', name_hidden: false }], payments: [] }, routes: createRoute });
  const res = await createPayHandler(d)(payReq({ order_id: ORDER, method: 'pix', total: 0.01 }));
  assert.equal(res.status, 200);
  const body = fetchCalls[0]!.body!;
  assert.equal(body.amount, 150, 'ignora qualquer valor do navegador');
  assert.equal(body.payerDocument, '52998224725');
  assert.equal(body.payerName, 'Ana Souza');
  assert.match(String(body.description), /Festa X/);
  assert.equal(orderIdFromTransactionId(body.transactionId), ORDER);
  assert.equal(body.projectWebhook, `https://nooff.test/api/webhooks/misticpay?token=${TOKEN}`);
  const out = await res.json();
  assert.equal(out.pix.br_code, '000201PIX');
  assert.equal(out.pix.qr_image, 'data:image/png;base64,iVBOR');
  assert.equal(out.card_available, false);
  assert.equal(out.environment, 'live');
  assert.equal(out.reused, false);
  assert.equal(tables.orders![0]!.provider_payment_id, TX, 'id devolvido pela MisticPay');
  assert.equal(tables.payments![0]!.pix_brcode, '000201PIX');
});

test('pagamento: reutiliza o Pix pendente do pedido; quase vencido gera outro', async () => {
  const exp = new Date(Date.now() + 6 * 60_000).toISOString();
  const { d, fetchCalls } = deps({ tables: { orders: [pendingOrder({ provider_payment_id: TX })], payments: [pendingPay({ pix_brcode: 'BR-OLD', pix_qr_image: 'https://qr/old', provider_expires_at: exp })] } });
  const out = await (await createPayHandler(d)(payReq({ order_id: ORDER }))).json();
  assert.equal(out.reused, true);
  assert.equal(out.pix.br_code, 'BR-OLD');
  assert.equal(fetchCalls.length, 0, 'nenhuma cobrança nova');

  const near = deps({ tables: { orders: [pendingOrder()], public_events: [], payments: [pendingPay({ provider_payment_id: '1', pix_brcode: 'X', provider_expires_at: new Date(Date.now() + 10_000).toISOString() })] }, routes: createRoute });
  assert.equal((await (await createPayHandler(near.d)(payReq({ order_id: ORDER }))).json()).pix.br_code, '000201PIX');
});

test('pagamento: cartão → 400; pedido de outra pessoa → 404; reserva expirada → 409; sem login → 401; recusa → 402', async () => {
  const card = deps({ tables: { orders: [pendingOrder()] } });
  const rc = await createPayHandler(card.d)(payReq({ order_id: ORDER, method: 'card' }));
  assert.equal(rc.status, 400);
  assert.equal((await rc.json()).code, 'card_unavailable');
  assert.equal(card.fetchCalls.length, 0);

  const other = deps({ tables: { orders: [pendingOrder({ user_id: 'outra-pessoa' })] } });
  assert.equal((await createPayHandler(other.d)(payReq({ order_id: ORDER }))).status, 404);

  const expired = deps({ tables: { orders: [pendingOrder({ expires_at: new Date(Date.now() - 1000).toISOString() })] } });
  assert.equal((await createPayHandler(expired.d)(payReq({ order_id: ORDER }))).status, 409);
  assert.equal(expired.fetchCalls.length, 0, 'não cria cobrança');

  const anon = deps({ userId: null });
  assert.equal((await createPayHandler(anon.d)(payReq({ order_id: ORDER }))).status, 401);

  const refused = deps({ tables: { orders: [pendingOrder()], public_events: [], payments: [] }, routes: () => ({ status: 400, body: { code: 'VALIDATION_ERROR', message: 'payerDocument inválido' } }) });
  assert.equal((await createPayHandler(refused.d)(payReq({ order_id: ORDER }))).status, 402);
  assert.equal(refused.fetchCalls.length, 1, '400 não é repetido');

  const down = deps({ tables: { orders: [pendingOrder()], public_events: [], payments: [] }, routes: () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }) });
  assert.equal((await createPayHandler(down.d)(payReq({ order_id: ORDER }))).status, 502);
});

// ------------------------------------------------------------------ pedido / reserva / cron

test('GET do pedido: reconcilia em /transactions/check enquanto pendente e não expõe o id do provedor', async () => {
  const exp = new Date(Date.now() + 6 * 60_000).toISOString();
  const { d, fetchCalls } = deps({
    tables: { orders: [pendingOrder({ provider_payment_id: TX, created_at: '2030-01-01' })], payments: [pendingPay({ pix_brcode: 'BR', provider_expires_at: exp, checked_at: null })], tickets: [] },
    routes: checkRoute(),
  });
  const out = await (await createOrderHandlers(d).GET(new Request(`https://nooff.test/api/orders/${ORDER}`), ORDER)).json();
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

test('reserva: devolve os meios disponíveis (só Pix); erro interno do banco não vaza detalhes', async () => {
  const d0 = deps();
  const ok = fakeSupabase({}, { reserve_order: () => ({ data: { order_id: ORDER, total: 150, expires_at: 'x' }, error: null }) });
  const r1 = await createReserveHandler({ ...d0.d, authenticate: async () => ({ db: ok.db, userId: 'buyer-1' }) })(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 1 }], buyer }));
  assert.deepEqual((await r1.json()).payment, { environment: 'live', card_available: false });

  const bad = fakeSupabase({}, { reserve_order: () => ({ data: null, error: { message: 'relation "orders" does not exist' } }) });
  const res = await createReserveHandler({ ...d0.d, authenticate: async () => ({ db: bad.db, userId: 'buyer-1' }) })(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 1 }], buyer }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'Falha ao acessar o banco.');
});

test('pagamentos não configurados → 503; chave em formato errado → 503 sem vazar a chave', async () => {
  const a = deps({ mistic: null });
  const r = await createReserveHandler(a.d)(reserveReq({}));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'payments_not_configured');
  const b = deps({ mistic: { ...MISTIC, clientId: 'chave-colada-errada' } });
  const res = await createReserveHandler(b.d)(reserveReq({}));
  assert.equal(res.status, 503);
  const out = await res.json();
  assert.equal(out.code, 'payments_misconfigured');
  assert.ok(!JSON.stringify(out).includes('chave-colada-errada'));
  const c = deps({ userId: null });
  assert.equal((await createReserveHandler(c.d)(reserveReq({}))).status, 401, 'configuração válida passa');
});

test('cron: exige CRON_SECRET e confere na API antes de expirar', async () => {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  const { d, svc, fetchCalls, tables } = deps({
    tables: {
      orders: [pendingOrder({ provider: 'misticpay', provider_payment_id: TX, expires_at: past }), pendingOrder({ id: '66666666-6666-4666-8666-666666666666', expires_at: past })],
      payments: [pendingPay({ checked_at: new Date().toISOString() })],
    },
    routes: checkRoute(),
  });
  const h = createExpireOrdersHandler(d);
  assert.equal((await h(new Request('https://nooff.test/api/cron/expire-orders'))).status, 401);
  const out = await (await h(new Request('https://nooff.test/api/cron/expire-orders', { headers: { authorization: 'Bearer cron-secret' } }))).json();
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
