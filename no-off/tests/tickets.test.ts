/**
 * Venda de ingressos: CPF, assinatura do webhook, idempotência, valor vindo do
 * banco, reserva, estorno automático, campos ocultos e utilitários.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { formatCpf, isValidCpf, toE164 } from '../src/lib/cpf';
import { toDbPayment, verifyWebhookSignature, type MpConfig } from '../src/lib/server/mercadopago';
import {
  createExpireOrdersHandler,
  createPayHandler,
  createReserveHandler,
  createWebhookHandler,
  type TicketDeps,
} from '../src/lib/server/tickets/handlers';
import { HIDDEN_TEXT, mapPublicEvent, priceLabel } from '../src/lib/public-events';
import { parseVipCsv } from '../src/lib/vip-csv';
import { buildTables, toCsv } from '../src/lib/server/reports';
import type { EventReport } from '../src/types/tickets';
import { fakeSupabase } from './helpers/fake-supabase';

const ENV = { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: 'svc', siteUrl: 'https://nooff.test' };
const MP: MpConfig = { accessToken: 'TEST-123', publicKey: 'TEST-pk', webhookSecret: 'segredo-webhook', env: 'sandbox' };
const ORDER = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const BATCH = '55555555-5555-4555-8555-555555555555';

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

const sign = (dataId: string, requestId: string, ts: string, secret = MP.webhookSecret!) =>
  `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;

test('webhook: assinatura x-signature válida, adulterada, ausente ou com outro segredo', () => {
  const sig = sign('123456', 'req-1', '1700000000');
  assert.equal(verifyWebhookSignature({ signature: sig, requestId: 'req-1', dataId: '123456', secret: MP.webhookSecret! }).ok, true);
  assert.equal(verifyWebhookSignature({ signature: sig, requestId: 'req-1', dataId: '999999', secret: MP.webhookSecret! }).ok, false, 'outro pagamento');
  assert.equal(verifyWebhookSignature({ signature: sig, requestId: 'req-2', dataId: '123456', secret: MP.webhookSecret! }).ok, false, 'outro request-id');
  assert.equal(verifyWebhookSignature({ signature: null, requestId: 'req-1', dataId: '123456', secret: MP.webhookSecret! }).ok, false);
  assert.equal(verifyWebhookSignature({ signature: sign('123456', 'req-1', '1', 'outro'), requestId: 'req-1', dataId: '123456', secret: MP.webhookSecret! }).ok, false);
  assert.equal(verifyWebhookSignature({ signature: 'ts=1,v1=zz', requestId: 'req-1', dataId: '123456', secret: MP.webhookSecret! }).ok, false);
});

test('toDbPayment: soma taxas e usa o líquido informado pelo MP', () => {
  const p = toDbPayment({
    id: 99, status: 'approved', payment_type_id: 'credit_card', payment_method_id: 'visa', installments: 3, transaction_amount: 100,
    fee_details: [{ type: 'mercadopago_fee', amount: 4.99 }, { type: 'financing_fee', amount: 1.01 }],
    transaction_details: { net_received_amount: 94 },
  });
  assert.equal(p.id, '99');
  assert.equal(p.fee_amount, 6);
  assert.equal(p.net_amount, 94);
  assert.equal(p.installments, 3);
});

// ------------------------------------------------------------------ handlers

function deps(opts: { tables?: Record<string, Record<string, unknown>[]>; rpcs?: Parameters<typeof fakeSupabase>[1]; payment?: Record<string, unknown>; userId?: string | null } = {}) {
  const user = fakeSupabase(opts.tables ?? {}, opts.rpcs ?? {});
  const svc = fakeSupabase(opts.tables ?? {}, opts.rpcs ?? {});
  const fetchCalls: { url: string; init?: RequestInit }[] = [];
  const d: TicketDeps = {
    env: () => ENV,
    mp: () => MP,
    authenticate: async () => (opts.userId === null ? null : { db: user.db, userId: opts.userId ?? 'buyer-1' }),
    service: () => svc.db,
    mailer: () => null,
    cronSecret: () => 'cron-secret',
    fetch: (async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      const body = String(url).includes('/refunds') ? { id: 1 } : opts.payment ?? {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  };
  return { d, user, svc, fetchCalls };
}

const webhookReq = (dataId: string, requestId: string, signature?: string, body?: unknown) =>
  new Request(`https://nooff.test/api/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, ...(signature ? { 'x-signature': signature } : {}) },
    body: JSON.stringify(body ?? { type: 'payment', action: 'payment.updated', data: { id: dataId } }),
  });

test('webhook: assinatura inválida → 401 e nada é consultado', async () => {
  const { d, svc, fetchCalls } = deps();
  const res = await createWebhookHandler(d)(webhookReq('123', 'req-x', 'ts=1,v1=' + '0'.repeat(64)));
  assert.equal(res.status, 401);
  assert.equal(fetchCalls.length, 0, 'não consulta o MP');
  assert.equal(svc.rpcCalls.length, 0, 'não aplica pagamento');
});

test('webhook: busca o pagamento na API (não confia no corpo) e aplica uma única vez', async () => {
  const applied: Record<string, unknown>[] = [];
  const { d, svc, fetchCalls } = deps({
    tables: { webhook_events: [], orders: [{ id: ORDER, mp_payment_id: '777' }], tickets: [] },
    rpcs: { apply_payment: (a) => (applied.push(a), { data: { result: 'issued', tickets: 2 }, error: null }) },
    payment: { id: 777, status: 'approved', external_reference: ORDER, transaction_amount: 120, payment_type_id: 'bank_transfer' },
  });
  const h = createWebhookHandler(d);
  // O corpo diz "approved" de outro pedido — é ignorado; vale a consulta à API.
  const forged = { type: 'payment', data: { id: '777' }, status: 'approved', external_reference: 'outro' };
  const r1 = await h(webhookReq('777', 'req-1', sign('777', 'req-1', '1700000000'), forged));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).result, 'issued');
  assert.ok(fetchCalls[0]!.url.endsWith('/v1/payments/777'));
  assert.equal(String((fetchCalls[0]!.init!.headers as Record<string, string>).authorization), 'Bearer TEST-123');
  assert.equal(applied.length, 1);
  assert.equal(applied[0]!.p_order, ORDER);

  // Mesma notificação reenviada (mesmo x-request-id) → não processa de novo.
  const r2 = await h(webhookReq('777', 'req-1', sign('777', 'req-1', '1700000000')));
  assert.equal((await r2.json()).duplicate, true);
  assert.equal(applied.length, 1, 'idempotente');
  assert.equal(svc.rpcCalls.filter(([n]) => n === 'apply_payment').length, 1);
});

test('webhook: pago depois que a reserva expirou e o estoque acabou → estorno automático', async () => {
  const { d, fetchCalls } = deps({
    tables: { webhook_events: [], orders: [{ id: ORDER }] },
    rpcs: { apply_payment: () => ({ data: { result: 'needs_refund' }, error: null }) },
    payment: { id: 888, status: 'approved', external_reference: ORDER, transaction_amount: 50 },
  });
  const res = await createWebhookHandler(d)(webhookReq('888', 'req-9', sign('888', 'req-9', '1700000001')));
  assert.equal(res.status, 200);
  assert.ok(fetchCalls.some((c) => c.url.endsWith('/v1/payments/888/refunds')), 'chamou o estorno');
});

test('webhook: sem MP_WEBHOOK_SECRET recusa (503) e tópicos que não são pagamento são ignorados', async () => {
  const a = deps();
  const noSecret = createWebhookHandler({ ...a.d, mp: () => ({ ...MP, webhookSecret: null }) });
  assert.equal((await noSecret(webhookReq('1', 'r', sign('1', 'r', '1')))).status, 503);
  const b = deps();
  const req = new Request('https://nooff.test/api/webhooks/mercadopago?data.id=5&type=merchant_order', {
    method: 'POST', headers: { 'x-request-id': 'r5', 'x-signature': sign('5', 'r5', '2') }, body: '{}',
  });
  const res = await createWebhookHandler(b.d)(req);
  assert.equal((await res.json()).ignored, true);
  assert.equal(b.fetchCalls.length, 0);
});

const payReq = (body: unknown) => new Request('https://nooff.test/api/checkout/pay', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pendingOrder = (over: Record<string, unknown> = {}) => ({
  id: ORDER, user_id: 'buyer-1', event_id: EVENT, status: 'pending', total: 150, buyer_name: 'Ana Souza', buyer_cpf: '52998224725',
  buyer_email: 'ana@exemplo.com', expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), ...over,
});

test('pagamento: o valor cobrado é o total do BANCO, nunca o do navegador', async () => {
  const { d, fetchCalls } = deps({
    tables: { orders: [pendingOrder()], public_events: [{ id: EVENT, name: 'Festa X', name_hidden: false }], tickets: [] },
    rpcs: { apply_payment: () => ({ data: { result: 'pending' }, error: null }) },
    payment: { id: 1, status: 'pending', external_reference: ORDER, point_of_interaction: { transaction_data: { qr_code: 'PIX123', qr_code_base64: 'b64' } } },
  });
  const res = await createPayHandler(d)(payReq({ order_id: ORDER, formData: { payment_method_id: 'pix', transaction_amount: 0.01, payer: { email: 'ana@exemplo.com' } } }));
  assert.equal(res.status, 200);
  const body = JSON.parse(String(fetchCalls[0]!.init!.body));
  assert.equal(body.transaction_amount, 150, 'ignora o 0.01 enviado pelo navegador');
  assert.equal(body.external_reference, ORDER);
  assert.equal(body.payer.identification.number, '52998224725');
  assert.ok(body.date_of_expiration, 'Pix tem vencimento');
  assert.equal(body.notification_url, 'https://nooff.test/api/webhooks/mercadopago');
  assert.ok((fetchCalls[0]!.init!.headers as Record<string, string>)['x-idempotency-key'], 'idempotência no MP');
  assert.equal((await res.json()).pix.qr_code, 'PIX123');
});

test('pagamento: pedido de outra pessoa → 404; reserva expirada → 409; sem login → 401', async () => {
  const other = deps({ tables: { orders: [pendingOrder({ user_id: 'outra-pessoa' })] } });
  assert.equal((await createPayHandler(other.d)(payReq({ order_id: ORDER, formData: { payment_method_id: 'pix' } }))).status, 404);
  assert.equal(other.fetchCalls.length, 0);

  const expired = deps({ tables: { orders: [pendingOrder({ expires_at: new Date(Date.now() - 1000).toISOString() })] } });
  assert.equal((await createPayHandler(expired.d)(payReq({ order_id: ORDER, formData: { payment_method_id: 'pix' } }))).status, 409);
  assert.equal(expired.fetchCalls.length, 0, 'não cria pagamento');

  const anon = deps({ userId: null });
  assert.equal((await createPayHandler(anon.d)(payReq({ order_id: ORDER, formData: { payment_method_id: 'pix' } }))).status, 401);
});

const reserveReq = (body: unknown) => new Request('https://nooff.test/api/checkout/reserve', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const buyer = { name: 'Ana Souza', cpf: '529.982.247-25', email: 'ana@exemplo.com', phone: '(21) 99999-1234' };

test('reserva: valida os dados do comprador antes do banco e repassa a mensagem de estoque', async () => {
  const { d, user } = deps({ rpcs: { reserve_order: () => ({ data: null, error: { message: 'Restam apenas 2 ingressos do lote "1º lote".' } }) } });
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

test('reserva: erro interno do banco não vaza detalhes', async () => {
  const { d } = deps({ rpcs: { reserve_order: () => ({ data: null, error: { message: 'relation "orders" does not exist' } }) } });
  const res = await createReserveHandler(d)(reserveReq({ event_id: EVENT, items: [{ batch_id: BATCH, quantity: 1 }], buyer }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'Falha ao acessar o banco.');
});

test('pagamentos não configurados → 503 e produção com credencial de teste é bloqueada', async () => {
  const a = deps();
  assert.equal((await createReserveHandler({ ...a.d, mp: () => null })(reserveReq({}))).status, 503);
  const b = deps();
  const res = await createReserveHandler({ ...b.d, mp: () => ({ ...MP, env: 'production' }) })(reserveReq({}));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'payments_misconfigured');
});

test('cron: exige CRON_SECRET', async () => {
  const { d, svc } = deps({ rpcs: { expire_orders: () => ({ data: 3, error: null }) } });
  const h = createExpireOrdersHandler(d);
  assert.equal((await h(new Request('https://nooff.test/api/cron/expire-orders'))).status, 401);
  const ok = await h(new Request('https://nooff.test/api/cron/expire-orders', { headers: { authorization: 'Bearer cron-secret' } }));
  assert.equal((await ok.json()).expired, 3);
  assert.equal(svc.rpcCalls.length, 1);
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
    buyers: [{ order_id: ORDER, buyer_name: '=HYPERLINK("x")', buyer_cpf: '52998224725', buyer_email: 'a@b.com', buyer_phone: '21999991234', batch: '1º lote', ticket_type: 'pista', quantity: 2, unit_price: 50, amount: 100, created_at: '2029-12-01T12:00:00Z', paid_at: '2029-12-01T12:01:00Z', status: 'paid', payment_method: 'bank_transfer', installments: 1, checked_in: 1, tickets: 2 }],
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
