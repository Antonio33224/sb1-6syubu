/**
 * Rotas de venda de ingressos.
 *
 *   POST   /api/checkout/reserve      reserva (trava estoque por N minutos) — comprador logado
 *   POST   /api/checkout/pay          cria o pagamento no Mercado Pago (Payment Brick)
 *   GET    /api/orders/[id]           status do pedido (+ reconciliação com o MP)
 *   DELETE /api/orders/[id]           desiste da reserva
 *   POST   /api/webhooks/mercadopago  notificações (assinatura + idempotência)
 *   GET    /api/cron/expire-orders    expira reservas vencidas (Vercel Cron)
 *
 * Regras de segurança:
 *   - o valor cobrado vem do banco (orders.total), nunca do navegador;
 *   - ingresso só é emitido por public.apply_payment() com status "approved"
 *     confirmado pela API do MP (o corpo do webhook não é confiável);
 *   - apply_payment só roda com a service_role (servidor).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticate, json, serviceClient, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { log } from '../log-sanitize';
import { defaultMailer, type Mailer } from '../mailer';
import {
  createPayment,
  credentialError,
  getPayment,
  mpConfig,
  mpDate,
  MpError,
  refundPayment,
  toDbPayment,
  verifyWebhookSignature,
  type MpConfig,
  type MpPayment,
} from '../mercadopago';
import { sendTicketEmails } from './emails';
import { isFullName, isValidCpf, isValidPhone, onlyDigits } from '@/lib/cpf';

export interface TicketDeps {
  env: () => SupabaseEnv | null;
  mp: () => MpConfig | null;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
  service: (env: SupabaseEnv) => SupabaseClient | null;
  mailer: () => Mailer | null;
  fetch: typeof fetch;
  cronSecret: () => string | null;
}

export const defaultTicketDeps: TicketDeps = {
  env: () => supabaseEnv(),
  mp: () => mpConfig(),
  authenticate,
  service: serviceClient,
  mailer: defaultMailer,
  fetch: (...a) => fetch(...a),
  cronSecret: () => process.env.CRON_SECRET?.trim() || null,
};

const parseBody = async (req: Request) => req.json().catch(() => null);

/** Mensagens de `raise exception` das funções SQL de venda são seguras para o comprador. */
const SAFE_DB = /Entre na sua conta|Informe o nome|CPF inválido|E-mail inválido|Celular inválido|Escolha ao menos|Evento indisponível|vendas deste evento|já aconteceu|pagamentos em andamento|Quantidade inválida|Lote não encontrado|não está à venda|Máximo de|Restam apenas|Itens duplicados/i;
const dbFail = (where: string, e: { message: string }) => {
  const safe = SAFE_DB.test(e.message);
  if (!safe) log.error(`[tickets] ${where}`, e.message);
  return json(safe ? 409 : 503, { error: safe ? e.message.replace(/^.*?ERROR:\s*/i, '').slice(0, 200) : 'Falha ao acessar o banco.', code: safe ? 'rejected' : 'database' });
};

interface Ready {
  env: SupabaseEnv;
  mp: MpConfig;
  svc: SupabaseClient;
}

function readiness(deps: TicketDeps): { error: Response } | ({ error?: undefined } & Ready) {
  const env = deps.env();
  if (!env) return { error: json(503, { error: 'Venda de ingressos disponível apenas com o Supabase configurado.', code: 'not_configured' }) };
  const mp = deps.mp();
  if (!mp) return { error: json(503, { error: 'Pagamentos ainda não configurados (Mercado Pago).', code: 'payments_not_configured' }) };
  const credErr = credentialError(mp);
  if (credErr) {
    log.error('[tickets] configuração', credErr);
    return { error: json(503, { error: 'Pagamentos temporariamente indisponíveis.', code: 'payments_misconfigured' }) };
  }
  const svc = deps.service(env);
  if (!svc) return { error: json(503, { error: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.', code: 'not_configured' }) };
  return { env, mp, svc };
}

// ------------------------------------------------------------------ aplicação do pagamento

export type ApplyResult = 'issued' | 'already_paid' | 'pending' | 'rejected' | 'cancelled' | 'refunded' | 'needs_refund' | 'amount_mismatch' | 'order_not_found' | 'ignored' | 'unknown_status';

/** Aplica um pagamento confirmado pela API do MP e dispara os efeitos (e-mail / estorno). */
export async function applyMpPayment(deps: TicketDeps, r: Ready, payment: MpPayment): Promise<ApplyResult> {
  const orderId = payment.external_reference;
  if (!orderId || !z.string().uuid().safeParse(orderId).success) {
    log.warn('[tickets] pagamento sem external_reference válido', String(payment.id));
    return 'order_not_found';
  }
  const { data, error } = await r.svc.rpc('apply_payment', { p_order: orderId, p_payment: toDbPayment(payment) });
  if (error) throw new Error(`apply_payment: ${error.message}`);
  const result = ((data as { result?: string } | null)?.result ?? 'unknown_status') as ApplyResult;

  if (result === 'issued' || result === 'already_paid') {
    // Reenvia o que estiver pendente (idempotente pelo emailed_at).
    await sendTicketEmails(r.svc, deps.mailer(), orderId, r.env.siteUrl);
  }
  if (result === 'already_paid' && payment.status === 'approved') {
    // Pedido já pago por OUTRO pagamento (ex.: gerou Pix e depois pagou no cartão): estorna o excedente.
    const { data: o } = await r.svc.from('orders').select('mp_payment_id').eq('id', orderId).single();
    if (o?.mp_payment_id && o.mp_payment_id !== String(payment.id)) {
      try {
        await refundPayment(r.mp, String(payment.id), deps.fetch);
        log.warn('[tickets] pagamento duplicado estornado', orderId);
      } catch (err) {
        log.error('[tickets] falha ao estornar pagamento duplicado — tratar manualmente', orderId, err);
      }
    }
  }
  if (result === 'needs_refund') {
    // Pago depois que a reserva expirou e o estoque acabou: estorno automático.
    try {
      await refundPayment(r.mp, String(payment.id), deps.fetch);
      log.warn('[tickets] estorno automático (sem estoque)', orderId);
    } catch (err) {
      log.error('[tickets] falha no estorno automático — tratar manualmente', orderId, err);
    }
  }
  return result;
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
    return json(200, data as Record<string, unknown>);
  };
}

// ------------------------------------------------------------------ pagamento (Payment Brick)

const payInput = z.object({
  order_id: z.string().uuid(),
  formData: z
    .object({
      payment_method_id: z.string().min(2).max(40),
      token: z.string().max(200).optional(),
      issuer_id: z.union([z.string(), z.number()]).optional(),
      installments: z.number().int().min(1).max(24).optional(),
      payer: z
        .object({
          email: z.string().email().max(254).optional(),
          first_name: z.string().max(80).optional(),
          last_name: z.string().max(80).optional(),
          identification: z.object({ type: z.string().max(10).optional(), number: z.string().max(20).optional() }).optional(),
          address: z.record(z.unknown()).optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

const BOLETO_IDS = new Set(['bolbradesco', 'pec', 'boleto']);

export function createPayHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    if (r.error) return r.error;
    const auth = await deps.authenticate(req, r.env);
    if (!auth) return json(401, { error: 'Entre na sua conta para continuar.', code: 'unauthenticated' });
    const p = payInput.safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: 'Dados de pagamento inválidos.', code: 'invalid_input' });
    const { order_id, formData } = p.data;

    // RLS: o comprador só enxerga os próprios pedidos.
    const { data: order, error } = await auth.db
      .from('orders')
      .select('id, user_id, event_id, status, total, expires_at, buyer_name, buyer_cpf, buyer_email')
      .eq('id', order_id)
      .maybeSingle();
    if (error) return dbFail('pay.order', error);
    if (!order || order.user_id !== auth.userId) return json(404, { error: 'Pedido não encontrado.', code: 'not_found' });
    if (order.status === 'paid') return json(409, { error: 'Este pedido já está pago.', code: 'already_paid' });
    if (order.status !== 'pending' || new Date(order.expires_at).getTime() <= Date.now())
      return json(409, { error: 'Sua reserva expirou. Escolha os ingressos novamente.', code: 'expired' });

    const { data: ev } = await auth.db.from('public_events').select('name, name_hidden').eq('id', order.event_id).maybeSingle();
    const description = `Ingressos NO OFF — ${ev && !ev.name_hidden && ev.name ? String(ev.name).slice(0, 60) : 'evento'}`;

    const method = formData.payment_method_id;
    const isPix = method === 'pix';
    const isBoleto = BOLETO_IDS.has(method);
    const [first, ...rest] = String(order.buyer_name).trim().split(/\s+/);
    const docNumber = onlyDigits(formData.payer?.identification?.number ?? '');
    const body: Record<string, unknown> = {
      transaction_amount: Number(order.total), // valor do BANCO
      description,
      payment_method_id: method,
      external_reference: order.id,
      statement_descriptor: 'NOOFF',
      metadata: { order_id: order.id },
      payer: {
        email: formData.payer?.email || order.buyer_email,
        first_name: formData.payer?.first_name || first,
        last_name: formData.payer?.last_name || rest.join(' ') || first,
        identification: { type: 'CPF', number: isValidCpf(docNumber) ? docNumber : order.buyer_cpf },
        ...(formData.payer?.address ? { address: formData.payer.address } : {}),
      },
    };
    if (formData.token) body.token = formData.token;
    if (formData.installments) body.installments = formData.installments;
    if (formData.issuer_id !== undefined && formData.issuer_id !== '') body.issuer_id = Number(formData.issuer_id) || formData.issuer_id;
    if (isPix) body.date_of_expiration = mpDate(new Date(Date.now() + 30 * 60_000));
    if (isBoleto) body.date_of_expiration = mpDate(new Date(Date.now() + 3 * 24 * 3600_000));
    if (r.env.siteUrl.startsWith('https://')) body.notification_url = `${r.env.siteUrl}/api/webhooks/mercadopago`;

    // Mesma tentativa (mesmo token/método) → mesmo pagamento no MP (sem cobrança dupla).
    const idem = createHash('sha256').update(`${order.id}|${method}|${formData.token ?? ''}|${formData.installments ?? 1}`).digest('hex');

    let payment: MpPayment;
    try {
      payment = await createPayment(r.mp, body, idem, deps.fetch);
    } catch (err) {
      if (err instanceof MpError) {
        log.warn('[tickets] MP recusou a criação do pagamento', err.status, err.message, err.cause_codes.join(','));
        return json(402, { error: 'Não foi possível processar o pagamento. Confira os dados ou tente outro meio.', code: 'payment_failed' });
      }
      log.error('[tickets] MP indisponível', err);
      return json(502, { error: 'Mercado Pago indisponível no momento. Tente novamente.', code: 'gateway_unavailable' });
    }

    let result: ApplyResult;
    try {
      result = await applyMpPayment(deps, r, payment);
    } catch (err) {
      log.error('[tickets] apply após criar pagamento', err);
      result = 'pending'; // o webhook aplica depois
    }
    const { data: after } = await r.svc.from('orders').select('status').eq('id', order.id).single();
    const tx = payment.point_of_interaction?.transaction_data;
    return json(200, {
      status: payment.status,
      status_detail: payment.status_detail ?? null,
      payment_id: String(payment.id),
      order_status: after?.status ?? order.status,
      result,
      pix: isPix && tx?.qr_code ? { qr_code: tx.qr_code, qr_code_base64: tx.qr_code_base64 ?? '', expires_at: payment.date_of_expiration ?? null } : null,
      boleto_url: isBoleto ? payment.transaction_details?.external_resource_url ?? null : null,
    });
  };
}

// ------------------------------------------------------------------ status / cancelamento

export function createOrderHandlers(deps: TicketDeps = defaultTicketDeps) {
  async function load(req: Request, id: string) {
    const env = deps.env();
    if (!env) return { error: json(503, { error: 'Supabase não configurado.', code: 'not_configured' }) } as const;
    const auth = await deps.authenticate(req, env);
    if (!auth) return { error: json(401, { error: 'Entre na sua conta.', code: 'unauthenticated' }) } as const;
    if (!z.string().uuid().safeParse(id).success) return { error: json(404, { error: 'Pedido não encontrado.', code: 'not_found' }) } as const;
    return { env, auth } as const;
  }

  async function GET(req: Request, id: string) {
    const l = await load(req, id);
    if ('error' in l) return l.error;
    const sel = 'id, user_id, event_id, status, total, expires_at, payment_method, mp_payment_id, created_at';
    let { data: order } = await l.auth.db.from('orders').select(sel).eq('id', id).maybeSingle();
    if (!order || order.user_id !== l.auth.userId) return json(404, { error: 'Pedido não encontrado.', code: 'not_found' });

    // Reconciliação: se o pagamento está em andamento, consulta o MP (útil sem webhook, ex.: localhost).
    if (order.status === 'pending' && order.mp_payment_id) {
      const r = readiness(deps);
      if (!r.error) {
        try {
          const payment = await getPayment(r.mp, order.mp_payment_id, deps.fetch);
          await applyMpPayment(deps, r, payment);
          ({ data: order } = await l.auth.db.from('orders').select(sel).eq('id', id).maybeSingle());
        } catch (err) {
          log.warn('[tickets] reconciliação', err);
        }
      }
    }
    const { count } = await l.auth.db.from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', id);
    const { mp_payment_id: _m, user_id: _u, ...safe } = order!;
    return json(200, { order: safe, tickets: count ?? 0 });
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

export function createWebhookHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function POST(req: Request) {
    const r = readiness(deps);
    // Sem configuração: 503 faz o MP tentar de novo mais tarde.
    if (r.error) return r.error;
    if (!r.mp.webhookSecret) {
      log.error('[webhook] MP_WEBHOOK_SECRET ausente: notificação recusada');
      return json(503, { error: 'Webhook não configurado.' });
    }
    const url = new URL(req.url);
    const raw = await req.text();
    let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    const dataId = url.searchParams.get('data.id') ?? (body.data?.id !== undefined ? String(body.data.id) : null);
    const topic = url.searchParams.get('type') ?? body.type ?? url.searchParams.get('topic');
    const requestId = req.headers.get('x-request-id');

    const sig = verifyWebhookSignature({ signature: req.headers.get('x-signature'), requestId, dataId, secret: r.mp.webhookSecret });
    if (!sig.ok) {
      log.warn('[webhook] assinatura inválida', topic, dataId);
      return json(401, { error: 'Assinatura inválida.' });
    }
    if (topic !== 'payment' || !dataId || !/^[0-9]{1,30}$/.test(dataId)) return json(200, { ok: true, ignored: true });

    // Idempotência: a mesma notificação (x-request-id) é processada uma única vez.
    const eventKey = requestId ? `req:${requestId}` : `payment:${dataId}:${sig.ts}`;
    const { data: existing } = await r.svc.from('webhook_events').select('id, processed_at').eq('provider', 'mercadopago').eq('event_key', eventKey).maybeSingle();
    if (existing?.processed_at) return json(200, { ok: true, duplicate: true });
    let rowId = existing?.id as number | undefined;
    if (!rowId) {
      const { data: ins, error: insErr } = await r.svc
        .from('webhook_events')
        .insert({ provider: 'mercadopago', event_key: eventKey, topic, resource_id: dataId })
        .select('id')
        .single();
      if (insErr) {
        if (/duplicate/i.test(insErr.message)) return json(200, { ok: true, duplicate: true });
        log.error('[webhook] registro', insErr.message);
        return json(503, { error: 'Falha temporária.' });
      }
      rowId = ins.id as number;
    }

    try {
      // Nunca confia no corpo: busca o pagamento na API com o Access Token.
      const payment = await getPayment(r.mp, dataId, deps.fetch);
      const result = await applyMpPayment(deps, r, payment);
      await r.svc.from('webhook_events').update({ processed_at: new Date().toISOString(), result }).eq('id', rowId);
      return json(200, { ok: true, result });
    } catch (err) {
      log.error('[webhook] processamento', err);
      // 5xx: o MP reenvia e o registro sem processed_at permite reprocessar.
      return json(500, { error: 'Falha ao processar.' });
    }
  };
}

// ------------------------------------------------------------------ cron

export function createExpireOrdersHandler(deps: TicketDeps = defaultTicketDeps) {
  return async function GET(req: Request) {
    const secret = deps.cronSecret();
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { error: 'Não autorizado.' });
    const env = deps.env();
    const svc = env ? deps.service(env) : null;
    if (!svc) return json(503, { error: 'Supabase não configurado.' });
    const { data, error } = await svc.rpc('expire_orders');
    if (error) {
      log.error('[cron] expire_orders', error.message);
      return json(503, { error: 'Falha.' });
    }
    return json(200, { expired: data ?? 0 });
  };
}
