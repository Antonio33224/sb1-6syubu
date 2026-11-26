/**
 * Rotas de venda de ingressos (gateway MisticPay — somente Pix).
 *
 *   POST   /api/checkout/reserve      reserva (trava estoque por N minutos) — comprador logado
 *   POST   /api/checkout/pay          cria (ou reutiliza) a cobrança Pix
 *   GET    /api/orders/[id]           status do pedido (+ reconciliação na API da MisticPay)
 *   DELETE /api/orders/[id]           desiste da reserva
 *   POST   /api/webhooks/misticpay    notificações (token secreto na URL + deduplicação)
 *   GET    /api/cron/expire-orders    confere na API e expira reservas vencidas (Vercel Cron)
 *
 * Regras de segurança:
 *   - o valor cobrado vem do banco (orders.total), nunca do navegador;
 *   - o webhook da MisticPay NÃO é assinado: exigimos um token secreto na URL e,
 *     principalmente, só emitimos ingresso depois de CONFIRMAR o estado por
 *     POST /transactions/check (o corpo do webhook nunca basta);
 *   - apply_payment só roda com a service_role (servidor) e confere o valor.
 */
import { after } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate, json, serviceClient, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { log } from '../log-sanitize';
import { defaultMailer, escapeHtml, type Mailer } from '../mailer';
import {
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
  type CallOptions,
  type MisticConfig,
} from '../misticpay';
import { sendTicketEmails } from './emails';
import { isFullName, isValidCpf, isValidPhone, onlyDigits } from '@/lib/cpf';

export const PROVIDER = 'misticpay';

export interface TicketDeps {
  env: () => SupabaseEnv | null;
  mistic: () => MisticConfig | null;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
  service: (env: SupabaseEnv) => SupabaseClient | null;
  mailer: () => Mailer | null;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Trabalho depois da resposta (e-mails, alertas) — after() do Next. */
  defer: (task: () => Promise<unknown>) => void;
  cronSecret: () => string | null;
}

const runDeferred = (task: () => Promise<unknown>) => () =>
  task().catch((err) => {
    log.error('[tickets] tarefa em segundo plano', err);
  });

export const defaultTicketDeps: TicketDeps = {
  env: () => supabaseEnv(),
  mistic: () => misticConfig(),
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
  mistic: MisticConfig;
  svc: SupabaseClient;
}

function readiness(deps: TicketDeps): { error: Response } | ({ error?: undefined } & Ready) {
  const env = deps.env();
  if (!env) return { error: json(503, { error: 'Venda de ingressos disponível apenas com o Supabase configurado.', code: 'not_configured' }) };
  const mistic = deps.mistic();
  if (!mistic) return { error: json(503, { error: 'Pagamentos ainda não configurados (MisticPay).', code: 'payments_not_configured' }) };
  const credErr = credentialError(mistic);
  if (credErr) {
    log.error('[tickets] configuração', credErr);
    return { error: json(503, { error: 'Pagamentos temporariamente indisponíveis.', code: 'payments_misconfigured' }) };
  }
  const svc = deps.service(env);
  if (!svc) return { error: json(503, { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.', code: 'not_configured' }) };
  return { env, mistic, svc };
}

/** A MisticPay só tem Pix e não tem sandbox. */
const paymentOptions = () => ({ environment: 'live' as const, card_available: false });

/** Auditoria pelo servidor (falha ao auditar nunca derruba o fluxo de pagamento). */
async function serverAudit(r: Ready, action: string, orderId: string | null, metadata: Record<string, unknown>, severity: 'info' | 'warning' | 'critical' = 'info') {
  try {
    const { error } = await r.svc.rpc('server_audit', { p_action: action, p_target_type: 'order', p_target_id: orderId ?? '', p_metadata: { provider: PROVIDER, ...metadata }, p_severity: severity });
    if (error) log.warn('[tickets] auditoria', action, error.message);
  } catch (err) {
    log.warn('[tickets] auditoria', action, err);
  }
}

/** Alerta por e-mail ao admin (se houver SMTP e e-mail de alerta configurados). */
async function alertAdmin(deps: TicketDeps, r: Ready, subject: string, lines: string[]) {
  const mailer = deps.mailer();
  if (!mailer) return;
  const { data } = await r.svc.from('admin_settings').select('admin_alert_email').eq('id', 1).maybeSingle();
  const to = (data as { admin_alert_email?: string | null } | null)?.admin_alert_email;
  if (!to) return;
  const text = ['Alerta de pagamento — NO OFF', '', ...lines, '', `Confira no painel: ${r.env.siteUrl}/admin`].join('\n');
  await mailer.send({ to, subject: `[NO OFF] ${subject}`, text, html: `<pre style="font-family:Arial,sans-serif">${escapeHtml(text)}</pre>` });
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

export interface MisticApplyInput {
  /** transactionId da MisticPay. */
  id: string;
  /** Status interno (mapState): pending | paid | failed | cancelled | refunded | ... */
  status: string;
  amount_cents: number | null;
  /** Valor bruto devolvido pela API (auditoria da unidade ambígua). */
  raw_amount?: number | null;
  pix_brcode?: string | null;
  pix_qr_image?: string | null;
  provider_expires_at?: string | null;
  /** Cobrança recém-criada pelo /pay: passa a ser a cobrança atual do pedido. */
  register?: boolean;
}

/** Aplica um pagamento JÁ CONFIRMADO na API e dispara os efeitos (e-mail, alerta). */
export async function applyMisticPayment(deps: TicketDeps, r: Ready, orderId: string, p: MisticApplyInput): Promise<ApplyResult> {
  const payload = {
    provider: PROVIDER,
    id: p.id,
    status: p.status,
    amount_cents: p.amount_cents,
    method: 'pix',
    payment_type: 'pix',
    payment_method: 'pix',
    environment: 'live',
    live_mode: true,
    status_detail: p.raw_amount === undefined || p.raw_amount === null ? null : `raw_amount=${p.raw_amount}`,
    pix_brcode: p.pix_brcode ?? null,
    pix_qr_image: p.pix_qr_image ?? null,
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
    // Pedido já pago por OUTRO Pix (o comprador pagou dois QR codes): devolver o excedente.
    const { data: o } = await r.svc.from('orders').select('provider_payment_id').eq('id', orderId).maybeSingle();
    const current = (o as { provider_payment_id?: string | null } | null)?.provider_payment_id;
    if (current && current !== p.id) deps.defer(() => manualRefund(deps, r, orderId, p, 'duplicate'));
  }
  if (result === 'needs_refund') {
    // Pago depois que a reserva expirou e o estoque acabou.
    deps.defer(() => manualRefund(deps, r, orderId, p, 'no_stock'));
  }
  if (result === 'amount_mismatch') {
    log.error('[tickets] valor pago diferente do total do pedido — ingresso NÃO emitido', orderId, p.id);
    deps.defer(() =>
      alertAdmin(deps, r, 'Alerta: valor pago diferente do pedido', [
        'Um pagamento confirmado pela MisticPay tem valor diferente do total do pedido. Nenhum ingresso foi emitido.',
        `Pedido: ${orderId}`,
        `Transação MisticPay: ${p.id}`,
        `Valor recebido: ${p.amount_cents === null ? 'desconhecido' : `R$ ${(p.amount_cents / 100).toFixed(2)}`} (bruto da API: ${p.raw_amount ?? '—'})`,
      ]),
    );
  }
  return result;
}

/** A MisticPay não tem endpoint de reembolso: registra no audit log e avisa o admin para devolver pelo painel. */
async function manualRefund(deps: TicketDeps, r: Ready, orderId: string, p: MisticApplyInput, reason: 'duplicate' | 'no_stock') {
  log.error('[tickets] reembolso manual necessário — devolva pelo painel da MisticPay', orderId, reason);
  await serverAudit(r, 'payment.refund_manual_required', orderId, { transaction_id: p.id, reason, action: 'Devolver o Pix pelo painel da MisticPay' }, 'critical');
  await alertAdmin(deps, r, 'Ação necessária: devolver um Pix', [
    reason === 'no_stock'
      ? 'Um Pix foi pago depois que a reserva expirou e os ingressos esgotaram. Nenhum ingresso foi emitido.'
      : 'O comprador pagou dois Pix para o mesmo pedido. Um deles precisa ser devolvido.',
    `Pedido: ${orderId}`,
    `Transação MisticPay: ${p.id}`,
    'Devolva o valor pelo painel da MisticPay (a API não tem reembolso automático).',
  ]);
}

interface OrderLite {
  id: string;
  total: number | string;
}

/**
 * Confirma o estado por POST /transactions/check e aplica no banco. O pedido
 * vem da nossa tabela payments (cobrança criada por nós) ou do nosso
 * transactionId (nooff-<pedido>-<sufixo>), nunca do corpo do webhook.
 */
export async function confirmAndApply(
  deps: TicketDeps,
  r: Ready,
  transactionId: string,
  opts: { orderHint?: string | null; call?: CallOptions } = {},
): Promise<{ result: ApplyResult; orderId: string | null; state: string }> {
  const call: CallOptions = { fetch: deps.fetch, sleep: deps.sleep, ...opts.call };
  const t = await checkTransaction(r.mistic, transactionId, call);
  const status = mapState(t.state);

  const { data: row } = await r.svc.from('payments').select('order_id').eq('provider', PROVIDER).eq('provider_payment_id', transactionId).maybeSingle();
  const known = (row as { order_id?: string } | null)?.order_id ?? null;
  const orderId = known ?? orderIdFromTransactionId(transactionId) ?? opts.orderHint ?? null;
  if (!isUuid(orderId)) {
    log.warn('[tickets] transação sem pedido associado', transactionId);
    return { result: 'order_not_found', orderId: null, state: t.state };
  }
  if (t.type && t.type.toUpperCase() !== 'DEPOSITO') {
    log.warn('[tickets] transação que não é depósito ignorada', transactionId);
    return { result: 'ignored', orderId, state: t.state };
  }

  const { data: o } = await r.svc.from('orders').select('id, total').eq('id', orderId).maybeSingle();
  const order = o as OrderLite | null;
  if (!order) return { result: 'order_not_found', orderId: null, state: t.state };
  const expected = Math.round(Number(order.total) * 100);
  const { cents } = normalizeAmountCents(t.rawAmount, expected);

  if (status === 'partially_refunded') {
    await serverAudit(r, 'payment.partial_refund', orderId, { transaction_id: transactionId }, 'critical');
    deps.defer(() => alertAdmin(deps, r, 'Devolução parcial de Pix', [`Pedido: ${orderId}`, `Transação MisticPay: ${transactionId}`, 'Confira o pedido e os ingressos no painel.']));
    return { result: 'unknown_status', orderId, state: t.state };
  }
  if (status === 'unknown') {
    log.warn('[tickets] estado desconhecido da MisticPay', t.state);
    return { result: 'unknown_status', orderId, state: t.state };
  }

  const result = await applyMisticPayment(deps, r, orderId, { id: transactionId, status, amount_cents: cents, raw_amount: t.rawAmount });
  return { result, orderId, state: t.state };
}

/** Intervalo mínimo entre consultas para a mesma cobrança (o check fica alguns segundos em cache). */
const RECONCILE_EVERY_MS = 15_000;

interface PendingPaymentRow {
  provider_payment_id: string;
  checked_at: string | null;
  created_at?: string | null;
}

/** Confere na API as cobranças pendentes de um pedido (usado pelo GET do pedido e pelo cron). */
async function reconcileOrder(deps: TicketDeps, r: Ready, orderId: string, opts: { force?: boolean; call?: CallOptions } = {}) {
  const { data } = await r.svc.from('payments').select('provider_payment_id, checked_at, created_at').eq('order_id', orderId).eq('provider', PROVIDER).eq('status', 'pending');
  const rows = ((data ?? []) as PendingPaymentRow[]).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 3);
  for (const row of rows) {
    if (!opts.force && row.checked_at && Date.now() - new Date(row.checked_at).getTime() < RECONCILE_EVERY_MS) continue;
    try {
      await confirmAndApply(deps, r, row.provider_payment_id, { orderHint: orderId, call: opts.call });
    } catch (err) {
      log.warn('[tickets] reconciliação', err);
      await r.svc.from('payments').update({ checked_at: new Date().toISOString() }).eq('provider', PROVIDER).eq('provider_payment_id', row.provider_payment_id);
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
    return json(200, { ...(data as Record<string, unknown>), payment: paymentOptions() });
  };
}

// ------------------------------------------------------------------ pagamento (Pix)

const payInput = z.object({
  order_id: z.string().uuid(),
  method: z.enum(['pix', 'card']).default('pix'),
});

interface ReusableRow {
  provider_payment_id: string;
  status: string;
  pix_brcode: string | null;
  pix_qr_image: string | null;
  provider_expires_at: string | null;
  created_at?: string | null;
}

const pixView = (row: { pix_brcode: string | null; pix_qr_image: string | null; provider_expires_at: string | null }) =>
  row.pix_brcode ? { br_code: row.pix_brcode, qr_image: row.pix_qr_image ?? '', expires_at: row.provider_expires_at } : null;

/** Pix pendente ainda válido para o pedido (nunca criamos outro enquanto houver um). */
async function findReusable(r: Ready, orderId: string): Promise<ReusableRow | null> {
  const { data } = await r.svc
    .from('payments')
    .select('provider_payment_id, status, pix_brcode, pix_qr_image, provider_expires_at, created_at')
    .eq('order_id', orderId)
    .eq('provider', PROVIDER)
    .eq('status', 'pending');
  return (
    ((data ?? []) as ReusableRow[])
      .filter((row) => !!row.pix_brcode && row.provider_expires_at && new Date(row.provider_expires_at).getTime() - Date.now() > 45_000)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null
  );
}

/** URL do webhook com o token secreto (só com HTTPS e token configurado). */
export function webhookUrl(siteUrl: string, token: string | null): string | undefined {
  if (!token || !siteUrl.startsWith('https://')) return undefined;
  return `${siteUrl.replace(/\/+$/, '')}/api/webhooks/misticpay?token=${encodeURIComponent(token)}`;
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
    if (method === 'card') return json(400, { error: 'No momento aceitamos somente Pix.', code: 'card_unavailable' });

    // RLS: o comprador só enxerga os próprios pedidos.
    const { data: order, error } = await auth.db
      .from('orders')
      .select('id, user_id, event_id, status, total, expires_at, buyer_name, buyer_cpf')
      .eq('id', order_id)
      .maybeSingle();
    if (error) return dbFail('pay.order', error);
    if (!order || order.user_id !== auth.userId) return json(404, { error: 'Pedido não encontrado.', code: 'not_found' });
    if (order.status === 'paid') return json(409, { error: 'Este pedido já está pago.', code: 'already_paid' });
    const expiresAtMs = new Date(order.expires_at).getTime();
    if (order.status !== 'pending' || expiresAtMs <= Date.now() + 5_000)
      return json(409, { error: 'Sua reserva expirou. Escolha os ingressos novamente.', code: 'expired' });

    const respond = (row: { pix_brcode: string | null; pix_qr_image: string | null; provider_expires_at: string | null }, reused: boolean, orderStatus: string) =>
      json(200, { method: 'pix', reused, order_status: orderStatus, ...paymentOptions(), pix: pixView(row), checkout_url: null, expires_at: row.provider_expires_at });

    const existing = await findReusable(r, order.id);
    if (existing) return respond(existing, true, order.status);

    const valueCents = Math.round(Number(order.total) * 100); // valor do BANCO
    const { data: ev } = await auth.db.from('public_events').select('name, name_hidden').eq('id', order.event_id).maybeSingle();
    const description = `Ingressos NO OFF - ${ev && !ev.name_hidden && ev.name ? String(ev.name).slice(0, 80) : 'evento'}`;
    const projectWebhook = webhookUrl(r.env.siteUrl, r.mistic.webhookToken);
    if (!projectWebhook) log.warn('[tickets] sem webhook (MISTICPAY_WEBHOOK_TOKEN ausente ou site sem HTTPS): confirmação só por consulta');

    let applyInput: MisticApplyInput;
    try {
      const charge = await createPixCharge(
        r.mistic,
        { valueCents, payerName: String(order.buyer_name), payerDocument: String(order.buyer_cpf ?? ''), description, transactionId: ourTransactionId(order.id), projectWebhook },
        { fetch: deps.fetch, sleep: deps.sleep },
      );
      if (!charge.transactionId || !charge.copyPaste) {
        log.error('[tickets] resposta da MisticPay sem transactionId ou copia e cola');
        return json(502, { error: 'Pagamento indisponível no momento. Tente novamente em instantes.', code: 'gateway_unavailable' });
      }
      applyInput = {
        id: charge.transactionId,
        status: 'pending',
        amount_cents: normalizeAmountCents(charge.rawAmount, valueCents).cents ?? valueCents,
        raw_amount: charge.rawAmount,
        pix_brcode: charge.copyPaste,
        pix_qr_image: qrImageSrc(charge),
        // A MisticPay não documenta a validade do QR: vale o prazo da nossa reserva.
        provider_expires_at: new Date(expiresAtMs).toISOString(),
        register: true,
      };
    } catch (err) {
      if (err instanceof MisticError && !err.retryable) {
        log.warn('[tickets] MisticPay recusou a cobrança', err.status, err.code, err.message);
        return json(402, { error: 'Não foi possível gerar o Pix. Confira seus dados e tente novamente.', code: 'payment_failed' });
      }
      log.error('[tickets] MisticPay indisponível', err);
      return json(502, { error: 'Pagamento indisponível no momento. Tente novamente em instantes.', code: 'gateway_unavailable' });
    }

    // Registra a cobrança (payments + pedido). Se falhar, o webhook acha o pedido pelo nosso transactionId.
    try {
      await applyMisticPayment(deps, r, order.id, applyInput);
    } catch (err) {
      log.error('[tickets] registrar cobrança', err);
    }
    const { data: fresh } = await r.svc.from('orders').select('status').eq('id', order.id).maybeSingle();
    return respond(
      { pix_brcode: applyInput.pix_brcode ?? null, pix_qr_image: applyInput.pix_qr_image ?? null, provider_expires_at: applyInput.provider_expires_at ?? null },
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
      // Reconciliação: enquanto pendente, confere na API (útil se o webhook atrasar).
      if (order.status === 'pending' && order.provider_payment_id) {
        await reconcileOrder(deps, r, id, { call: { retries: 0, timeoutMs: 4_000 } });
        ({ data: order } = await l.auth.db.from('orders').select(sel).eq('id', id).maybeSingle());
      }
      let pix = null;
      if (order?.status === 'pending') {
        const row = await findReusable(r, id);
        pix = row ? pixView(row) : null;
      }
      payment = { ...paymentOptions(), pix };
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

/** Processamos com folga; se estourar, devolvemos 500 (a notificação pode ser reenviada). */
const WEBHOOK_DEADLINE_MS = 8_000;

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
  transactionId?: string | number;
  transactionType?: string;
  status?: string;
  event?: string;
  refund?: { status?: string; refundId?: string | number; refundedValue?: number; refundedAt?: string } | null;
  [k: string]: unknown;
}

/** Ainda pendente na consulta, embora o aviso diga que foi pago (cache de alguns segundos no check). */
export class StillPendingError extends Error {}

async function processWebhook(deps: TicketDeps, r: Ready, body: WebhookBody): Promise<string> {
  const id = String(body.transactionId ?? '').trim();
  const call: CallOptions = { retries: 1, timeoutMs: 3_000 };

  if (String(body.event ?? '').toUpperCase() === 'INFRACTION') {
    log.warn('[webhook] MED (infração) recebido', id);
    const { data: row } = await r.svc.from('payments').select('order_id').eq('provider', PROVIDER).eq('provider_payment_id', id).maybeSingle();
    await serverAudit(r, 'payment.dispute', (row as { order_id?: string } | null)?.order_id ?? null, { event: 'INFRACTION', transaction_id: id }, 'warning');
    return 'dispute_logged';
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return 'ignored';
  if (body.transactionType && String(body.transactionType).toUpperCase() !== 'DEPOSITO') return 'ignored'; // saques não são nossos

  if (body.refund && String(body.refund.status ?? '').toUpperCase() === 'RECUSADO') {
    const { data: row } = await r.svc.from('payments').select('order_id').eq('provider', PROVIDER).eq('provider_payment_id', id).maybeSingle();
    await serverAudit(r, 'payment.refund_refused', (row as { order_id?: string } | null)?.order_id ?? null, { transaction_id: id, refund_id: body.refund.refundId ?? null }, 'warning');
  }

  let out = await confirmAndApply(deps, r, id, { call });
  // O aviso diz COMPLETO mas a consulta ainda diz PENDENTE (cache): espera e confere de novo uma vez.
  if (out.result === 'pending' && String(body.status ?? '').toUpperCase() === 'COMPLETO') {
    await deps.sleep(2_000);
    out = await confirmAndApply(deps, r, id, { call });
    if (out.result === 'pending') throw new StillPendingError('pagamento ainda pendente na consulta');
  }
  return out.result;
}

export function createWebhookHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    if (r.error) return r.error;
    if (!r.mistic.webhookToken) {
      log.error('[webhook] MISTICPAY_WEBHOOK_TOKEN ausente: notificação recusada');
      return json(503, { error: 'Webhook não configurado.' });
    }
    // A MisticPay não assina o webhook: o token secreto vai na URL que nós registramos.
    const given = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-webhook-token');
    if (!verifyWebhookToken(given, r.mistic.webhookToken)) {
      log.warn('[webhook] token inválido');
      return json(401, { error: 'Não autorizado.' });
    }
    let body: WebhookBody;
    try {
      body = (await req.json()) as WebhookBody;
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'JSON inválido.' });

    const id = String(body.transactionId ?? '').slice(0, 80);
    const status = String(body.status ?? '').slice(0, 40);
    const refund = body.refund ? `${body.refund.status ?? ''}:${body.refund.refundId ?? ''}` : '';
    const dedupKey = `${String(body.event ?? 'DEPOSITO').slice(0, 20)}:${id}:${status}:${refund}`.slice(0, 200);

    // Deduplicação: a mesma notificação (transação + estado) é processada uma única vez.
    const { data: existing } = await r.svc.from('misticpay_webhook_events').select('id, processed_at').eq('dedup_key', dedupKey).maybeSingle();
    const ex = existing as { id: number; processed_at: string | null } | null;
    if (ex?.processed_at) return json(200, { ok: true, duplicate: true });
    let rowId = ex?.id;
    if (!rowId) {
      const { data: ins, error: insErr } = await r.svc.from('misticpay_webhook_events').insert({ dedup_key: dedupKey, transaction_id: id, status }).select('id').single();
      if (insErr) {
        if (/duplicate|unique/i.test(insErr.message)) return json(200, { ok: true, duplicate: true });
        log.error('[webhook] registro', insErr.message);
        return json(503, { error: 'Falha temporária.' });
      }
      rowId = (ins as { id: number }).id;
    }

    try {
      const result = await withDeadline(processWebhook(deps, r, body), WEBHOOK_DEADLINE_MS);
      await r.svc.from('misticpay_webhook_events').update({ processed_at: new Date().toISOString(), result }).eq('id', rowId);
      return json(200, { ok: true, result });
    } catch (err) {
      if (err instanceof StillPendingError) log.warn('[webhook] ainda pendente na consulta; a página do pedido e o cron reconferem');
      else log.error('[webhook] processamento', err);
      // 5xx: o registro fica sem processed_at e pode ser reprocessado num reenvio.
      return json(500, { error: 'Falha ao processar.' });
    }
  };
}

// ------------------------------------------------------------------ cron

/** Máximo de pedidos conferidos na API por execução. */
const CRON_MAX_CHECKS = 60;

export function createExpireOrdersHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function GET(req: Request) {
    const secret = deps.cronSecret();
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { error: 'Não autorizado.' });
    const env = deps.env();
    const svc = env ? deps.service(env) : null;
    if (!svc) return json(503, { error: 'Supabase não configurado.' });

    // Antes de expirar, confere na API se algum Pix foi pago sem o webhook chegar.
    let checked = 0;
    const r = readiness(deps);
    if (!r.error) {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data: due } = await svc.from('orders').select('id, provider, provider_payment_id').eq('status', 'pending').lte('expires_at', cutoff).limit(200);
      for (const o of (due ?? []) as { id: string; provider: string | null; provider_payment_id: string | null }[]) {
        if (o.provider !== PROVIDER || !o.provider_payment_id) continue;
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
