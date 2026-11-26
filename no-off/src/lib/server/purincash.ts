/**
 * PurinCash — cliente REST tipado (fetch, sem SDK). SOMENTE NO SERVIDOR.
 * Documentação: https://docs.purin.cash (versão para IA: /llms-full.txt)
 *
 * Variáveis:
 *   PURINCASH_API_KEY         ps_test_... (sandbox) ou ps_live_... (produção)
 *   PURINCASH_WEBHOOK_SECRET  segredo da conta (Dashboard → Equipe & API → Developer API)
 *
 * O ambiente é detectado pelo prefixo da chave. Em produção (VERCEL_ENV=production
 * ou PURINCASH_ENV=production) uma chave ps_test_ é recusada para não "vender" sem cobrar.
 * A chave nunca é logada nem enviada ao navegador; o valor cobrado é sempre o
 * total do pedido no banco.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PURIN_API = 'https://api.purin.cash/v1';

export type PurinEnvironment = 'sandbox' | 'live';

export interface PurinConfig {
  apiKey: string;
  webhookSecret: string | null;
  environment: PurinEnvironment;
}

type EnvLike = Record<string, string | undefined>;

export function purinConfig(env: EnvLike = process.env): PurinConfig | null {
  const apiKey = env.PURINCASH_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    webhookSecret: env.PURINCASH_WEBHOOK_SECRET?.trim() || null,
    environment: apiKey.startsWith('ps_live_') ? 'live' : 'sandbox',
  };
}

/** Deploy de produção? (Vercel define VERCEL_ENV; fora da Vercel use PURINCASH_ENV=production.) */
export const isProductionDeploy = (env: EnvLike = process.env) => env.VERCEL_ENV === 'production' || env.PURINCASH_ENV === 'production';

/** Configuração que não pode vender. A mensagem não contém a chave. */
export function credentialError(cfg: PurinConfig, production: boolean): string | null {
  if (!/^ps_(live|test)_[A-Za-z0-9_-]+$/.test(cfg.apiKey)) return 'PURINCASH_API_KEY em formato inválido (esperado ps_live_... ou ps_test_...).';
  if (production && cfg.environment === 'sandbox') return 'Deploy de produção com chave de sandbox (ps_test_) do PurinCash.';
  return null;
}

export class PurinError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'PurinError';
  }
  /** 429/5xx (e falha de rede, status 0) podem ser repetidos; 4xx não. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface CallOptions {
  fetch?: typeof fetch;
  /** Tentativas extras para 429/500/502/503/504/rede (padrão 3). */
  retries?: number;
  /** Timeout por tentativa em ms (padrão 10 s). */
  timeoutMs?: number;
  /** Injetável nos testes (sem esperar de verdade). */
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Backoff exponencial com jitter; respeita RateLimit-Reset (segundos) no 429, limitado a 10 s. */
export function backoffMs(attempt: number, resetHeader: string | null, random = Math.random): number {
  const reset = Number(resetHeader);
  if (resetHeader && Number.isFinite(reset) && reset >= 0) return Math.min(reset * 1000, 10_000) + Math.floor(random() * 250);
  const base = Math.min(400 * 2 ** attempt, 5_000);
  return Math.floor(base / 2 + random() * (base / 2));
}

async function purinFetch<T>(cfg: PurinConfig, path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}, opts: CallOptions = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const retries = Math.max(0, opts.retries ?? 3);
  let lastErr: PurinError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await f(`${PURIN_API}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          accept: 'application/json',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      // Rede/timeout: a mensagem do fetch não contém a chave, mas não a repassamos mesmo assim.
      lastErr = new PurinError(err instanceof Error && err.name === 'TimeoutError' ? 'PurinCash: tempo esgotado' : 'PurinCash: falha de rede', 0);
      if (attempt < retries) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastErr;
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return json as T;

    const msg = String(json.error ?? json.erro ?? `PurinCash ${res.status}`).slice(0, 300);
    lastErr = new PurinError(msg, res.status, typeof json.code === 'string' ? json.code : null);
    if (RETRY_STATUS.has(res.status) && attempt < retries) {
      await sleep(backoffMs(attempt, res.headers.get('ratelimit-reset')));
      continue;
    }
    throw lastErr;
  }
  throw lastErr ?? new PurinError('PurinCash: falha', 0);
}

// ------------------------------------------------------------------ tipos

export interface PurinCustomer {
  name: string;
  email: string;
  externalId?: string;
}

export type ChargeStatus = 'pending' | 'paid' | 'expired' | 'refunded';
export type CardStatus = 'pending' | 'paid' | 'expired' | 'refunded' | 'failed';

export interface PixCharge {
  paymentId: string;
  status: ChargeStatus;
  amountCents: number;
  currency?: string;
  environment?: PurinEnvironment;
  pix?: { brCode?: string; qrCodeImage?: string } | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  metadata?: string | null;
}

export interface CardPayment {
  orderCode: string;
  status: CardStatus;
  amountCents?: number;
  /** Em REAIS (decimal) na consulta e no webhook card_payment.paid. */
  amount?: number | string;
  currency?: string;
  checkoutUrl?: string | null;
  expiresAt?: string | null;
  paidAt?: string | null;
  metadata?: string | null;
}

export interface PurinRefund {
  id?: string;
  status: string;
  idempotentReplay?: boolean;
  [k: string]: unknown;
}

// ------------------------------------------------------------------ chamadas

export interface CreatePixInput {
  valueCents: number;
  description: string;
  expiresIn: number;
  callbackUrl?: string;
  customer: PurinCustomer;
  metadata: string;
}

export function createPixCharge(cfg: PurinConfig, input: CreatePixInput, opts?: CallOptions) {
  if (!Number.isInteger(input.valueCents) || input.valueCents < 80) throw new PurinError('Valor mínimo do Pix: R$ 0,80.', 400, 'invalid_amount');
  const body = {
    ...input,
    description: input.description.slice(0, 200),
    expiresIn: Math.min(604_800, Math.max(60, Math.ceil(input.expiresIn))),
  };
  if (body.metadata.length > 2048) throw new PurinError('metadata acima de 2048 caracteres.', 400, 'invalid_metadata');
  return purinFetch<PixCharge>(cfg, '/charges', { method: 'POST', body }, opts);
}

export const getCharge = (cfg: PurinConfig, paymentId: string, opts?: CallOptions) =>
  purinFetch<PixCharge>(cfg, `/charges/${encodeURIComponent(paymentId)}`, {}, opts);

export interface CreateCardInput {
  valueCents: number;
  description: string;
  callbackUrl?: string;
  customer: PurinCustomer;
  successUrl: string;
  cancelUrl: string;
  metadata: string;
}

export function createCardPayment(cfg: PurinConfig, input: CreateCardInput, opts?: CallOptions) {
  if (cfg.environment !== 'live') throw new PurinError('Cartão não está disponível no sandbox do PurinCash.', 400, 'card_unavailable');
  return purinFetch<CardPayment>(cfg, '/card-payments', { method: 'POST', body: { ...input, description: input.description.slice(0, 200) } }, opts);
}

export const getCardPayment = (cfg: PurinConfig, orderCode: string, opts?: CallOptions) =>
  purinFetch<CardPayment>(cfg, `/card-payments/${encodeURIComponent(orderCode)}`, {}, opts);

/** Reembolso INTEGRAL de um Pix pago (uma vez por venda; taxa de R$ 0,50). Conclusão via refund.completed / refund.failed. */
export const createRefund = (cfg: PurinConfig, input: { paymentId: string; idempotencyKey: string; reason?: string }, opts?: CallOptions) =>
  purinFetch<PurinRefund>(cfg, '/refunds', { method: 'POST', body: input }, opts);

/** Somente sandbox: marca a cobrança como paga e dispara o webhook. */
export function simulatePaid(cfg: PurinConfig, paymentId: string, opts?: CallOptions) {
  if (cfg.environment !== 'sandbox' || !cfg.apiKey.startsWith('ps_test_')) throw new PurinError('simulate-paid só existe no sandbox (ps_test_).', 403, 'sandbox_only');
  return purinFetch<Record<string, unknown>>(cfg, `/sandbox/charges/${encodeURIComponent(paymentId)}/simulate-paid`, { method: 'POST' }, opts);
}

// ------------------------------------------------------------------ utilitários

/** Valor da cobrança de cartão em centavos (amountCents ou amount em reais). */
export function cardAmountCents(p: Pick<CardPayment, 'amountCents' | 'amount'>): number | null {
  if (typeof p.amountCents === 'number' && Number.isFinite(p.amountCents)) return Math.round(p.amountCents);
  const reais = Number(p.amount);
  return p.amount !== undefined && p.amount !== null && Number.isFinite(reais) ? Math.round(reais * 100) : null;
}

/** metadata é uma STRING JSON; devolve o orderId guardado nela (ou null). */
export function metadataOrderId(metadata: unknown): string | null {
  let obj: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      obj = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const id = obj && typeof obj === 'object' ? (obj as Record<string, unknown>).orderId : null;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}

/**
 * X-Webhook-Signature = HMAC-SHA256 em HEX do CORPO CRU (bytes exatos recebidos).
 * Comparação em tempo constante, conferindo o tamanho antes.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody).digest('hex');
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
