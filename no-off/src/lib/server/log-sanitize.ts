/**
 * Logs do servidor sem dados pessoais nem segredos.
 * Use `log.error/warn/info` em vez de `console.*` nas rotas de API.
 *
 * Mascara: e-mails, tokens Bearer/JWT, chaves (sk_/pk_/whsec_/ek_/rk_),
 * CPF, telefones e números de cartão (UUIDs são preservados para depuração).
 * Objetos Error viram só "Nome: mensagem" (sem stack
 * com payloads), e objetos são serializados e redigidos.
 */

const PATTERNS: [RegExp, string | ((m: string) => string)][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redigido]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt]'],
  [/\b(sk|pk|rk|ek|whsec|sess)_(live_|test_)?[A-Za-z0-9]{8,}\b/g, '[chave]'],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[chave]'],
  // Basic auth (MisticPay), token do webhook na URL, chaves antigas (PurinCash / Mercado Pago)
  [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [redigido]'],
  [/([?&]token=)[^&\s"']+/gi, '$1[redigido]'],
  [/\b(pk|sk)_[A-Za-z0-9_-]{6,}/g, '[chave]'],
  [/\bps_(live|test)_[A-Za-z0-9_-]{6,}/g, '[chave]'],
  [/\b(APP_USR|TEST)-[A-Za-z0-9-]{16,}\b/g, '[chave]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m)],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|(?<![\w-])\d{11}(?![\w-])/g, '[cpf]'],
  [/(?<![\w-])\d{4}[ ]\d{4}[ ]\d{4}[ ]\d{1,7}(?![\w-])|(?<![\w-])\d{16}(?![\w-])/g, '[numero]'],
  [/\+55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b|\(\d{2}\)\s?9?\d{4}-?\d{4}\b/g, '[telefone]'],
];

/** joao.silva@gmail.com → jo***@g***.com */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${user.slice(0, 2)}***@${host.slice(0, 1)}***${tld}`;
}

export function redact(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep as string);
  return out.length > 2000 ? `${out.slice(0, 2000)}…` : out;
}

function clean(v: unknown): unknown {
  if (v instanceof Error) return redact(`${v.name}: ${v.message}`);
  if (typeof v === 'string') return redact(v);
  if (v && typeof v === 'object') {
    try {
      return redact(JSON.stringify(v));
    } catch {
      return '[objeto]';
    }
  }
  return v;
}

export const log = {
  error: (tag: string, ...args: unknown[]) => console.error(tag, ...args.map(clean)),
  warn: (tag: string, ...args: unknown[]) => console.warn(tag, ...args.map(clean)),
  info: (tag: string, ...args: unknown[]) => console.info(tag, ...args.map(clean)),
};
