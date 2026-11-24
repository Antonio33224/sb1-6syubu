/**
 * Importação da lista VIP por CSV. Colunas aceitas (cabeçalho opcional, ; ou ,):
 *   nome ; cpf ; email ; celular ; observacao
 * Só "nome" é obrigatório. CPF inválido é descartado com aviso (não bloqueia a linha).
 */
import { isValidCpf, onlyDigits } from './cpf';

export interface VipCsvRow {
  name: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  note: string;
}

export interface VipCsvResult {
  rows: VipCsvRow[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, keyof VipCsvRow> = {
  nome: 'name', name: 'name', 'nome completo': 'name',
  cpf: 'cpf', documento: 'cpf',
  email: 'email', 'e-mail': 'email',
  celular: 'phone', telefone: 'phone', phone: 'phone', whatsapp: 'phone',
  observacao: 'note', observação: 'note', obs: 'note', nota: 'note', note: 'note',
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseVipCsv(text: string, max = 2000): VipCsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const warnings: string[] = [];
  if (!lines.length) return { rows: [], warnings: ['Arquivo vazio.'] };
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const first = splitLine(lines[0]!, sep).map((h) => h.toLowerCase());
  const hasHeader = first.some((h) => h in HEADER_ALIASES);
  const order: (keyof VipCsvRow)[] = hasHeader ? first.map((h) => HEADER_ALIASES[h] ?? ('' as keyof VipCsvRow)) : ['name', 'cpf', 'email', 'phone', 'note'];
  const rows: VipCsvRow[] = [];
  const seen = new Set<string>();

  lines.slice(hasHeader ? 1 : 0).forEach((line, i) => {
    const n = i + (hasHeader ? 2 : 1);
    if (rows.length >= max) return;
    const cells = splitLine(line, sep);
    const get = (k: keyof VipCsvRow) => {
      const idx = order.indexOf(k);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const name = get('name').replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) {
      warnings.push(`Linha ${n}: sem nome — ignorada.`);
      return;
    }
    let cpf: string | null = onlyDigits(get('cpf')) || null;
    if (cpf && !isValidCpf(cpf)) {
      warnings.push(`Linha ${n}: CPF inválido descartado (${name}).`);
      cpf = null;
    }
    const email = get('email').toLowerCase() || null;
    let phone: string | null = onlyDigits(get('phone')) || null;
    if (phone && (phone.length < 10 || phone.length > 13)) {
      warnings.push(`Linha ${n}: celular inválido descartado (${name}).`);
      phone = null;
    }
    const key = `${name.toLowerCase()}|${cpf ?? email ?? ''}`;
    if (seen.has(key)) {
      warnings.push(`Linha ${n}: nome repetido no arquivo — ignorado (${name}).`);
      return;
    }
    seen.add(key);
    rows.push({ name, cpf, email: email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null, phone, note: get('note').slice(0, 300) });
  });
  if (lines.length - (hasHeader ? 1 : 0) > max) warnings.push(`Somente as primeiras ${max} linhas foram lidas.`);
  return { rows, warnings };
}
