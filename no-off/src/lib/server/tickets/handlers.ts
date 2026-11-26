/**
 * Rotas de venda de ingressos (gateway PurinCash).
 *
 *   POST   /api/checkout/reserve      reserva (trava estoque por N minutos) — comprador logado
 *   POST   /api/checkout/pay          cria (ou reutiliza) a cobrança Pix — padrão — ou o checkout de cartão
 *   GET    /api/orders/[id]           status do pedido (+ reconciliação na API do PurinCash)
 *   DELETE /api/orders/[id]           desiste da reserva
 *   POST   /api/webhooks/purincash    notificações (assinatura no corpo cru + deduplicação por X-Webhook-Id)
 *   GET    /api/cron/expire-orders    confere na API e expira reservas vencidas (Vercel Cron)
 *
 * Regras de segurança:
 *   - o valor cobrado vem do banco (orders.total), nunca do navegador;
 *   - ingresso só é emitido por public.apply_payment() depois de CONFIRMAR o
 *     status por GET na API do PurinCash (o corpo do webhook não basta);
 *   - apply_payment só roda com a service_role (servidor) e confere amountCents.
 */
import { after } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate, json, serviceClient, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { log } from '../log-sanitize';
import { defaultMailer, escapeHtml, type Mailer } from '../mailer';
import {
  cardAmountCents,
  createCardPayment,
  createPixCharge,
  createRefund,
  credentialError,
  getCardPayment,
  getCharge,
  isProductionDeploy,
  metadataOrderId,
  purinConfig,
  PurinError,
  verifyWebhookSignature,
  type CallOptions,
  type PurinConfig,
} from '../purincash';
import { sendTicketEmails } from './emails';
import { isFullName, isValidCpf, isValidPhone, onlyDigits } from '@/lib/cpf';

export interface TicketDeps {
  env: () => SupabaseEnv | null;
  purin: () => PurinConfig | null;
  /** Deploy de produção (recusa chave ps_test_). */
  production: () => boolean;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
  service: (env: SupabaseEnv) => SupabaseClient | null;
  mailer: () => Mailer | null;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Trabalho depois da resposta (e-mails, estornos) — after() do Next. */
  defer: (task: () => Promise<unknown>) => void;
  cronSecret: () => string | null;
}

const runDeferred = (task: () => Promise<unknown>) => () =>
  task().catch((err) => {
    log.error('[tickets] tarefa em segundo plano', err);
  });

export const defaultTicketDeps: TicketDeps = {
  env: () => supabaseEnv(),
  purin: () => purinConfig(),
  production: () => isProductionDeploy(),
  authenticate,
  service: serviceClient,
  mailer: defaultMailer,
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  defer: (task) => {
    try {
      after(runDeferred(task));
    } catch {
      void runDeferred(task)();
    }
  },
  cronSecret: () => process.env.CRON_SECRET?.trim() || null,
};

const parseBody = async (req: Request) => req.json().catch(() => null);
const isUuid = (s: unknown): s is string => typeof s === 'string' && z.string().uuid().safeParse(s).success;

/** Mensagens de `raise exception` das funções SQL de venda são seguras para o comprador. */
const SAFE_DB = /Entre na sua conta|Informe o nome|CPF inválido|E-mail inválido|Celular inválido|Escolha ao menos|Evento indisponível|vendas deste evento|já aconteceu|pagamentos em andamento|Quantidade inválida|Lote não encontrado|não está à venda|Máximo de|Restam apenas|Itens duplicados/i;
const dbFail = (where: string, e: { message: string }) => {
  const safe = SAFE_DB.test(e.message);
  if (!safe) log.error(`[tickets] ${where}`, e.message);
  return json(safe ? 409 : 503, { error: safe ? e.message.replace(/^.*?ERROR:\s*/i, '').slice(0, 200) : 'Falha ao acessar o banco.', code: safe ? 'rejected' : 'database' });
};

export interface Ready {
  env: SupabaseEnv;
  purin: PurinConfig;
  svc: SupabaseClient;
}

function readiness(deps: TicketDeps): { error: Response } | ({ error?: undefined } & Ready) {
  const env = deps.env();
  if (!env) return { error: json(503, { error: 'Venda de ingressos disponível apenas com o Supabase configurado.', code: 'not_configured' }) };
  const purin = deps.purin();
  if (!purin) return { error: json(503, { error: 'Pagamentos ainda não configurados (PurinCash).', code: 'payments_not_configured' }) };
  const credErr = credentialError(purin, deps.production());
  if (credErr) {
    log.error('[tickets] configuração', credErr);
    return { error: json(503, { error: 'Pagamentos temporariamente indisponíveis.', code: 'payments_misconfigured' }) };
  }
  const svc = deps.service(env);
  if (!svc) return { error: json(503, { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.', code: 'not_configured' }) };
  return { env, purin, svc };
}

const paymentOptions = (purin: PurinConfig) => ({ environment: purin.environment, card_available: purin.environment === 'live' });

/** Auditoria pelo servidor (falha ao auditar nunca derruba o fluxo de pagamento). */
async function serverAudit(r: Ready, action: string, orderId: string | null, metadata: Record<string, unknown>, severity: 'info' | 'warning' | 'critical' = 'info') {
  try {
    const { error } = await r.svc.rpc('server_audit', { p_action: action, p_target_type: 'order', p_target_id: orderId ?? '', p_metadata: metadata, p_severity: severity });
    if (error) log.warn('[tickets] auditoria', action, error.message);
  } catch (err) {
    log.warn('[tickets] auditoria', action, err);
  }
}

// ------------------------------------------------------------------ aplicação do pagamento

export type ApplyResult =
  | 'issued'
  | 'already_paid'
  | 'pending'
  | 'rejected'
  | 'cancelled'
  | 'refunded'
  | 'needs_refund'
  | 'amount_mismatch'
  | 'order_not_found'
  | 'ignored'
  | 'unknown_status';

export type PayMethod = 'pix' | 'card';

export interface PurinApplyInput {
  id: string;
  method: PayMethod;
  /** Status do PurinCash: pending | paid | expired | refunded | failed */
  status: string;
  amount_cents: number | null;
  paid_at?: string | null;
  pix_brcode?: string | null;
  pix_qr_image?: string | null;
  checkout_url?: string | null;
  provider_expires_at?: string | null;
  /** Cobrança recém-criada pelo /pay: passa a ser a cobrança atual do pedido. */
  register?: boolean;
}

/** Aplica um pagamento JÁ CONFIRMADO na API e dispara os efeitos (e-mail, estorno, alerta). */
export async function applyPurinPayment(deps: TicketDeps, r: Ready, orderId: string, p: PurinApplyInput): Promise<ApplyResult> {
  const payload = {
    provider: 'purincash',
    id: p.id,
    status: p.status,
    amount_cents: p.amount_cents,
    method: p.method,
    payment_type: p.method === 'pix' ? 'pix' : 'credit_card',
    payment_method: p.method,
    environment: r.purin.environment,
    live_mode: r.purin.environment === 'live',
    paid_at: p.paid_at ?? null,
    pix_brcode: p.pix_brcode ?? null,
    pix_qr_image: p.pix_qr_image ?? null,
    checkout_url: p.checkout_url ?? null,
    provider_expires_at: p.provider_expires_at ?? null,
    date_of_expiration: p.provider_expires_at ?? null,
    register: p.register ?? false,
  };
  const { data, error } = await r.svc.rpc('apply_payment', { p_order: orderId, p_payment: payload });
  if (error) throw new Error(`apply_payment: ${error.message}`);
  const result = ((data as { result?: string } | null)?.result ?? 'unknown_status') as ApplyResult;

  if (result === 'issued' || result === 'already_paid') {
    // Reenvia o que estiver pendente (idempotente pelo emailed_at), depois da resposta.
    deps.defer(() => sendTicketEmails(r.svc, deps.mailer(), orderId, r.env.siteUrl));
  }
  if (result === 'already_paid' && p.status === 'paid') {
    // Pedido já pago por OUTRA cobrança (ex.: pagou o Pix e também o cartão): devolve o excedente.
    const { data: o } = await r.svc.from('orders').select('provider_payment_id').eq('id', orderId).maybeSingle();
    const current = (o as { provider_payment_id?: string | null } | null)?.provider_payment_id;
    if (current && current !== p.id) deps.defer(() => refundOrFlag(deps, r, orderId, p, 'duplicate'));
  }
  if (result === 'needs_refund') {
    // Pago depois que a reserva expirou e o estoque acabou.
    deps.defer(() => refundOrFlag(deps, r, orderId, p, 'no_stock'));
  }
  if (result === 'amount_mismatch') {
    log.error('[tickets] valor pago diferente do total do pedido — ingresso NÃO emitido', orderId, p.id);
    deps.defer(() => alertAdmin(deps, r, orderId, p));
  }
  return result;
}

/** Pix: reembolso integral pela API. Cartão: reembolso não documentado → ação manual registrada no audit log. */
async function refundOrFlag(deps: TicketDeps, r: Ready, orderId: string, p: PurinApplyInput, reason: 'duplicate' | 'no_stock') {
  if (p.method === 'card') {
    log.error('[tickets] reembolso de cartão é manual — estorne no painel do PurinCash', orderId);
    await serverAudit(r, 'payment.refund_manual_required', orderId, { provider: 'purincash', order_code: p.id, reason, action: 'Estornar manualmente no painel do PurinCash' }, 'critical');
    return;
  }
  // idempotencyKey = id do pedido (um reembolso por venda); para um Pix duplicado, pedido + cobrança.
  const idempotencyKey = reason === 'no_stock' ? orderId : `${orderId}:${p.id}`;
  try {
    const refund = await createRefund(r.purin, { paymentId: p.id, idempotencyKey, reason: reason === 'no_stock' ? 'Ingressos esgotados' : 'Pagamento em duplicidade' }, { fetch: deps.fetch, sleep: deps.sleep });
    log.warn('[tickets] reembolso solicitado', orderId, reason);
    await serverAudit(r, 'payment.refund_requested', orderId, { provider: 'purincash', payment_id: p.id, reason, status: refund.status ?? null }, 'warning');
  } catch (err) {
    log.error('[tickets] falha ao solicitar reembolso — tratar manualmente', orderId, err);
    await serverAudit(r, 'payment.refund_request_failed', orderId, { provider: 'purincash', payment_id: p.id, reason, error: err instanceof Error ? err.message : 'erro' }, 'critical');
  }
}

async function alertAdmin(deps: TicketDeps, r: Ready, orderId: string, p: PurinApplyInput) {
  const mailer = deps.mailer();
  if (!mailer) return;
  const { data } = await r.svc.from('admin_settings').select('admin_alert_email').eq('id', 1).maybeSingle();
  const to = (data as { admin_alert_email?: string | null } | null)?.admin_alert_email;
  if (!to) return;
  const text = [
    'Alerta de pagamento — NO OFF',
    '',
    'Um pagamento confirmado pelo PurinCash tem valor diferente do total do pedido. Nenhum ingresso foi emitido.',
    `Pedido: ${orderId}`,
    `Cobrança: ${p.id} (${p.method === 'pix' ? 'Pix' : 'cartão'})`,
    `Valor recebido: ${p.amount_cents === null ? 'desconhecido' : `R$ ${(p.amount_cents / 100).toFixed(2)}`}`,
    '',
    `Confira no painel: ${r.env.siteUrl}/admin`,
  ].join('\n');
  await mailer.send({ to, subject: '[NO OFF] Alerta: valor pago diferente do pedido', text, html: `<pre style="font-family:Arial,sans-serif">${escapeHtml(text)}</pre>` });
}

/**
 * Confirma o status por GET na API (charge → /charges, card → /card-payments)
 * e aplica no banco. O pedido vem da nossa tabela payments (cobrança criada por
 * nós) ou, se ainda não registrada, do metadata.orderId.
 */
export async function confirmAndApply(
  deps: TicketDeps,
  r: Ready,
  kind: PayMethod,
  providerId: string,
  opts: { orderHint?: string | null; call?: CallOptions } = {},
): Promise<{ result: ApplyResult; orderId: string | null }> {
  const call: CallOptions = { fetch: deps.fetch, sleep: deps.sleep, ...opts.call };
  let status: string;
  let cents: number | null;
  let metaOrder: string | null;
  let paidAt: string | null;
  if (kind === 'pix') {
    const c = await getCharge(r.purin, providerId, call);
    status = String(c.status ?? '');
    cents = typeof c.amountCents === 'number' ? Math.round(c.amountCents) : null;
    metaOrder = metadataOrderId(c.metadata);
    paidAt = c.paidAt ?? null;
  } else {
    const c = await getCardPayment(r.purin, providerId, call);
    status = String(c.status ?? '');
    cents = cardAmountCents(c);
    metaOrder = metadataOrderId(c.metadata);
    paidAt = c.paidAt ?? null;
  }

  const { data: row } = await r.svc.from('payments').select('order_id').eq('provider', 'purincash').eq('provider_payment_id', providerId).maybeSingle();
  const known = (row as { order_id?: string } | null)?.order_id ?? null;
  if (known && metaOrder && known !== metaOrder) {
    log.error('[tickets] metadata.orderId diverge do pedido da cobrança', providerId);
    await serverAudit(r, 'payment.order_mismatch', known, { provider: 'purincash', payment_id: providerId }, 'critical');
    return { result: 'order_not_found', orderId: null };
  }
  const orderId = known ?? metaOrder ?? opts.orderHint ?? null;
  if (!isUuid(orderId)) {
    log.warn('[tickets] cobrança sem pedido associado', providerId);
    return { result: 'order_not_found', orderId: null };
  }
  const result = await applyPurinPayment(deps, r, orderId, { id: providerId, method: kind, status, amount_cents: cents, paid_at: paidAt });
  return { result, orderId };
}

/** Intervalo mínimo entre consultas à API para a mesma cobrança (limite de 120 req/min da conta). */
const RECONCILE_EVERY_MS = 20_000;

interface PendingPaymentRow {
  provider_payment_id: string;
  payment_method: string | null;
  checked_at: string | null;
  created_at?: string | null;
}

/** Confere na API as cobranças pendentes de um pedido (usado pelo GET do pedido e pelo cron). */
async function reconcileOrder(deps: TicketDeps, r: Ready, orderId: string, opts: { force?: boolean; call?: CallOptions } = {}) {
  const { data } = await r.svc
    .from('payments')
    .select('provider_payment_id, payment_method, checked_at, created_at')
    .eq('order_id', orderId)
    .eq('provider', 'purincash')
    .eq('status', 'pending');
  const rows = ((data ?? []) as PendingPaymentRow[]).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 3);
  for (const row of rows) {
    if (!opts.force && row.checked_at && Date.now() - new Date(row.checked_at).getTime() < RECONCILE_EVERY_MS) continue;
    try {
      await confirmAndApply(deps, r, row.payment_method === 'card' ? 'card' : 'pix', row.provider_payment_id, { orderHint: orderId, call: opts.call });
    } catch (err) {
      log.warn('[tickets] reconciliação', err);
      await r.svc.from('payments').update({ checked_at: new Date().toISOString() }).eq('provider', 'purincash').eq('provider_payment_id', row.provider_payment_id);
    }
  }
}

// ------------------------------------------------------------------ reserva

const reserveInput = z.object({
  event_id: z.string().uuid(),
  items: z
    .array(z.object({ batch_id: z.string().uuid(), quantity: z.number().int().min(1).max(10) }))
    .min(1)
    .max(10),
  buyer: z.object({
    name: z.string().trim().max(120).refine(isFullName, 'Informe o nome completo.'),
    cpf: z.string().transform(onlyDigits).refine(isValidCpf, 'CPF inválido.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254),
    phone: z.string().transform(onlyDigits).refine(isValidPhone, 'Celular inválido.'),
  }),
});

export function createReserveHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    if (r.error) return r.error;
    const auth = await deps.authenticate(req, r.env);
    if (!auth) return json(401, { error: 'Entre na sua conta para comprar.', code: 'unauthenticated' });
    const p = reserveInput.safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: p.error.issues[0]?.message ?? 'Dados inválidos.', code: 'invalid_input' });
    const { data, error } = await auth.db.rpc('reserve_order', { p_event: p.data.event_id, p_items: p.data.items, p_buyer: p.data.buyer });
    if (error) return dbFail('reserve', error);
    return json(200, { ...(data as Record<string, unknown>), payment: paymentOptions(r.purin) });
  };
}

// ------------------------------------------------------------------ pagamento (Pix padrão / cartão)

const payInput = z.object({
  order_id: z.string().uuid(),
  method: z.enum(['pix', 'card']).default('pix'),
});

interface ReusableRow {
  provider_payment_id: string;
  payment_method: string | null;
  status: string;
  pix_brcode: string | null;
  pix_qr_image: string | null;
  checkout_url: string | null;
  provider_expires_at: string | null;
  created_at?: string | null;
}

const pixView = (row: { pix_brcode: string | null; pix_qr_image: string | null; provider_expires_at: string | null }) =>
  row.pix_brcode ? { br_code: row.pix_brcode, qr_image: row.pix_qr_image ?? '', expires_at: row.provider_expires_at } : null;

/** Cobrança pendente ainda válida (sem idempotência na API: nunca criamos outra para o mesmo pedido e método). */
async function findReusable(r: Ready, orderId: string, method: PayMethod): Promise<ReusableRow | null> {
  const { data } = await r.svc
    .from('payments')
    .select('provider_payment_id, payment_method, status, pix_brcode, pix_qr_image, checkout_url, provider_expires_at, created_at')
    .eq('order_id', orderId)
    .eq('provider', 'purincash')
    .eq('payment_method', method)
    .eq('status', 'pending');
  const minLeft = method === 'pix' ? 45_000 : 120_000;
  return (
    ((data ?? []) as ReusableRow[])
      .filter((row) => row.provider_expires_at && new Date(row.provider_expires_at).getTime() - Date.now() > minLeft)
      .filter((row) => (method === 'pix' ? !!row.pix_brcode : !!row.checkout_url))
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null
  );
}

export function createPayHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    if (r.error) return r.error;
    const auth = await deps.authenticate(req, r.env);
    if (!auth) return json(401, { error: 'Entre na sua conta para continuar.', code: 'unauthenticated' });
    const p = payInput.safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: 'Dados de pagamento inválidos.', code: 'invalid_input' });
    const { order_id, method } = p.data;

    // RLS: o comprador só enxerga os próprios pedidos.
    const { data: order, error } = await auth.db
      .from('orders')
      .select('id, user_id, event_id, status, total, expires_at, buyer_name, buyer_email')
      .eq('id', order_id)
      .maybeSingle();
    if (error) return dbFail('pay.order', error);
    if (!order || order.user_id !== auth.userId) return json(404, { error: 'Pedido não encontrado.', code: 'not_found' });
    if (order.status === 'paid') return json(409, { error: 'Este pedido já está pago.', code: 'already_paid' });
    const expiresAtMs = new Date(order.expires_at).getTime();
    if (order.status !== 'pending' || expiresAtMs <= Date.now() + 5_000)
      return json(409, { error: 'Sua reserva expirou. Escolha os ingressos novamente.', code: 'expired' });
    if (method === 'card' && r.purin.environment !== 'live')
      return json(400, { error: 'Pagamento com cartão indisponível no ambiente de teste.', code: 'card_unavailable' });

    const respond = (row: { pix_brcode: string | null; pix_qr_image: string | null; checkout_url: string | null; provider_expires_at: string | null }, reused: boolean, orderStatus: string) =>
      json(200, {
        method,
        reused,
        order_status: orderStatus,
        ...paymentOptions(r.purin),
        pix: method === 'pix' ? pixView(row) : null,
        checkout_url: method === 'card' ? row.checkout_url : null,
        expires_at: row.provider_expires_at,
      });

    const existing = await findReusable(r, order.id, method);
    if (existing) return respond(existing, true, order.status);

    const valueCents = Math.round(Number(order.total) * 100); // valor do BANCO
    const { data: ev } = await auth.db.from('public_events').select('name, name_hidden').eq('id', order.event_id).maybeSingle();
    const description = `Ingressos NO OFF — ${ev && !ev.name_hidden && ev.name ? String(ev.name).slice(0, 80) : 'evento'}`;
    const https = r.env.siteUrl.startsWith('https://');
    const callbackUrl = https ? `${r.env.siteUrl}/api/webhooks/purincash` : undefined;
    const customer = { name: String(order.buyer_name).slice(0, 120), email: String(order.buyer_email), externalId: auth.userId };
    const metadata = JSON.stringify({ orderId: order.id });
    const call: CallOptions = { fetch: deps.fetch, sleep: deps.sleep };

    let applyInput: PurinApplyInput;
    try {
      if (method === 'pix') {
        const charge = await createPixCharge(
          r.purin,
          { valueCents, description, expiresIn: Math.floor((expiresAtMs - Date.now()) / 1000), callbackUrl, customer, metadata },
          call,
        );
        applyInput = {
          id: charge.paymentId,
          method,
          status: charge.status ?? 'pending',
          amount_cents: typeof charge.amountCents === 'number' ? charge.amountCents : valueCents,
          pix_brcode: charge.pix?.brCode ?? null,
          pix_qr_image: charge.pix?.qrCodeImage ?? null,
          provider_expires_at: charge.expiresAt ?? new Date(expiresAtMs).toISOString(),
          register: true,
        };
      } else {
        const back = `${r.env.siteUrl}/pedido/${order.id}`;
        const card = await createCardPayment(r.purin, { valueCents, description, callbackUrl, customer, successUrl: back, cancelUrl: `${back}?cartao=cancelado`, metadata }, call);
        applyInput = {
          id: card.orderCode,
          method,
          status: card.status ?? 'pending',
          amount_cents: cardAmountCents(card) ?? valueCents,
          checkout_url: card.checkoutUrl ?? null,
          provider_expires_at: card.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
          register: true,
        };
      }
    } catch (err) {
      if (err instanceof PurinError && !err.retryable) {
        log.warn('[tickets] PurinCash recusou a cobrança', err.status, err.message);
        return json(402, { error: 'Não foi possível gerar o pagamento. Tente novamente ou use outro meio.', code: 'payment_failed' });
      }
      log.error('[tickets] PurinCash indisponível', err);
      return json(502, { error: 'Pagamento indisponível no momento. Tente novamente em instantes.', code: 'gateway_unavailable' });
    }
    if (!applyInput.id) {
      log.error('[tickets] resposta do PurinCash sem identificador');
      return json(502, { error: 'Pagamento indisponível no momento. Tente novamente em instantes.', code: 'gateway_unavailable' });
    }

    // Registra a cobrança (payments + pedido). Se falhar, o webhook encontra o pedido pelo metadata.
    try {
      await applyPurinPayment(deps, r, order.id, applyInput);
    } catch (err) {
      log.error('[tickets] registrar cobrança', err);
    }
    const { data: fresh } = await r.svc.from('orders').select('status').eq('id', order.id).maybeSingle();
    return respond(
      { pix_brcode: applyInput.pix_brcode ?? null, pix_qr_image: applyInput.pix_qr_image ?? null, checkout_url: applyInput.checkout_url ?? null, provider_expires_at: applyInput.provider_expires_at ?? null },
      false,
      (fresh as { status?: string } | null)?.status ?? order.status,
    );
  };
}

// ------------------------------------------------------------------ status / cancelamento

export function createOrderHandlers(deps: TicketDeps = defaultTicketDeps) {
  async function load(req: Request, id: string): Promise<{ error: Response } | { env: SupabaseEnv; auth: AuthContext }> {
    const env = deps.env();
    if (!env) return { error: json(503, { error: 'Supabase não configurado.', code: 'not_configured' }) };
    const auth = await deps.authenticate(req, env);
    if (!auth) return { error: json(401, { error: 'Entre na sua conta.', code: 'unauthenticated' }) };
    if (!isUuid(id)) return { error: json(404, { error: 'Pedido não encontrado.', code: 'not_found' }) };
    return { env, auth };
  }

  async function GET(req: Request, id: string): Promise<Response> {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    const sel = 'id, user_id, event_id, status, total, expires_at, payment_method, provider_payment_id, created_at';
    let { data: order } = await l.auth.db.from('orders').select(sel).eq('id', id).maybeSingle();
    if (!order || order.user_id !== l.auth.userId) return json(404, { error: 'Pedido não encontrado.', code: 'not_found' });

    let payment: Record<string, unknown> | null = null;
    const r = readiness(deps);
    if (!r.error) {
      // Reconciliação: enquanto pendente, confere na API (útil se o webhook atrasar ou sem HTTPS, ex.: localhost).
      if (order.status === 'pending' && order.provider_payment_id) {
        await reconcileOrder(deps, r, id, { call: { retries: 0, timeoutMs: 4_000 } });
        ({ data: order } = await l.auth.db.from('orders').select(sel).eq('id', id).maybeSingle());
      }
      let pix = null;
      if (order?.status === 'pending') {
        const row = await findReusable(r, id, 'pix');
        pix = row ? pixView(row) : null;
      }
      payment = { ...paymentOptions(r.purin), pix };
    }
    const { count } = await l.auth.db.from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', id);
    const { provider_payment_id: _p, user_id: _u, ...safe } = order!;
    return json(200, { order: safe, tickets: count ?? 0, payment });
  }

  async function DELETE(req: Request, id: string) {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    const { error } = await l.auth.db.rpc('cancel_my_order', { p_order: id });
    if (error) return dbFail('cancel', error);
    return json(200, { ok: true });
  }

  return { GET, DELETE };
}

// ------------------------------------------------------------------ webhook

/** O PurinCash espera resposta em até 5 s: processamos com folga e, se estourar, devolvemos 500 (ele reenvia). */
const WEBHOOK_DEADLINE_MS = 4_000;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('webhook: tempo de processamento esgotado')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

interface WebhookBody {
  event?: string;
  paymentId?: string;
  orderCode?: string;
  refundId?: string;
  metadata?: unknown;
  amount?: number | string;
  amountCents?: number;
  [k: string]: unknown;
}

async function processWebhook(deps: TicketDeps, r: Ready, body: WebhookBody): Promise<string> {
  const event = String(body.event ?? '');
  const call: CallOptions = { retries: 1, timeoutMs: 2_500 };
  const hint = metadataOrderId(body.metadata);

  // Em sandbox o simulate-paid sempre manda "payment.paid", mesmo para psc_: tratamos igual a charge.paid.
  if (event === 'charge.paid' || event === 'payment.paid') {
    const id = String(body.paymentId ?? '');
    if (!/^psc_[A-Za-z0-9_-]+$/.test(id)) return 'ignored';
    return (await confirmAndApply(deps, r, 'pix', id, { orderHint: hint, call })).result;
  }
  if (event === 'card_payment.paid') {
    const code = String(body.orderCode ?? '');
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) return 'ignored';
    return (await confirmAndApply(deps, r, 'card', code, { orderHint: hint, call })).result;
  }
  if (event === 'refund.completed') {
    const id = String(body.paymentId ?? '');
    if (!/^psc_[A-Za-z0-9_-]+$/.test(id)) return 'ignored';
    return (await confirmAndApply(deps, r, 'pix', id, { orderHint: hint, call })).result;
  }
  if (event === 'refund.failed') {
    const id = String(body.paymentId ?? '');
    const { data: row } = await r.svc.from('payments').select('order_id').eq('provider', 'purincash').eq('provider_payment_id', id).maybeSingle();
    const orderId = (row as { order_id?: string } | null)?.order_id ?? hint;
    log.error('[webhook] reembolso falhou no PurinCash — tratar manualmente', orderId ?? id);
    await serverAudit(r, 'payment.refund_failed', orderId, { provider: 'purincash', payment_id: id, refund_id: body.refundId ?? null, failure: body.failureCode ?? null }, 'critical');
    return 'refund_failed';
  }
  if (event.startsWith('dispute.')) {
    const id = String(body.paymentId ?? body.orderCode ?? '');
    log.warn('[webhook] disputa', event, id);
    await serverAudit(r, 'payment.dispute', hint, { provider: 'purincash', event, payment_id: id }, 'warning');
    return 'dispute_logged';
  }
  return 'ignored';
}

export function createWebhookHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    // Sem configuração: 503 faz o PurinCash tentar de novo mais tarde.
    if (r.error) return r.error;
    if (!r.purin.webhookSecret) {
      log.error('[webhook] PURINCASH_WEBHOOK_SECRET ausente: notificação recusada');
      return json(503, { error: 'Webhook não configurado.' });
    }
    // Corpo CRU antes de qualquer JSON.parse: a assinatura é sobre os bytes exatos.
    const raw = await req.text();
    if (!verifyWebhookSignature(raw, req.headers.get('x-webhook-signature'), r.purin.webhookSecret)) {
      log.warn('[webhook] assinatura inválida');
      return json(401, { error: 'Assinatura inválida.' });
    }
    let body: WebhookBody;
    try {
      body = raw ? (JSON.parse(raw) as WebhookBody) : {};
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'JSON inválido.' });

    const event = String(body.event ?? '').slice(0, 80);
    const resource = String(body.paymentId ?? body.orderCode ?? body.refundId ?? '').slice(0, 120);
    const webhookId = (req.headers.get('x-webhook-id')?.trim() || `${event}:${resource}`).slice(0, 200);

    // Deduplicação: o mesmo X-Webhook-Id é processado uma única vez.
    const { data: existing } = await r.svc.from('purincash_webhook_events').select('id, processed_at').eq('webhook_id', webhookId).maybeSingle();
    const ex = existing as { id: number; processed_at: string | null } | null;
    if (ex?.processed_at) return json(200, { ok: true, duplicate: true });
    let rowId = ex?.id;
    if (!rowId) {
      const { data: ins, error: insErr } = await r.svc
        .from('purincash_webhook_events')
        .insert({ webhook_id: webhookId, event, resource_id: resource })
        .select('id')
        .single();
      if (insErr) {
        if (/duplicate|unique/i.test(insErr.message)) return json(200, { ok: true, duplicate: true });
        log.error('[webhook] registro', insErr.message);
        return json(503, { error: 'Falha temporária.' });
      }
      rowId = (ins as { id: number }).id;
    }

    try {
      const result = await withDeadline(processWebhook(deps, r, body), WEBHOOK_DEADLINE_MS);
      await r.svc.from('purincash_webhook_events').update({ processed_at: new Date().toISOString(), result }).eq('id', rowId);
      return json(200, { ok: true, result });
    } catch (err) {
      log.error('[webhook] processamento', err);
      // 5xx: o PurinCash reenvia (mesmo X-Webhook-Id) e o registro sem processed_at permite reprocessar.
      return json(500, { error: 'Falha ao processar.' });
    }
  };
}

// ------------------------------------------------------------------ cron

/** Máximo de pedidos conferidos na API por execução (limite de 120 req/min). */
const CRON_MAX_CHECKS = 40;

export function createExpireOrdersHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function GET(req: Request) {
    const secret = deps.cronSecret();
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { error: 'Não autorizado.' });
    const env = deps.env();
    const svc = env ? deps.service(env) : null;
    if (!svc) return json(503, { error: 'Supabase não configurado.' });

    // Antes de expirar, confere na API se alguma cobrança foi paga sem o webhook chegar.
    let checked = 0;
    const r = readiness(deps);
    if (!r.error) {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data: due } = await svc.from('orders').select('id, provider, provider_payment_id').eq('status', 'pending').lte('expires_at', cutoff).limit(200);
      for (const o of ((due ?? []) as { id: string; provider: string | null; provider_payment_id: string | null }[])) {
        if (o.provider !== 'purincash' || !o.provider_payment_id) continue;
        if (checked >= CRON_MAX_CHECKS) break;
        checked++;
        try {
          await reconcileOrder(deps, r, o.id, { force: true, call: { retries: 2, timeoutMs: 8_000 } });
        } catch (err) {
          log.warn('[cron] reconciliação', err);
        }
      }
    }

    const { data, error } = await svc.rpc('expire_orders');
    if (error) {
      log.error('[cron] expire_orders', error.message);
      return json(503, { error: 'Falha.' });
    }
    return json(200, { expired: data ?? 0, checked });
  };
}
