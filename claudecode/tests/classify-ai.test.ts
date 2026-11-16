/**
 * Testes da lógica local da Classify AI (filtros, validação, vínculo com registros).
 * Não substituem o teste real com a API da Anthropic: `npm run ai:smoke`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAIConfig } from '../src/lib/server/classify-ai/config';
import { filterEvents, filterVenues, mapEvent, mapStats, mapVenue, norm } from '../src/lib/server/classify-ai/data';
import { parseVenueQuery } from '../src/lib/server/classify-ai/tools';
import { buildMessages, citedSources, parseChatRequest, ValidationError } from '../src/lib/server/classify-ai/validate';

const venue = (o: Record<string, unknown>) =>
  mapVenue({ id: o.slug, name: o.slug, category: 'boate', city: 'São Paulo', state: 'SP', music_styles: [], opening_days: [], ...o });

const rows = [
  { venue: venue({ slug: 'lux', description: 'Clube sofisticado nos Jardins', music_styles: ['House', 'Techno'], opening_days: ['Sábado'], spend_min: 120 }), stats: mapStats({ review_count: 30, avg_rating: 9.1, score: 8.9 }) },
  { venue: venue({ slug: 'caro', music_styles: ['Eletrônica'], opening_days: ['Sábado'], spend_min: 300 }), stats: mapStats({ review_count: 10, avg_rating: 9.5, score: 9.0 }) },
  { venue: venue({ slug: 'sem-preco', music_styles: ['Techno'], opening_days: [] }), stats: mapStats(undefined) },
  { venue: venue({ slug: 'funk', music_styles: ['Funk'], opening_days: ['Sábado'], spend_min: 50 }), stats: mapStats({ review_count: 5, avg_rating: 8, score: 7.5 }) },
  { venue: venue({ slug: 'rio', city: 'Rio de Janeiro', state: 'RJ', music_styles: ['House'], spend_min: 80 }), stats: mapStats({ review_count: 3, avg_rating: 7, score: 7 }) },
];

test('norm remove acentos e caixa', () => {
  assert.equal(norm('  Eletrônica  São   Paulo '), 'eletronica sao paulo');
});

test('busca de casas: cidade, estilo, orçamento e dia sem inventar preço', () => {
  const r = filterVenues(rows, { city: 'sao paulo', music_styles: ['eletronica', 'house', 'techno'], max_budget: 150, days: ['sábado'], keywords: ['sofisticado'] }, null);
  const slugs = r.items.map((m) => m.venue.slug);
  assert.deepEqual(slugs, ['lux', 'sem-preco']); // "caro" excede o orçamento; "funk" é outro estilo; "rio" é outra cidade
  assert.equal(r.items[0].matched_keywords[0], 'sofisticado');
  const semPreco = r.items.find((m) => m.venue.slug === 'sem-preco')!;
  assert.equal(semPreco.price_known, false);
  assert.equal(semPreco.stats.avg_rating, null); // sem avaliações = sem nota (nunca 0 inventado)
});

test('only_known_prices exclui casas sem preço informado', () => {
  const r = filterVenues(rows, { city: 'São Paulo', music_styles: ['techno'], max_budget: 150, only_known_prices: true }, null);
  assert.deepEqual(r.items.map((m) => m.venue.slug), ['lux']);
});

test('nenhum resultado compatível retorna lista vazia', () => {
  const r = filterVenues(rows, { city: 'Curitiba' }, null);
  assert.equal(r.total, 0);
});

test('Meu Ranking: nota personalizada usa os pesos do usuário', () => {
  const withCriteria = [
    { venue: venue({ slug: 'a' }), stats: mapStats({ review_count: 5, avg_rating: 8, score: 8, music_rating: 10, drinks_rating: 4 }) },
    { venue: venue({ slug: 'b' }), stats: mapStats({ review_count: 5, avg_rating: 8, score: 8, music_rating: 4, drinks_rating: 10 }) },
  ];
  const weights = { music_rating: 0, crowd_rating: 0, atmosphere_rating: 0, drinks_rating: 100, service_rating: 0, organization_rating: 0, experience_rating: 0 };
  const r = filterVenues(withCriteria, {}, weights);
  assert.equal(r.items[0].venue.slug, 'b');
  assert.equal(r.items[0].personal_score, 10);
});

test('eventos: estilo pela casa, preço desconhecido mantido, DJ por nome parcial', () => {
  const ev = (o: Record<string, unknown>) => mapEvent({ id: o.slug, name: o.slug, event_date: '2026-11-21', start_time: '23:00', dj_names: [], music_styles: [], ticket_price: null, ...o });
  const lux = { id: 'lux', slug: 'lux', name: 'Lux', city: 'São Paulo', state: 'SP', music_styles: ['Techno'] };
  const list = [
    ev({ slug: 'e1', venue: lux, dj_names: ['Anna Silva'], ticket_price: 90 }),
    ev({ slug: 'e2', venue: lux, ticket_price: 200 }),
    ev({ slug: 'e3', venue: lux }),
  ];
  assert.deepEqual(filterEvents(list, { music_styles: ['techno'], max_price: 100 }).items.map((e) => e.slug), ['e1', 'e3']);
  assert.deepEqual(filterEvents(list, { dj: 'anna' }).items.map((e) => e.slug), ['e1']);
});

test('entrada das ferramentas é saneada', () => {
  const q = parseVenueQuery({ category: 'cassino', max_budget: -5, limit: 999, music_styles: ['House', 3, ''], use_my_ranking: 'sim' });
  assert.equal(q.category, undefined);
  assert.equal(q.max_budget, 0);
  assert.equal(q.limit, 10);
  assert.deepEqual(q.music_styles, ['House']);
  assert.equal(q.use_my_ranking, false);
});

test('validação do chat', () => {
  assert.throws(() => parseChatRequest({ message: '   ' }), ValidationError);
  assert.throws(() => parseChatRequest({ message: 'x'.repeat(2001) }), ValidationError);
  assert.throws(() => parseChatRequest({ message: 'oi', history: [{ role: 'system', content: 'x' }] }), ValidationError);
  assert.throws(() => parseChatRequest({ message: 'oi', conversationId: '1; drop table' }), ValidationError);
  const ok = parseChatRequest({ message: ' oi ', history: [{ role: 'user', content: 'a' }] });
  assert.equal(ok.message, 'oi');
  assert.equal(ok.save, true);
});

test('histórico: limite, alternância e começa pelo usuário', () => {
  const history = [
    { role: 'assistant' as const, content: 'olá' },
    ...Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `m${i}` })),
  ];
  const msgs = buildMessages(history, 'nova');
  assert.equal(msgs[0].role, 'user');
  assert.ok(msgs.length <= 21);
  assert.equal(msgs[msgs.length - 1].content, 'nova');
  for (let i = 1; i < msgs.length; i++) assert.notEqual(msgs[i].role, msgs[i - 1].role);
});

test('cartões só para registros consultados e citados', () => {
  const seen = [
    { type: 'venue' as const, id: '1', slug: 'lux', name: 'Lux Club', url: '/boates/lux' },
    { type: 'venue' as const, id: '2', slug: 'outra', name: 'Outra Casa', url: '/boates/outra' },
  ];
  const s = citedSources('Recomendo a **Lux Club** e também o Bar Inventado.', seen);
  assert.deepEqual(s.map((x) => x.slug), ['lux']);
});

test('configuração: sem ANTHROPIC_API_KEY retorna erro, nunca modo simulado', () => {
  const r = classifyAIConfig({ NEXT_PUBLIC_SUPABASE_URL: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y' } as unknown as NodeJS.ProcessEnv);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.missing.includes('ANTHROPIC_API_KEY'));
  const c = classifyAIConfig({ ANTHROPIC_API_KEY: 'k', NEXT_PUBLIC_SUPABASE_URL: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y', CLASSIFY_AI_MODEL: 'claude-sonnet-5-5' } as unknown as NodeJS.ProcessEnv);
  assert.ok(c.ok && c.config.model === 'claude-sonnet-5-5');
});
