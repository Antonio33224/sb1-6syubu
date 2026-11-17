/**
 * Tools do concierge de voz: validação dos argumentos (zod), somente leitura e
 * garantia de que as respostas contêm apenas dados vindos do banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClassifyData, filterVenues, mapStats, mapVenue } from '../src/lib/server/voice/data';
import { executeVoiceTool, parseToolArgs, schemas, ToolInputError, VOICE_TOOL_NAMES, VOICE_TOOLS } from '../src/lib/server/voice/tools';
import { citedCards, type VoiceCard } from '../src/lib/voice/shared';
import { fakeSupabase } from './helpers/fake-supabase';

const TODAY = '2026-11-16';
const SESSION_USER = 'user-da-sessao';

const venue = (o: Record<string, unknown>) => ({
  id: o.slug, name: o.slug, category: 'boate', city: 'São Paulo', state: 'SP', music_styles: [], opening_days: [], is_demo: false, ...o,
});

const VENUES = [
  venue({ slug: 'lux', name: 'Lux Club', description: 'Clube sofisticado', music_styles: ['House', 'Techno'], spend_min: 120, address: 'Rua A, 1' }),
  venue({ slug: 'caro', name: 'Caro Club', music_styles: ['Techno'], spend_min: 300 }),
  venue({ slug: 'sem-preco', name: 'Sem Preço', music_styles: ['Techno'] }),
  venue({ slug: 'rio-house', name: 'Rio House', city: 'Rio de Janeiro', state: 'RJ', music_styles: ['House'], spend_min: 80 }),
  venue({ slug: 'demo-club', name: 'Demo Club', music_styles: ['Techno'], is_demo: true }),
];

const STATS = [
  { venue_id: 'lux', review_count: 30, avg_rating: 9.1, score: 8.9 },
  { venue_id: 'caro', review_count: 10, avg_rating: 9.5, score: 9.0 },
  { venue_id: 'rio-house', review_count: 3, avg_rating: 7, score: 7 },
];

const EVENTS = [
  { id: 'e1', slug: 'noite-anna', name: 'Noite Anna', event_date: '2026-11-21', start_time: '23:00', dj_names: ['Anna Silva'], music_styles: ['Techno'], ticket_price: 90, is_demo: false, venue: VENUES[0] },
  { id: 'e2', slug: 'passado', name: 'Evento Passado', event_date: '2026-10-01', start_time: '23:00', dj_names: ['Anna Silva'], music_styles: [], ticket_price: 50, is_demo: false, venue: VENUES[0] },
  { id: 'e3', slug: 'jose-live', name: 'José Live', event_date: '2026-11-22', start_time: '22:00', dj_names: ['JOSÉ  Pérez'], music_styles: ['House'], ticket_price: null, is_demo: false, venue: VENUES[3] },
];

const REVIEWS = [
  { venue_id: 'lux', overall_rating: 10, comment: 'Som impecável', status: 'published', created_at: '2026-11-01T00:00:00Z' },
  { venue_id: 'lux', overall_rating: 9, comment: 'Ótimo', status: 'published', created_at: '2026-10-01T00:00:00Z' },
  { venue_id: 'lux', overall_rating: 2, comment: 'Oculta', status: 'hidden', created_at: '2026-10-02T00:00:00Z' },
  { venue_id: 'lux', overall_rating: 8, comment: 'Bom', status: 'published', created_at: '2026-09-01T00:00:00Z' },
];

const FOLLOWS = [
  { user_id: SESSION_USER, name: 'Jose Perez', kind: 'dj' },
  { user_id: 'outro-usuario', name: 'Anna Silva', kind: 'dj' },
];

function setup() {
  const fake = fakeSupabase({ venues: VENUES, venue_stats: STATS, events: EVENTS, venue_reviews: REVIEWS, user_favorites: FOLLOWS });
  const data = new ClassifyData(fake.db, SESSION_USER, false, TODAY);
  return { ...fake, data };
}

/** Coleta todos os valores de "nome" de um objeto (profundo). */
function names(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => names(x, out));
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      if (k === 'nome' && typeof v === 'string') out.push(v);
      else names(v, out);
    }
  return out;
}

// Nomes que existem no banco: casas, eventos e DJs dos line-ups.
const DB_NAMES = new Set([...VENUES.map((v) => v.name), ...EVENTS.map((e) => e.name), ...EVENTS.flatMap((e) => e.dj_names)]);

// ------------------------------------------------------------------ definições

test('cada tool da sessão tem schema zod e vice-versa', () => {
  assert.deepEqual(VOICE_TOOLS.map((t) => t.name).sort(), [...VOICE_TOOL_NAMES].sort());
  for (const t of VOICE_TOOLS) {
    assert.equal(t.type, 'function');
    assert.equal(t.parameters.type, 'object');
    assert.ok(t.description.length > 20);
  }
});

// ------------------------------------------------------------------ validação

test('buscar_casas: rejeita tipos e limites inválidos', () => {
  for (const bad of [{ limite: 999 }, { faixa_preco_max: -1 }, { nota_minima: 11 }, { cidade: 42 }, { categoria: 'cassino' }, { ordenar_por: 'aleatorio' }]) {
    assert.throws(() => parseToolArgs('buscar_casas', bad), ToolInputError, JSON.stringify(bad));
  }
  const ok = parseToolArgs('buscar_casas', { estilo_musical: 'Techno' });
  assert.deepEqual(ok.estilo_musical, ['Techno']);
  assert.equal(ok.limite, 5);
  assert.equal(ok.ordenar_por, 'relevancia');
});

test('buscar_eventos: datas no formato certo e em ordem', () => {
  assert.throws(() => parseToolArgs('buscar_eventos', { data_inicio: '2026-13-01' }), ToolInputError);
  assert.throws(() => parseToolArgs('buscar_eventos', { data_inicio: '21/11/2026' }), ToolInputError);
  assert.throws(() => parseToolArgs('buscar_eventos', { data_inicio: '2026-11-22', data_fim: '2026-11-20' }), ToolInputError);
  assert.doesNotThrow(() => parseToolArgs('buscar_eventos', { data_inicio: '2026-11-20', data_fim: '2026-11-22' }));
});

test('casa_id só aceita slug (sem injeção)', () => {
  for (const bad of ["lux'; drop table venues;--", '../admin', 'LUX', '', 'a'.repeat(200)]) {
    assert.throws(() => parseToolArgs('detalhes_casa', { casa_id: bad }), ToolInputError, bad);
  }
  assert.throws(() => parseToolArgs('detalhes_casa', {}), ToolInputError);
});

test('tool desconhecida é recusada', async () => {
  const { data } = setup();
  await assert.rejects(executeVoiceTool('apagar_reviews', {}, data), ToolInputError);
  await assert.rejects(executeVoiceTool('__proto__', {}, data), ToolInputError);
});

test('schemas cobrem todas as tools', () => {
  assert.deepEqual(Object.keys(schemas).sort(), [...VOICE_TOOL_NAMES].sort());
});

// ------------------------------------------------------------------ execução com banco

test('buscar_casas: só registros reais do banco, filtrados e limitados', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('buscar_casas', { cidade: 'sao paulo', estilo_musical: ['techno'], faixa_preco_max: 150 }, data);
  const out = r.output as { total_encontrado: number; resultados: { casa_id: string; nota_media: number | null; preco_reais: { gasto_min: number | null } }[] };
  assert.deepEqual(out.resultados.map((x) => x.casa_id), ['lux', 'sem-preco']); // caro: acima do orçamento; demo: excluído; rio: outra cidade
  assert.equal(out.resultados[1].nota_media, null); // sem avaliações = null, nunca nota inventada
  assert.equal(out.resultados[1].preco_reais.gasto_min, null);
  for (const n of names(r.output)) assert.ok(DB_NAMES.has(n), `nome fora do banco: ${n}`);
  assert.deepEqual(r.cards.map((c) => c.url), ['/boates/lux', '/boates/sem-preco']);
  assert.equal(r.cards[0].nota, 9.1);
});

test('buscar_casas sem resultado devolve lista vazia (sem inventar)', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('buscar_casas', { cidade: 'Curitiba' }, data);
  assert.deepEqual(r.output, { total_encontrado: 0, retornados: 0, resultados: [] });
  assert.deepEqual(r.cards, []);
});

test('buscar_casas respeita o limite de linhas', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('buscar_casas', { limite: 1, ordenar_por: 'nota' }, data);
  assert.equal((r.output as { resultados: unknown[] }).resultados.length, 1);
  assert.equal(r.cards[0].id, 'caro'); // maior nota média
});

test('ordenar por preço deixa casas sem preço no fim', () => {
  const rows = VENUES.filter((v) => !v.is_demo).map((v) => ({ venue: mapVenue(v), stats: mapStats(undefined) }));
  const r = filterVenues(rows, { sort: 'preco', limit: 10 });
  assert.deepEqual(r.items.map((m) => m.venue.slug), ['rio-house', 'lux', 'caro', 'sem-preco']);
});

test('buscar_eventos: nunca retorna eventos passados; DJ por nome parcial', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('buscar_eventos', { dj_nome: 'anna' }, data);
  const out = r.output as { resultados: { evento_id: string; ingresso_reais: number | null }[] };
  assert.deepEqual(out.resultados.map((e) => e.evento_id), ['noite-anna']);
  assert.equal(r.cards[0].url, '/eventos/noite-anna');
  for (const n of names(r.output)) assert.ok(DB_NAMES.has(n), `nome fora do banco: ${n}`);
});

test('detalhes_casa: campos do banco; slug inexistente → encontrado=false', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('detalhes_casa', { casa_id: 'lux' }, data);
  const out = r.output as Record<string, unknown>;
  assert.equal(out.encontrado, true);
  assert.equal(out.nome, 'Lux Club');
  assert.equal(out.nota_media, 9.1);
  assert.equal(out.num_reviews, 30);
  assert.equal(out.endereco, 'Rua A, 1');
  const none = await executeVoiceTool('detalhes_casa', { casa_id: 'nao-existe' }, data);
  assert.equal((none.output as { encontrado: boolean }).encontrado, false);
  assert.deepEqual(none.cards, []);
});

test('top_reviews: só publicadas, maiores notas primeiro, com limite', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('top_reviews', { casa_id: 'lux', limite: 2 }, data);
  const out = r.output as { reviews: { nota: number; comentario: string }[] };
  assert.deepEqual(out.reviews.map((x) => x.comentario), ['Som impecável', 'Ótimo']);
  assert.ok(!out.reviews.some((x) => x.comentario === 'Oculta'));
});

test('djs_seguidos_pelo_usuario usa o usuário da sessão, nunca um id vindo da IA', async () => {
  const { data, calls } = setup();
  const r = await executeVoiceTool('djs_seguidos_pelo_usuario', { user_id: 'outro-usuario' }, data);
  assert.deepEqual((r.output as { seguidos: { nome: string }[] }).seguidos.map((x) => x.nome), ['Jose Perez']);
  const eqs = calls.filter((c) => c.table === 'user_favorites').flatMap((c) => c.ops.filter(([op]) => op === 'eq').map(([, a]) => a));
  assert.deepEqual(eqs, [['user_id', SESSION_USER]]);
});

test('eventos_de_djs_seguidos: casa nomes sem acento/caixa e só do próprio usuário', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('eventos_de_djs_seguidos', {}, data);
  const out = r.output as { djs_seguidos: string[]; resultados: { evento_id: string }[] };
  assert.deepEqual(out.djs_seguidos, ['Jose Perez']);
  assert.deepEqual(out.resultados.map((e) => e.evento_id), ['jose-live']); // Anna é seguida por OUTRO usuário
});

test('eventos_de_djs_seguidos sem DJs seguidos não consulta eventos', async () => {
  const fake = fakeSupabase({ user_favorites: [], events: EVENTS });
  const data = new ClassifyData(fake.db, SESSION_USER, false, TODAY);
  const r = await executeVoiceTool('eventos_de_djs_seguidos', {}, data);
  assert.equal((r.output as { total_encontrado: number }).total_encontrado, 0);
  assert.ok(!fake.calls.some((c) => c.table === 'events'));
});

test('nenhuma tool escreve no banco', async () => {
  const { data, writes } = setup();
  await executeVoiceTool('buscar_casas', {}, data);
  await executeVoiceTool('buscar_eventos', {}, data);
  await executeVoiceTool('detalhes_casa', { casa_id: 'lux' }, data);
  await executeVoiceTool('top_reviews', { casa_id: 'lux' }, data);
  await executeVoiceTool('djs_seguidos_pelo_usuario', {}, data);
  await executeVoiceTool('eventos_de_djs_seguidos', {}, data);
  assert.deepEqual(writes(), []);
});

// ------------------------------------------------------------------ mostrar_opcoes

test('mostrar_opcoes: exibe só casas do banco e descarta ids inválidos/inexistentes/demo', async () => {
  const { data } = setup();
  const r = await executeVoiceTool(
    'mostrar_opcoes',
    { tipo: 'casa', ids: ['caro', 'nao-existe', "lux'; drop table venues;--", 'LUX', 'lux', 'demo-club', 'caro'], titulo: 'Techno em SP' },
    data,
  );
  // Ordem pedida, sem duplicados; demo fica de fora (VOICE_INCLUDE_DEMO desligado).
  assert.deepEqual(r.cards.map((c) => c.id), ['caro', 'lux']);
  assert.deepEqual(r.cards.map((c) => c.url), ['/boates/caro', '/boates/lux']);
  assert.equal(r.cards[0].nota, 9.5); // nota real do banco
  assert.deepEqual(r.display, { titulo: 'Techno em SP' });
  const out = r.output as { exibidos: { id: string; nome: string }[]; descartados: string[] };
  assert.deepEqual(out.exibidos.map((x) => x.nome), ['Caro Club', 'Lux Club']);
  assert.deepEqual(out.descartados.sort(), ['LUX', 'demo-club', "lux'; drop table venues;--", 'nao-existe'].sort());
  for (const n of names(r.output)) assert.ok(DB_NAMES.has(n), `nome fora do banco: ${n}`);
});

test('mostrar_opcoes: eventos passados são descartados', async () => {
  const { data } = setup();
  const r = await executeVoiceTool('mostrar_opcoes', { tipo: 'evento', ids: ['passado', 'noite-anna', 'inventado'] }, data);
  assert.deepEqual(r.cards.map((c) => c.id), ['noite-anna']);
  assert.deepEqual((r.output as { descartados: string[] }).descartados, ['passado', 'inventado']);
  assert.deepEqual(r.display, { titulo: null });
});

test('mostrar_opcoes: DJs só se existirem em line-ups futuros ou nos seguidos', async () => {
  const { data } = setup();
  // dj_id vem das buscas (nome normalizado): "JOSÉ  Pérez" → "jose-perez".
  const ev = await executeVoiceTool('buscar_eventos', { cidade: 'Rio de Janeiro' }, data);
  const djId = (ev.output as { resultados: { djs: { dj_id: string }[] }[] }).resultados[0].djs[0].dj_id;
  assert.equal(djId, 'jose-perez');
  const r = await executeVoiceTool('mostrar_opcoes', { tipo: 'dj', ids: [djId, 'anna-silva', 'dj-inventado'] }, data);
  assert.deepEqual(r.cards.map((c) => c.id), ['jose-perez', 'anna-silva']);
  assert.equal(r.cards[0].tipo, 'dj');
  assert.match(r.cards[0].url, /^\/eventos\?dj=/);
  assert.equal(r.cards[1].data, '2026-11-21'); // próximo evento real (o passado não conta)
  assert.deepEqual((r.output as { descartados: string[] }).descartados, ['dj-inventado']);
});

test('mostrar_opcoes: nada válido → nenhum cartão e aviso ao modelo', async () => {
  const { data, calls } = setup();
  const r = await executeVoiceTool('mostrar_opcoes', { tipo: 'casa', ids: ['../admin', 'X Y'] }, data);
  assert.deepEqual(r.cards, []);
  assert.match(String((r.output as { mensagem: string }).mensagem), /Nenhum id/);
  assert.ok(!calls.some((c) => c.table === 'venues'), 'ids malformados não chegam ao banco');
});

test('mostrar_opcoes: valida tipo e tamanho da lista', () => {
  assert.throws(() => parseToolArgs('mostrar_opcoes', { tipo: 'usuario', ids: ['x'] }), ToolInputError);
  assert.throws(() => parseToolArgs('mostrar_opcoes', { tipo: 'casa', ids: [] }), ToolInputError);
  assert.throws(() => parseToolArgs('mostrar_opcoes', { tipo: 'casa', ids: Array.from({ length: 50 }, (_, i) => `c${i}`) }), ToolInputError);
});

test('mostrar_opcoes não escreve no banco', async () => {
  const { data, writes } = setup();
  await executeVoiceTool('mostrar_opcoes', { tipo: 'casa', ids: ['lux'] }, data);
  await executeVoiceTool('mostrar_opcoes', { tipo: 'evento', ids: ['noite-anna'] }, data);
  await executeVoiceTool('mostrar_opcoes', { tipo: 'dj', ids: ['anna-silva'] }, data);
  assert.deepEqual(writes(), []);
});

// ------------------------------------------------------------------ cartões

test('cartões: só registros consultados E citados na fala', () => {
  const card = (id: string, nome: string): VoiceCard => ({ tipo: 'casa', id, nome, url: `/boates/${id}`, subtitulo: null, nota: null, num_reviews: null, preco: null, data: null, demo: false });
  const cards = [card('lux', 'Lux Club'), card('outra', 'Outra Casa'), card('lux', 'Lux Club')];
  const s = citedCards('Recomendo o Lux club, e também o Bar Inventado.', cards);
  assert.deepEqual(s.map((c) => c.id), ['lux']);
  assert.deepEqual(citedCards('Não encontrei nada.', cards), []);
});
