/**
 * Regras básicas anti-spam / anti-fraude aplicadas antes de gravar uma avaliação.
 * No Supabase as mesmas regras são reforçadas por constraints e triggers
 * (ver `enforce_review_rules` na migration) — o navegador não é confiável.
 */
export const REVIEW_RATE_LIMIT_PER_HOUR = 5;
export const COMMENT_MIN = 10;
export const COMMENT_MAX = 2000;
export const REPORTS_TO_FLAG = 3;
export const MAX_REVIEW_PHOTOS = 4;

const URL_RE = /(https?:\/\/|www\.)\S+/i;

export function validateComment(comment: string): string | null {
  const c = comment.trim();
  if (c.length > 0 && c.length < COMMENT_MIN) return `O comentário precisa de pelo menos ${COMMENT_MIN} caracteres.`;
  if (c.length > COMMENT_MAX) return `O comentário pode ter no máximo ${COMMENT_MAX} caracteres.`;
  if (URL_RE.test(c)) return 'Links não são permitidos nos comentários.';
  if (/(.)\1{9,}/.test(c)) return 'O comentário parece conter spam.';
  return null;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function validateUsername(u: string): string | null {
  if (!/^[a-z0-9._]{3,24}$/.test(u)) return 'Use de 3 a 24 caracteres: letras minúsculas, números, ponto ou _.';
  return null;
}

export function validatePassword(p: string): string | null {
  if (p.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  return null;
}
