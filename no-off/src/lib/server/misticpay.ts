/**
 * MisticPay — cliente REST tipado (fetch, sem SDK). SOMENTE NO SERVIDOR. Só Pix.
 * Documentação: https://docs.misticpay.com (API v1)
 *
 * Variáveis:
 *   MISTICPAY_CLIENT_ID       pk_...  (chave de acesso: API → Chaves de Acesso)
 *   MISTICPAY_CLIENT_SECRET   sk_...  (aparece uma única vez, na criação)
 *   MISTICPAY_WEBHOOK_TOKEN   valor aleatório longo inventado por você (vai na URL do webhook)
 *
 * Escopos necessários na chave: TRANSACTION_CREATE e TRANSACTION_READ.
 * Autenticação: Authorization: Basic base64(client_id:client_secret).
 * (A credencial legada ci/cs deixou de funcionar em 30/09/2026 e não é usada.)
 *
 * Lacunas da documentação e como tratamos:
 *  - o webhook NÃO tem assinatura → token secreto na URL + reconfirmação por
 *    POST /transactions/check antes de emitir qualquer ingresso;
 *  - a criação recebe `amount` em REAIS, mas os exemplos de resposta trazem
 *    valores em centavos (4.55 → 455) → normalizeAmountCents() aceita as duas
 *    formas comparando com o total do pedido;
 *  - não há sandbox, expiração do QR nem endpoint de reembolso documentados.
 */
import { timingSafeEqual } from 'node:crypto';

export const MISTIC_API = 'https://api.misticpay.com/api';

export interface MisticConfig {
  clientId: string;
  clientSecret: string;
  webhookToken: string | null;
  /** A MisticPay não tem sandbox: toda cobrança é real. */
  environment: 'live';
}

type EnvLike = Record<string, string | undefined>;

export function misticConfig(env: EnvLike = process.env): MisticConfig | null {
  const clientId = env.MISTICPAY_CLIENT_ID?.trim();
  const clientSecret = env.MISTICPAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, webhookToken: env.MISTICPAY_WEBHOOK_TOKEN?.trim() || null, environment: 'live' };
}

/** Configuração que não pode vender. A mensagem nunca contém as chaves. */
export function credentialError(cfg: MisticConfig): string | null {
  if (!/^pk_[A-Za-z0-9_-]{6,}$/.test(cfg.clientId)) return 'MISTICPAY_CLIENT_ID em formato inválido (esperado pk_...).';
  if (!/^sk_[A-Za-z0-9_-]{6,}$/.test(cfg.clientSecret)) return 'MISTICPAY_CLIENT_SECRET em formato inválido (esperado sk_...).';
  if (cfg.webhookToken !== null && cfg.webhookToken.length < 24) return 'MISTICPAY_WEBHOOK_TOKEN curto demais (use 24+ caracteres aleatórios).';
  return null;
}

export class MisticError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'MisticError';
  }
  /** 429/5xx (e falha de rede, status 0) podem ser repetidos; 4xx não. */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface CallOptions {
  fetch?: typeof fetch;
  /** Tentativas extras para 429/5xx/rede (padrão 3). */
  retries?: number;
  /** Timeout por tentativa em ms (padrão 10 s). */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Backoff exponencial com jitter; respeita Retry-After (segundos) no 429, limitado a 10 s. */
export function backoffMs(attempt: number, retryAfter: string | null, random = Math.random): number {
  const ra = Number(retryAfter);
  if (retryAfter && Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 10_000) + Math.floor(random() * 250);
  const base = Math.min(400 * 2 ** attempt, 5_000);
  return Math.floor(base / 2 + random() * (base / 2));
}

export const basicAuth = (cfg: Pick<MisticConfig, 'clientId' | 'clientSecret'>) =>
  `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64')}`;

async function misticPost<T>(cfg: MisticConfig, path: string, body: unknown, opts: CallOptions = {}): Promise<T> {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const retries = Math.max(0, opts.retries ?? 3);
  let lastErr: MisticError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await f(`${MISTIC_API}${path}`, {
        method: 'POST',
        headers: { authorization: basicAuth(cfg), accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      lastErr = new MisticError(err instanceof Error && err.name === 'TimeoutError' ? 'MisticPay: tempo esgotado' : 'MisticPay: falha de rede', 0);
      if (attempt < retries) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastErr;
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return json as T;

    // Formato de erro: { code, message, statusCode, details, requestId }
    const msg = String(json.message ?? json.error ?? `MisticPay ${res.status}`).slice(0, 300);
    lastErr = new MisticError(msg, res.status, typeof json.code === 'string' ? json.code : null);
    if (RETRY_STATUS.has(res.status) && attempt < retries) {
      await sleep(backoffMs(attempt, res.headers.get('retry-after')));
      continue;
    }
    throw lastErr;
  }
  throw lastErr ?? new MisticError('MisticPay: falha', 0);
}

// ------------------------------------------------------------------ tipos

/** Estados da MisticPay (transactionState / status). */
export type MisticState = 'PENDENTE' | 'COMPLETO' | 'FALHA' | 'CANCELADO' | 'DEVOLVIDO' | 'DEVOLVIDO_PARCIAL' | string;

export interface MisticCharge {
  transactionId: string;
  state: MisticState;
  /** Valor bruto como veio da API (unidade ambígua: reais ou centavos). */
  rawAmount: number | null;
  copyPaste: string | null;
  qrCodeBase64: string | null;
  qrcodeUrl: string | null;
}

export interface MisticTransaction {
  transactionId: string;
  state: MisticState;
  rawAmount: number | null;
  rawFee: number | null;
  type: string | null;
  updatedAt: string | null;
}

export interface CreateChargeInput {
  /** Valor em CENTAVOS (do banco). É enviado à MisticPay em reais. */
  valueCents: number;
  payerName: string;
  /** CPF só com dígitos. */
  payerDocument: string;
  description: string;
  /** Nosso identificador (correlação); a MisticPay devolve o dela. */
  transactionId: string;
  projectWebhook?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// ------------------------------------------------------------------ chamadas

export async function createPixCharge(cfg: MisticConfig, input: CreateChargeInput, opts?: CallOptions): Promise<MisticCharge> {
  if (!Number.isInteger(input.valueCents) || input.valueCents < 100) throw new MisticError('Valor mínimo do Pix: R$ 1,00.', 400, 'AMOUNT_BELOW_MINIMUM');
  const doc = input.payerDocument.replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) throw new MisticError('CPF do pagador inválido.', 400, 'VALIDATION_ERROR');
  const body: Record<string, unknown> = {
    amount: Number((input.valueCents / 100).toFixed(2)),
    payerName: input.payerName.slice(0, 120),
    payerDocument: doc,
    description: input.description.slice(0, 140),
    transactionId: input.transactionId,
  };
  if (input.projectWebhook) body.projectWebhook = input.projectWebhook;
  const json = await misticPost<Record<string, unknown>>(cfg, '/transactions/create', body, opts);
  const d = obj(json.data ?? json);
  return {
    transactionId: str(d.transactionId) ?? input.transactionId,
    state: String(d.transactionState ?? d.status ?? 'PENDENTE'),
    rawAmount: num(d.transactionAmount ?? d.value ?? d.amount),
    copyPaste: str(d.copyPaste ?? d.copypaste ?? d.qrcode),
    qrCodeBase64: str(d.qrCodeBase64),
    qrcodeUrl: str(d.qrcodeUrl ?? d.qrCodeUrl),
  };
}

export async function checkTransaction(cfg: MisticConfig, transactionId: string, opts?: CallOptions): Promise<MisticTransaction> {
  const json = await misticPost<Record<string, unknown>>(cfg, '/transactions/check', { transactionId }, opts);
  const d = obj(json.transaction ?? obj(json.data).transaction ?? json.data ?? json);
  return {
    transactionId: str(d.transactionId) ?? transactionId,
    state: String(d.transactionState ?? d.status ?? ''),
    rawAmount: num(d.value ?? d.transactionAmount ?? d.amount),
    rawFee: num(d.fee ?? d.transactionFee),
    type: str(d.transactionType),
    updatedAt: str(d.updatedAt),
  };
}

// ------------------------------------------------------------------ utilitários

/** Estado da MisticPay → status interno usado pelo apply_payment. */
export function mapState(state: MisticState): 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded' | 'unknown' {
  switch (String(state).toUpperCase()) {
    case 'PENDENTE':
      return 'pending';
    case 'COMPLETO':
      return 'paid';
    case 'FALHA':
      return 'failed';
    case 'CANCELADO':
      return 'cancelled';
    case 'DEVOLVIDO':
      return 'refunded';
    case 'DEVOLVIDO_PARCIAL':
      return 'partially_refunded';
    default:
      return 'unknown';
  }
}

/**
 * A unidade dos valores devolvidos é ambígua (reais na criação; centavos nos
 * exemplos de resposta). Aceita as duas formas comparando com o total esperado.
 * matched=false → valor divergente (o pedido NÃO deve ser emitido).
 */
export function normalizeAmountCents(raw: number | null, expectedCents: number): { cents: number | null; matched: boolean } {
  if (raw === null || !Number.isFinite(raw)) return { cents: null, matched: false };
  if (Number.isInteger(raw) && raw === expectedCents) return { cents: expectedCents, matched: true }; // centavos
  if (Math.round(raw * 100) === expectedCents) return { cents: expectedCents, matched: true }; // reais
  // Divergente: guarda a leitura mais provável para o alerta (inteiro grande = centavos).
  return { cents: Number.isInteger(raw) && raw >= expectedCents / 10 ? raw : Math.round(raw * 100), matched: false };
}

/** Imagem do QR para <img src>: base64 vira data URL; senão usa a URL da MisticPay. */
export function qrImageSrc(c: Pick<MisticCharge, 'qrCodeBase64' | 'qrcodeUrl'>): string | null {
  const b64 = c.qrCodeBase64?.trim();
  if (b64) return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  return c.qrcodeUrl?.trim() || null;
}

/** Nosso transactionId: prefixo + pedido + sufixo (permite gerar um Pix novo para o mesmo pedido). */
export const ourTransactionId = (orderId: string, now = Date.now()) => `nooff-${orderId}-${now.toString(36)}`;

/** Extrai o id do pedido do nosso transactionId (ou null). */
export function orderIdFromTransactionId(id: unknown): string | null {
  const m = typeof id === 'string' ? /^nooff-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9a-z]+$/i.exec(id) : null;
  return m ? m[1]!.toLowerCase() : null;
}

/** Token do webhook (na URL): comparação em tempo constante, conferindo o tamanho antes. */
export function verifyWebhookToken(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
