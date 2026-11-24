/**
 * Importação de avaliações reais coletadas no PRÉ-LANÇAMENTO (planilha CSV).
 *
 * Regras:
 *  - Cada linha é a avaliação de uma pessoa real que autorizou a publicação.
 *  - O autor é identificado por `autor_usuario`; o mesmo usuário em várias
 *    linhas vira um único perfil "importado" (sem senha, não faz login).
 *  - As mesmas regras de conteúdo do app valem aqui (notas 0–10, comentário
 *    sem links, data não futura, um autor por local).
 *  - O servidor revalida tudo (função `admin_import_reviews`).
 */
import { COMMENT_MAX, validateComment, validateUsername } from '@/lib/moderation';
import { CRITERIA, type CriteriaScores, type CriterionKey } from '@/types';

export const IMPORT_MAX_ROWS = 500;

/** Coluna da planilha → critério da avaliação. */
export const SCORE_COLUMNS: { column: string; key: CriterionKey }[] = [
  { column: 'musica', key: 'music_rating' },
  { column: 'publico', key: 'crowd_rating' },
  { column: 'ambiente', key: 'atmosphere_rating' },
  { column: 'bebidas', key: 'drinks_rating' },
  { column: 'atendimento', key: 'service_rating' },
  { column: 'organizacao', key: 'organization_rating' },
  { column: 'experiencia', key: 'experience_rating' },
];

export const TEMPLATE_HEADERS = [
  'local_slug',
  'autor_nome',
  'autor_usuario',
  ...SCORE_COLUMNS.map((c) => c.column),
  'comentario',
  'data_experiencia',
] as const;

const REQUIRED_HEADERS = ['local_slug', 'autor_usuario', ...SCORE_COLUMNS.map((c) => c.column)];

export interface ReviewImportRow extends CriteriaScores {
  /** Linha na planilha (1 = cabeçalho), para mensagens de erro. */
  line: number;
  venue_id: string;
  venue_slug: string;
  author_username: string;
  author_name: string;
  comment: string;
  experience_date: string | null;
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportParseResult {
  rows: ReviewImportRow[];
  errors: ImportIssue[];
}

export interface ImportResult {
  created: number;
  profiles_created: number;
}

// ------------------------------------------------------------------ CSV

/** Detecta o separador pela linha de cabeçalho (Excel pt-BR salva com ";"). */
function detectDelimiter(firstLine: string): ';' | ',' | '\t' {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const candidates: [';' | ',' | '\t', number][] = [[';', count(';')], [',', count(',')], ['\t', count('\t')]];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]![1] > 0 ? candidates[0]![0] : ';';
}

/** Parser CSV (RFC 4180): aspas, aspas escapadas ("") e quebras de linha dentro de campos. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Remove linhas totalmente vazias (Excel costuma deixar algumas no fim).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const normHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');

/** Aceita "8,5", "8.5" e "9". Retorna NaN se inválido. */
export function parseScore(raw: string): number {
  const s = raw.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d+)?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 10) / 10;
}

/** Aceita AAAA-MM-DD ou DD/MM/AAAA. Retorna null se vazio, undefined se inválido. */
export function parseDate(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) iso = `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  if (!iso) return undefined;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

// ------------------------------------------------------------------ validação

export function parseReviewImport(
  text: string,
  venues: { id: string; slug: string }[],
  today: Date = new Date(),
): ImportParseResult {
  const table = parseCsv(text);
  const errors: ImportIssue[] = [];
  const rows: ReviewImportRow[] = [];
  if (table.length === 0) return { rows, errors: [{ line: 1, message: 'A planilha está vazia.' }] };

  const headers = table[0]!.map(normHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    return { rows, errors: [{ line: 1, message: `Colunas obrigatórias ausentes: ${missing.join(', ')}. Use o modelo.` }] };
  }
  const body = table.slice(1);
  if (body.length === 0) return { rows, errors: [{ line: 2, message: 'Nenhuma avaliação encontrada abaixo do cabeçalho.' }] };
  if (body.length > IMPORT_MAX_ROWS) {
    return { rows, errors: [{ line: 1, message: `Máximo de ${IMPORT_MAX_ROWS} avaliações por arquivo (encontradas ${body.length}).` }] };
  }

  const col = (r: string[], name: string) => (r[headers.indexOf(name)] ?? '').trim();
  const bySlug = new Map(venues.map((v) => [v.slug, v.id]));
  const pairs = new Set<string>();
  const commentsByAuthor = new Map<string, Map<string, string>>(); // usuario -> comentario -> slug
  const tomorrow = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);

  body.forEach((r, i) => {
    const line = i + 2;
    const problems: string[] = [];

    const slug = col(r, 'local_slug').toLowerCase();
    const venueId = bySlug.get(slug);
    if (!slug) problems.push('local_slug vazio');
    else if (!venueId) problems.push(`local "${slug}" não existe (confira o slug na aba Estabelecimentos)`);

    const username = col(r, 'autor_usuario').toLowerCase().replace(/^@/, '');
    const uErr = validateUsername(username);
    if (uErr) problems.push(`autor_usuario "${username}" inválido: ${uErr}`);

    const name = col(r, 'autor_nome');
    if (name.length > 80) problems.push('autor_nome passa de 80 caracteres');

    const scores = {} as CriteriaScores;
    for (const { column, key } of SCORE_COLUMNS) {
      const v = parseScore(col(r, column));
      if (Number.isNaN(v) || v < 0 || v > 10) problems.push(`${column}: nota "${col(r, column)}" deve ser um número de 0 a 10`);
      scores[key] = v;
    }

    const comment = col(r, 'comentario').replace(/\s+/g, ' ');
    const cErr = validateComment(comment);
    if (cErr) problems.push(cErr);
    if (comment.length > COMMENT_MAX) problems.push(`comentário passa de ${COMMENT_MAX} caracteres`);

    const date = parseDate(col(r, 'data_experiencia'));
    if (date === undefined) problems.push(`data_experiencia "${col(r, 'data_experiencia')}" inválida (use AAAA-MM-DD ou DD/MM/AAAA)`);
    else if (date && date > tomorrow) problems.push('data_experiencia não pode estar no futuro');

    if (!uErr && venueId) {
      const pair = `${username}|${venueId}`;
      if (pairs.has(pair)) problems.push(`@${username} já tem outra avaliação de "${slug}" nesta planilha`);
      pairs.add(pair);
      if (comment) {
        const mine = commentsByAuthor.get(username) ?? new Map<string, string>();
        const other = mine.get(comment);
        if (other && other !== slug) problems.push(`@${username} repete o mesmo comentário usado em "${other}"`);
        mine.set(comment, slug);
        commentsByAuthor.set(username, mine);
      }
    }

    if (problems.length) {
      problems.forEach((message) => errors.push({ line, message }));
      return;
    }
    rows.push({
      line,
      venue_id: venueId!,
      venue_slug: slug,
      author_username: username,
      author_name: name,
      ...scores,
      comment,
      experience_date: date ?? null,
    });
  });

  return { rows, errors };
}

// ------------------------------------------------------------------ modelo

const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * Modelo de planilha (CSV com ";" e BOM UTF-8 — abre direto no Excel pt-BR e no Google Sheets).
 * Usa slugs reais do catálogo quando disponíveis.
 */
export function buildTemplateCsv(venueSlugs: string[] = []): string {
  const s1 = venueSlugs[0] ?? 'slug-do-local';
  const s2 = venueSlugs[1] ?? s1;
  const examples: string[][] = [
    [s1, 'Ana Souza', 'ana.souza', '9', '8,5', '9', '7', '8', '7,5', '9', 'Som impecável e pista cheia até o fim. Fila rápida na entrada.', '2026-10-25'],
    [s2, 'Bruno Lima', 'brunolima', '8', '8', '8,5', '6', '7', '6,5', '8', 'Line-up forte, mas os drinks estavam caros para o tamanho.', '18/10/2026'],
    [s1, 'Bruno Lima', 'brunolima', '7,5', '7', '8', '7', '8', '8', '7,5', '', ''],
  ];
  const lines = [TEMPLATE_HEADERS.join(';'), ...examples.map((r) => r.map(csvCell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Legenda das colunas, exibida na interface ao lado do botão de modelo. */
export const TEMPLATE_GUIDE: { column: string; help: string }[] = [
  { column: 'local_slug', help: 'Slug do estabelecimento (fim da URL /boates/…). Obrigatório.' },
  { column: 'autor_nome', help: 'Nome ou apelido que a pessoa autorizou exibir. Opcional.' },
  { column: 'autor_usuario', help: '3–24 caracteres: minúsculas, números, ponto ou _. Repetir o mesmo usuário agrupa as avaliações num só perfil.' },
  { column: SCORE_COLUMNS.map((c) => c.column).join(', '), help: `Notas de 0 a 10 (aceita 8,5 ou 8.5) — ${CRITERIA.map((c) => c.label).join(', ')}.` },
  { column: 'comentario', help: 'Opcional. Mínimo de 10 caracteres se preenchido, sem links.' },
  { column: 'data_experiencia', help: 'Opcional. AAAA-MM-DD ou DD/MM/AAAA. Não pode ser futura.' },
];
