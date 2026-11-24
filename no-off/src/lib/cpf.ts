/** CPF, celular e nome — validação espelhada em public.valid_cpf() / reserve_order(). */

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** 12345678909 → 123.456.789-09 (parcial enquanto digita). */
export function formatCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** Mascara para relatórios na tela: ***.456.789-** */
export const maskCpf = (cpf: string | null | undefined) => {
  const d = onlyDigits(cpf ?? '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '—';
};

/** (21) 99999-9999 (parcial enquanto digita). DDD + 8 ou 9 dígitos. */
export function formatPhone(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const isValidPhone = (input: string) => {
  const d = onlyDigits(input);
  return d.length === 10 || d.length === 11 || ((d.length === 12 || d.length === 13) && d.startsWith('55'));
};

/** Celular brasileiro → E.164 (+55DDDNÚMERO) para o OTP por SMS. */
export function toE164(input: string): string | null {
  let d = onlyDigits(input);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return `+55${d}`;
}

export const isFullName = (s: string) => {
  const t = s.trim();
  return t.length >= 3 && /\S+\s+\S+/.test(t);
};
