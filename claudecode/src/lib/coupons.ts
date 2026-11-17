/**
 * Cupons e gratuidades — regras puras compartilhadas entre servidor, navegador e testes.
 * A FONTE DA VERDADE é o Postgres (`public.redeem_coupon`, migration 0006), que
 * aplica exatamente estas regras dentro de uma transação com trava de linha.
 */

export type RedeemReason = 'invalid' | 'not_started' | 'expired' | 'exhausted' | 'already_redeemed' | 'too_many_attempts' | 'unauthenticated';

export const COUPON_CODE_RE = /^[A-Z0-9-]{4,32}$/;
export const MAX_FAILED_REDEEMS_PER_HOUR = 10;

/** Remove espaços e coloca em maiúsculas (o código é case-insensitive). */
export const normalizeCouponCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();

export interface CouponRule {
  active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  max_redemptions: number | null;
  per_user_limit: number;
  redemptions_count: number;
}

/** Motivo da recusa (null = pode resgatar). Mesma ordem de verificação do SQL. */
export function couponRejection(c: CouponRule | null, userRedemptions: number, now = Date.now()): RedeemReason | null {
  if (!c || !c.active) return 'invalid';
  if (c.starts_at && Date.parse(c.starts_at) > now) return 'not_started';
  if (c.expires_at && Date.parse(c.expires_at) <= now) return 'expired';
  if (c.max_redemptions !== null && c.redemptions_count >= c.max_redemptions) return 'exhausted';
  if (userRedemptions >= c.per_user_limit) return 'already_redeemed';
  return null;
}

/** Status HTTP e mensagem para cada recusa. */
export const REDEEM_ERRORS: Record<RedeemReason, [number, string]> = {
  invalid: [404, 'Cupom inválido. Confira o código e tente de novo.'],
  not_started: [409, 'Este cupom ainda não está valendo.'],
  expired: [410, 'Este cupom expirou.'],
  exhausted: [409, 'Este cupom já atingiu o limite de usos.'],
  already_redeemed: [409, 'Você já usou este cupom.'],
  too_many_attempts: [429, 'Muitas tentativas inválidas. Tente de novo em uma hora.'],
  unauthenticated: [401, 'Entre na sua conta para resgatar um cupom.'],
};

export interface GrantLike {
  starts_at: string;
  ends_at: string;
  revoked_at: string | null;
}

const DAY = 86_400_000;

/** Janela da próxima gratuidade: começa quando a última ativa termina (somam-se). */
export function nextGrantWindow(grants: GrantLike[], days: number, now = Date.now()): { starts_at: string; ends_at: string } {
  const lastEnd = grants.filter((g) => !g.revoked_at && Date.parse(g.ends_at) > now).reduce((m, g) => Math.max(m, Date.parse(g.ends_at)), now);
  return { starts_at: new Date(lastEnd).toISOString(), ends_at: new Date(lastEnd + days * DAY).toISOString() };
}

/** Gratuidade vigente agora (não revogada e dentro da janela). */
export function isGrantActive(g: GrantLike, now = Date.now()): boolean {
  return !g.revoked_at && Date.parse(g.starts_at) <= now && Date.parse(g.ends_at) > now;
}

/**
 * Fim do acesso por gratuidades encadeadas a partir de agora
 * (null = nenhuma gratuidade vigente).
 */
export function grantAccessUntil(grants: GrantLike[], now = Date.now()): string | null {
  const valid = grants.filter((g) => !g.revoked_at && Date.parse(g.ends_at) > now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  if (!valid.some((g) => isGrantActive(g, now))) return null;
  let end = now;
  for (const g of valid) {
    if (Date.parse(g.starts_at) > end) break;
    end = Math.max(end, Date.parse(g.ends_at));
  }
  return new Date(end).toISOString();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I

/** Código aleatório legível (ex.: CLASSIFY-7KQ2-M9XD). */
export function generateCouponCode(prefix = 'CLASSIFY'): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return normalizeCouponCode(`${prefix}-${chars.slice(0, 4)}-${chars.slice(4)}`).slice(0, 32);
}
