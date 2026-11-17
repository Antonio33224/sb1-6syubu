/**
 * Endpoints do concierge de voz: autenticação, rate limit, token efêmero
 * (a chave da OpenAI nunca sai do servidor) e validação das tool calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceConfig, DEFAULT_VOICE_MODEL } from '../src/lib/server/voice/config';
import { ClassifyData } from '../src/lib/server/voice/data';
import { createSessionHandlers, createToolHandler, createTranscriptHandlers, OPENAI_CLIENT_SECRETS_URL, type VoiceDeps } from '../src/lib/server/voice/handlers';
import { fakeSupabase } from './helpers/fake-supabase';

const API_KEY = 'sk-test-super-secreta';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ENV = { OPENAI_API_KEY: API_KEY, NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' } as unknown as NodeJS.ProcessEnv;

type Rpc = Parameters<typeof fakeSupabase>[1];

function makeDeps(opts: { authed?: boolean; env?: NodeJS.ProcessEnv; rpcs?: Rpc; openai?: (init: RequestInit) => Response; tables?: Record<string, Record<string, unknown>[]> } = {}) {
  const fake = fakeSupabase(opts.tables ?? {}, opts.rpcs ?? {});
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const deps: VoiceDeps = {
    config: () => voiceConfig(opts.env ?? ENV),
    authenticate: async (req) => (opts.authed === false || !req.headers.get('authorization') ? null : { db: fake.db, userId: 'u1' }),
    fetch: (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      return opts.openai ? opts.openai(init) : Response.json({ value: 'ek_temporario', expires_at: 1_900_000_000, session: { id: 'sess_1' } });
    }) as typeof fetch,
    dataFor: (ctx, config, today) => new ClassifyData(ctx.db, ctx.userId, config.includeDemo, today),
    now: () => new Date('2026-11-16T15:00:00Z'),
  };
  return { deps, fake, fetchCalls };
}

const req = (path: string, init: RequestInit & { auth?: boolean } = {}) =>
  new Request(`http://localhost${path}`, {
    method: init.method ?? 'POST',
    headers: { ...(init.auth === false ? {} : { authorization: 'Bearer token-supabase' }), 'content-type': 'application/json' },
    body: init.body,
  });

const allowed: Rpc = {
  voice_start_session: () => ({ data: { allowed: true, session_id: SESSION_ID, expires_at: '2026-11-16T15:10:00Z', max_seconds: 600 }, error: null }),
  voice_end_session: () => ({ data: null, error: null }),
};

// ------------------------------------------------------------------ configuração

test('config: sem OPENAI_API_KEY não há modo simulado; modelo padrão realtime', () => {
  const r = voiceConfig({ NEXT_PUBLIC_SUPABASE_URL: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y' } as unknown as NodeJS.ProcessEnv);
  assert.ok(!r.ok && r.missing.includes('OPENAI_API_KEY'));
  const c = voiceConfig(ENV);
  assert.ok(c.ok && c.config.model === DEFAULT_VOICE_MODEL);
  const o = voiceConfig({ ...ENV, VOICE_MODEL: 'gpt-realtime-2.1-mini' } as NodeJS.ProcessEnv);
  assert.ok(o.ok && o.config.model === 'gpt-realtime-2.1-mini');
});

// ------------------------------------------------------------------ POST /api/voice/session

test('sessão: sem login → 401 e nada é chamado', async () => {
  const { deps, fetchCalls, fake } = makeDeps({ rpcs: allowed });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session', { auth: false }));
  assert.equal(res.status, 401);
  assert.equal(fetchCalls.length, 0);
  assert.equal(fake.rpcCalls.length, 0);
});

test('sessão: sem OPENAI_API_KEY → 503 not_configured', async () => {
  const { deps } = makeDeps({ env: { NEXT_PUBLIC_SUPABASE_URL: 'x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'y' } as unknown as NodeJS.ProcessEnv });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'not_configured');
});

test('sessão: rate limit estourado → 429 e a OpenAI não é chamada', async () => {
  const { deps, fetchCalls } = makeDeps({ rpcs: { voice_start_session: () => ({ data: { allowed: false, reason: 'hourly', limit: 6 }, error: null }) } });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session'));
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.code, 'rate_limited');
  assert.match(body.error, /6 conversas por hora/);
  assert.equal(fetchCalls.length, 0);
});

test('sessão: migração ausente → 503 (não libera sem controle de uso)', async () => {
  const { deps, fetchCalls } = makeDeps({ rpcs: {} });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session'));
  assert.equal(res.status, 503);
  assert.equal(fetchCalls.length, 0);
});

test('sessão: devolve token efêmero e nunca a chave da OpenAI', async () => {
  const { deps, fetchCalls } = makeDeps({ rpcs: allowed });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session'));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(API_KEY), 'a chave vazou na resposta');
  const body = JSON.parse(text);
  assert.equal(body.client_secret, 'ek_temporario');
  assert.equal(body.session_id, SESSION_ID);
  assert.equal(body.max_seconds, 600);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  // Chamada ao servidor da OpenAI: chave só no cabeçalho, sessão configurada.
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, OPENAI_CLIENT_SECRETS_URL);
  assert.equal((fetchCalls[0].init.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`);
  const sent = JSON.parse(String(fetchCalls[0].init.body));
  assert.equal(sent.expires_after.seconds, 60);
  assert.equal(sent.session.type, 'realtime');
  assert.equal(sent.session.model, DEFAULT_VOICE_MODEL);
  assert.equal(sent.session.audio.input.turn_detection.type, 'server_vad');
  assert.equal(sent.session.audio.input.turn_detection.interrupt_response, true);
  assert.equal(sent.session.audio.input.transcription.language, 'pt');
  assert.ok(sent.session.audio.output.voice);
  assert.match(sent.session.instructions, /português do Brasil/);
  assert.match(sent.session.instructions, /2026-11-16/);
  assert.ok(sent.session.tools.some((t: { name: string }) => t.name === 'buscar_casas'));
});

test('sessão: erro da OpenAI → 502 sem repassar detalhes e sessão marcada como falha', async () => {
  const { deps, fake } = makeDeps({
    rpcs: allowed,
    openai: () => Response.json({ error: { message: `Incorrect API key provided: ${API_KEY}` } }, { status: 401 }),
  });
  const res = await createSessionHandlers(deps).POST(req('/api/voice/session'));
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes(API_KEY));
  assert.ok(!text.includes('Incorrect API key'));
  assert.deepEqual(fake.rpcCalls.at(-1), ['voice_end_session', { p_session: SESSION_ID, p_status: 'failed' }]);
});

test('sessão: DELETE exige uuid válido', async () => {
  const { deps, fake } = makeDeps({ rpcs: allowed });
  const h = createSessionHandlers(deps);
  assert.equal((await h.DELETE(req('/api/voice/session?id=abc', { method: 'DELETE' }))).status, 400);
  assert.equal((await h.DELETE(req(`/api/voice/session?id=${SESSION_ID}`, { method: 'DELETE' }))).status, 200);
  assert.deepEqual(fake.rpcCalls.at(-1), ['voice_end_session', { p_session: SESSION_ID, p_status: 'ended' }]);
});

// ------------------------------------------------------------------ POST /api/voice/tool

const toolBody = (name: string, args: unknown = {}) => JSON.stringify({ session_id: SESSION_ID, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const toolAllowed: Rpc = { voice_register_tool_call: () => ({ data: { allowed: true }, error: null }) };

test('tool: sem login → 401', async () => {
  const { deps } = makeDeps({ rpcs: toolAllowed });
  const res = await createToolHandler(deps)(req('/api/voice/tool', { auth: false, body: toolBody('buscar_casas') }));
  assert.equal(res.status, 401);
});

test('tool: sessão expirada/encerrada/de outro usuário é recusada', async () => {
  for (const [reason, status] of [['expired', 410], ['ended', 410], ['not_found', 403], ['tool_limit', 429]] as const) {
    const { deps } = makeDeps({ rpcs: { voice_register_tool_call: () => ({ data: { allowed: false, reason }, error: null }) } });
    const res = await createToolHandler(deps)(req('/api/voice/tool', { body: toolBody('buscar_casas') }));
    assert.equal(res.status, status, reason);
  }
});

test('tool: corpo e argumentos inválidos', async () => {
  const { deps } = makeDeps({ rpcs: toolAllowed });
  const h = createToolHandler(deps);
  assert.equal((await h(req('/api/voice/tool', { body: JSON.stringify({ session_id: 'x', name: 'buscar_casas' }) }))).status, 400);
  assert.equal((await h(req('/api/voice/tool', { body: toolBody('buscar_casas', '{nao é json') }))).status, 422);
  const bad = await h(req('/api/voice/tool', { body: toolBody('buscar_casas', { limite: 500 }) }));
  assert.equal(bad.status, 422);
  const body = await bad.json();
  assert.equal(body.code, 'invalid_arguments');
  assert.ok(body.output.erro, 'o modelo recebe o erro para corrigir os argumentos');
  assert.equal((await h(req('/api/voice/tool', { body: toolBody('excluir_tudo') }))).status, 422);
  assert.equal((await h(req('/api/voice/tool', { body: JSON.stringify({ session_id: SESSION_ID, name: 'buscar_casas', arguments: 'x'.repeat(5000) }) }))).status, 400);
});

test('tool: executa no banco e devolve output + cards', async () => {
  const { deps, fake } = makeDeps({
    rpcs: toolAllowed,
    tables: {
      venues: [{ id: 'v1', slug: 'lux', name: 'Lux Club', category: 'boate', city: 'São Paulo', is_demo: false, music_styles: ['Techno'] }],
      venue_stats: [{ venue_id: 'v1', review_count: 4, avg_rating: 8.5, score: 8 }],
    },
  });
  const res = await createToolHandler(deps)(req('/api/voice/tool', { body: toolBody('buscar_casas', { cidade: 'São Paulo' }) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.output.resultados[0].nome, 'Lux Club');
  assert.equal(body.cards[0].url, '/boates/lux');
  assert.deepEqual(fake.rpcCalls[0], ['voice_register_tool_call', { p_session: SESSION_ID }]);
  assert.deepEqual(fake.writes(), []);
});

// ------------------------------------------------------------------ transcrições

test('transcrições: valida conteúdo e URLs dos cartões', async () => {
  const { deps } = makeDeps();
  const h = createTranscriptHandlers(deps);
  const card = { tipo: 'casa', id: 'x', nome: 'X', url: 'javascript:alert(1)', subtitulo: null, nota: null, num_reviews: null, preco: null, data: null, demo: false };
  assert.equal((await h.POST(req('/api/voice/transcripts', { body: JSON.stringify({ role: 'user', content: 'oi', cards: [card] }) }))).status, 400);
  assert.equal((await h.POST(req('/api/voice/transcripts', { body: JSON.stringify({ role: 'system', content: 'oi' }) }))).status, 400);
  assert.equal((await h.POST(req('/api/voice/transcripts', { body: JSON.stringify({ role: 'user', content: '   ' }) }))).status, 400);
  assert.equal((await h.POST(req('/api/voice/transcripts', { auth: false, body: JSON.stringify({ role: 'user', content: 'oi' }) }))).status, 401);
});
