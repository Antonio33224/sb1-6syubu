/**
 * Mercado Pago — integração REST no servidor (sem SDK). SOMENTE NO SERVIDOR.
 *
 * Variáveis:
 *   MP_ACCESS_TOKEN             Access Token (TEST-... no sandbox, APP_USR-... em produção)
 *   NEXT_PUBLIC_MP_PUBLIC_KEY   Public Key usada pelo Payment Brick no navegador
 *   MP_WEBHOOK_SECRET           "Assinatura secreta" do webhook (Suas integrações → Webhooks)
 *   NEXT_PUBLIC_MP_ENV          sandbox | production (padrão: sandbox; exibe o aviso de teste no checkout)
 *
 * O Access Token nunca vai ao navegador; o valor cobrado é SEMPRE o total do
 * pedido no banco (o valor enviado pelo navegador é ignorado).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MP_API = 'https://api.mercadopago.com';

export interface MpConfig {
  accessToken: string;
  publicKey: string | null;
  webhookSecret: string | null;
  env: 'sandbox' | 'production';
}

export function mpConfig(env: NodeJS.ProcessEnv = process.env): MpConfig | null {
  const accessToken = env.MP_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;
  return {
    accessToken,
    publicKey: env.NEXT_PUBLIC_MP_PUBLIC_KEY?.trim() || null,
    webhookSecret: env.MP_WEBHOOK_SECRET?.trim() || null,
    env: (env.NEXT_PUBLIC_MP_ENV ?? env.MP_ENV) === 'production' ? 'production' : 'sandbox',
  };
}

/** Produção com credencial de teste é configuração errada: bloqueia para não "vender" sem cobrar. */
export function credentialError(cfg: MpConfig): string | null {
  if (cfg.env === 'production' && cfg.accessToken.startsWith('TEST-')) return 'MP_ENV=production, mas o Access Token é de teste (TEST-).';
  return null;
}

export class MpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cause_codes: string[] = [],
  ) {
    super(message);
  }
}

type FetchLike = typeof fetch;

async function mpFetch<T>(cfg: MpConfig, path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}, f: FetchLike = fetch): Promise<T> {
  const res = await f(`${MP_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${cfg.accessToken}`,
      'content-type': 'application/json',
      ...(init.idempotencyKey ? { 'x-idempotency-key': init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const causes = Array.isArray(json.cause) ? (json.cause as { code?: string | number }[]).map((c) => String(c.code ?? '')) : [];
    throw new MpError(String(json.message ?? `Mercado Pago ${res.status}`), res.status, causes);
  }
  return json as T;
}

/** Pagamento como devolvido pela API (somente os campos usados). */
export interface MpPayment {
  id: number | string;
  status: string;
  status_detail?: string | null;
  payment_type_id?: string | null;
  payment_method_id?: string | null;
  installments?: number | null;
  transaction_amount?: number | null;
  external_reference?: string | null;
  date_of_expiration?: string | null;
  live_mode?: boolean;
  fee_details?: { type?: string; amount?: number }[];
  transaction_details?: { net_received_amount?: number; external_resource_url?: string | null } | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } } | null;
}

export const getPayment = (cfg: MpConfig, id: string, f?: FetchLike) => mpFetch<MpPayment>(cfg, `/v1/payments/${encodeURIComponent(id)}`, {}, f);

export const createPayment = (cfg: MpConfig, body: Record<string, unknown>, idempotencyKey: string, f?: FetchLike) =>
  mpFetch<MpPayment>(cfg, '/v1/payments', { method: 'POST', body, idempotencyKey }, f);

export const refundPayment = (cfg: MpConfig, id: string, f?: FetchLike) =>
  mpFetch<Record<string, unknown>>(cfg, `/v1/payments/${encodeURIComponent(id)}/refunds`, { method: 'POST', body: {}, idempotencyKey: `refund-${id}` }, f);

/** Converte o pagamento do MP no JSON aceito por public.apply_payment(). */
export function toDbPayment(p: MpPayment) {
  const fee = (p.fee_details ?? []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const gross = Number(p.transaction_amount) || 0;
  const net = p.transaction_details?.net_received_amount;
  return {
    id: String(p.id),
    status: p.status,
    status_detail: p.status_detail ?? null,
    payment_type: p.payment_type_id ?? null,
    payment_method: p.payment_method_id ?? null,
    installments: p.installments ?? null,
    transaction_amount: gross,
    fee_amount: Math.round(fee * 100) / 100,
    net_amount: Math.round((net !== undefined && net !== null ? Number(net) : gross - fee) * 100) / 100,
    date_of_expiration: p.date_of_expiration ?? null,
    live_mode: p.live_mode ?? null,
  };
}

// ------------------------------------------------------------------ webhook

/**
 * Valida o cabeçalho x-signature (documentação "Webhooks → Validar origem"):
 *   x-signature: ts=<timestamp>,v1=<hmac>
 *   manifest   : id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *   v1         = HMAC-SHA256(manifest, MP_WEBHOOK_SECRET) em hexadecimal.
 * data.id vem da query string e vai em minúsculas quando alfanumérico.
 */
export function verifyWebhookSignature(input: { signature: string | null; requestId: string | null; dataId: string | null; secret: string }): { ok: boolean; ts: string | null } {
  if (!input.signature) return { ok: false, ts: null };
  const parts = Object.fromEntries(
    input.signature.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k?.trim() ?? '', v.join('=').trim()];
    }),
  );
  const ts = parts.ts || null;
  const v1 = parts.v1 || '';
  if (!ts || !/^[0-9a-f]{64}$/i.test(v1)) return { ok: false, ts };
  let manifest = '';
  if (input.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest();
  const given = Buffer.from(v1, 'hex');
  return { ok: given.length === expected.length && timingSafeEqual(given, expected), ts };
}

/** Data no formato aceito pelo MP (ISO com fuso -03:00). */
export function mpDate(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return `${local.toISOString().slice(0, 23)}-03:00`;
}
