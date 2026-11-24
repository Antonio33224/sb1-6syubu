import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateCsv, parseCsv, parseDate, parseReviewImport, parseScore, TEMPLATE_HEADERS } from '../src/lib/review-import';

const VENUES = [
  { id: 'v1', slug: 'paradise-club' },
  { id: 'v2', slug: 'rooftop-360' },
];
const TODAY = new Date('2026-11-17T12:00:00Z');
const HEADER = TEMPLATE_HEADERS.join(';');
const row = (over: Partial<Record<(typeof TEMPLATE_HEADERS)[number], string>> = {}) => {
  const base: Record<string, string> = {
    local_slug: 'paradise-club', autor_nome: 'Ana', autor_usuario: 'ana.s', musica: '9', publico: '8,5', ambiente: '9',
    bebidas: '7', atendimento: '8', organizacao: '7.5', experiencia: '9', comentario: 'Som impecável a noite toda.', data_experiencia: '2026-10-25',
  };
  return TEMPLATE_HEADERS.map((h) => over[h] ?? base[h]).join(';');
};

test('parseCsv: aspas, separador detectado, BOM e linhas vazias', () => {
  const t = parseCsv('﻿a;b\r\n"x;1";"diz ""oi"""\r\n\r\n');
  assert.deepEqual(t, [['a', 'b'], ['x;1', 'diz "oi"']]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a;b\n"linha\nquebrada";2'), [['a', 'b'], ['linha\nquebrada', '2']]);
});

test('parseScore e parseDate', () => {
  assert.equal(parseScore('8,5'), 8.5);
  assert.equal(parseScore('10'), 10);
  assert.ok(Number.isNaN(parseScore('')));
  assert.ok(Number.isNaN(parseScore('abc')));
  assert.equal(parseDate('2026-10-25'), '2026-10-25');
  assert.equal(parseDate('5/9/2026'), '2026-09-05');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('31/02/2026'), undefined);
});

test('importação válida normaliza usuário, notas e data', () => {
  const { rows, errors } = parseReviewImport([HEADER, row({ autor_usuario: '@Ana.S', data_experiencia: '25/10/2026' })].join('\n'), VENUES, TODAY);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.author_username, 'ana.s');
  assert.equal(rows[0]!.venue_id, 'v1');
  assert.equal(rows[0]!.crowd_rating, 8.5);
  assert.equal(rows[0]!.organization_rating, 7.5);
  assert.equal(rows[0]!.experience_date, '2026-10-25');
});

test('importação aponta erros por linha', () => {
  const csv = [
    HEADER,
    row({ local_slug: 'nao-existe' }),
    row({ musica: '11' }),
    row({ comentario: 'veja www.site.com' }),
    row({ data_experiencia: '2027-01-01' }),
    row({ autor_usuario: 'A' }),
    row({ comentario: 'curto' }),
  ].join('\n');
  const { rows, errors } = parseReviewImport(csv, VENUES, TODAY);
  assert.equal(rows.length, 0);
  assert.deepEqual([...new Set(errors.map((e) => e.line))], [2, 3, 4, 5, 6, 7]);
});

test('mesmo autor no mesmo local e comentário repetido são recusados', () => {
  const csv = [
    HEADER,
    row(),
    row(),
    row({ local_slug: 'rooftop-360' }),
  ].join('\n');
  const { rows, errors } = parseReviewImport(csv, VENUES, TODAY);
  assert.equal(rows.length, 1);
  assert.equal(errors.length, 2);
  assert.match(errors[0]!.message, /já tem outra avaliação/);
  assert.match(errors[1]!.message, /mesmo comentário/);
});

test('colunas obrigatórias ausentes e limite de linhas', () => {
  assert.match(parseReviewImport('local_slug;comentario\nx;y', VENUES, TODAY).errors[0]!.message, /Colunas obrigatórias/);
  const many = [HEADER, ...Array.from({ length: 501 }, (_, i) => row({ autor_usuario: `user${i}` }))].join('\n');
  assert.match(parseReviewImport(many, VENUES, TODAY).errors[0]!.message, /Máximo de 500/);
});

test('o modelo gerado é aceito pelo próprio importador', () => {
  const csv = buildTemplateCsv(VENUES.map((v) => v.slug));
  assert.ok(csv.startsWith('﻿'));
  const { rows, errors } = parseReviewImport(csv, VENUES, TODAY);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.author_username)).size, 2);
});
