/**
 * Cliente mínimo da API do Stripe (REST + form-encoding) e verificação de
 * assinatura de webhooks. Executa SOMENTE no servidor (importado apenas por
 * route handlers em src/app/api) — a chave secreta vem de variável de ambiente
 * sem prefixo NEXT_PUBLIC_, portanto nunca chega ao navegador.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Converte objetos aninhados no formato do Stripe: a[b][0][c]=v */
export function encodeForm(params: Params, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encodeForm(item as Params, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      out.push(...encodeForm(v as Params, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError('Stripe não configurado.', 500);
  const body = params ? encodeForm(params).join('&') : undefined;
  const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: method === 'GET' ? undefined : body,
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe HTTP ${res.status}`, res.status, json.error?.code);
  return json;
}

/**
 * Valida o cabeçalho `Stripe-Signature` (t=…,v1=…) com HMAC-SHA256 do payload
 * bruto e janela de tolerância contra replay.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  const exp = Buffer.from(expected, 'hex');
  return signatures.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}
