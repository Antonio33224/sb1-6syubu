/**
 * Paywall da IA de voz: só assinantes Classify+ (assinatura OU gratuidade).
 * Quem não assina recebe 403 em TODOS os endpoints de voz, e nada é chamado
 * na OpenAI nem nas funções de cota.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPremium } from '../src/lib/server/auth';
import { voiceConfig } from '../src/lib/server/voice/config';
import { ClassifyData } from '../src/lib/server/voice/data';
import { createSessionHandlers, createToolHandler, createTranscriptHandlers, type VoiceDeps } from '../src/lib/server/voice/handlers';
import { isGrantActive } from '../src/lib/coupons';
import { hasPremiumAccess, resolveAccess } from '../src/lib/plus/subscription';
import type { PremiumGrant, Subscription } from '../src/types';
import { fakeSupabase } from './helpers/fake-supabase';

const ENV = { OPENAI_API_KEY: 'sk-test-chave', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' } as unknown as NodeJS.ProcessEnv;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-17T12:00:00Z');
const DAY = 86_400_000;

const grant = (o: Partial<PremiumGrant> = {}): PremiumGrant => ({
  id: 'g1', user_id: 'u1', source: 'coupon', coupon_id: null, reason: '', revoked_at: null, created_at: NOW.toISOString(),
  starts_at: new Date(NOW.getTime() - DAY).toISOString(), ends_at: new Date(NOW.getTime() + 10 * DAY).toISOString(), ...o,
});

/**
 * Banco falso em que `has_premium` segue a MESMA regra de public._has_premium():
 * assinatura vigente OU gratuidade ativa não revogada.
 */
function premiumDb(state: { subs: Subscription[]; grants: PremiumGrant[] }) {
  return fakeSupabase(
    {},
    {
      has_premium: () => ({
        data: state.subs.some((s) => hasPremiumAccess(s, NOW.getTime())) || state.grants.some((g) => isGrantActive(g, NOW.getTime())),
        error: null,
      }),
      voice_start_session: () => ({ data: { allowed: true, session_id: SESSION_ID, expires_at: '2026-11-17T12:10:00Z', max_seconds: 600 }, error: null }),
      voice_end_session: () => ({ data: null, error: null }),
      voice_register_tool_call: () => ({ data: { allowed: true }, error: null }),
    },
  );
}

function deps(fake: ReturnType<typeof fakeSupabase>, hasPremium: VoiceDeps['hasPremium'] = checkPremium) {
  const openaiCalls: string[] = [];
  const d: VoiceDeps = {
    config: () => voiceConfig(ENV),
    authenticate: async (req) => (req.headers.get('authorization') ? { db: fake.db, userId: 'u1' } : null),
    hasPremium,
    fetch: (async (url: string) => {
      openaiCalls.push(String(url));
      return Response.json({ value: 'ek_temporario', expires_at: 1_900_000_000 });
    }) as typeof fetch,
    dataFor: (ctx, config, today) => new ClassifyData(ctx.db, ctx.userId, config.includeDemo, today),
    now: () => NOW,
  };
  return { d, openaiCalls };
}

const req = (path: string, method = 'POST', body?: unknown) =>
  new Request(`http://localhost${path}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

const toolBody = { session_id: SESSION_ID, name: 'buscar_casas', arguments: '{}' };

test('não assinante: 403 em todos os endpoints de voz e nada é executado', async () => {
  const fake = premiumDb({ subs: [], grants: [] });
  const { d, openaiCalls } = deps(fake);
  const session = createSessionHandlers(d);
  const transcripts = createTranscriptHandlers(d);
  const responses = [
    await session.POST(req('/api/voice/session')),
    await session.DELETE(req(`/api/voice/session?id=${SESSION_ID}`, 'DELETE')),
    await createToolHandler(d)(req('/api/voice/tool', 'POST', toolBody)),
    await transcripts.POST(req('/api/voice/transcripts', 'POST', { role: 'user', content: 'oi' })),
    await transcripts.GET(req('/api/voice/transcripts', 'GET')),
    await transcripts.DELETE(req(`/api/voice/transcripts?conversationId=${SESSION_ID}`, 'DELETE')),
  ];
  for (const res of responses) {
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'subscription_required');
    assert.match(body.error, /Classify\+/);
  }
  assert.equal(openaiCalls.length, 0, 'a OpenAI não pode ser chamada');
  assert.deepEqual(fake.rpcCalls.map(([n]) => n).filter((n) => n !== 'has_premium'), [], 'nenhuma função de cota/sessão é chamada');
  assert.deepEqual(fake.calls, [], 'nenhuma tabela é lida ou escrita');
});

test('assinatura vencida não libera a voz', async () => {
  const expired: Subscription = {
    id: 's1', user_id: 'u1', plan_id: 'monthly', status: 'active', provider: 'stripe', provider_customer_id: null, provider_subscription_id: 'sub_1',
    trial_start: null, trial_end: null, current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z',
    cancel_at_period_end: false, canceled_at: null, ended_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  };
  const { d } = deps(premiumDb({ subs: [expired], grants: [] }));
  assert.equal((await createSessionHandlers(d).POST(req('/api/voice/session'))).status, 403);
});

test('gratuidade ativa libera a IA (sem assinatura paga)', async () => {
  const state = { subs: [] as Subscription[], grants: [grant()] };
  const fake = premiumDb(state);
  const { d, openaiCalls } = deps(fake);
  const res = await createSessionHandlers(d).POST(req('/api/voice/session'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).client_secret, 'ek_temporario');
  assert.equal(openaiCalls.length, 1);
  assert.equal((await createToolHandler(d)(req('/api/voice/tool', 'POST', toolBody))).status, 200);

  // Revogada ou encerrada → bloqueia de novo.
  state.grants = [grant({ revoked_at: NOW.toISOString() })];
  assert.equal((await createSessionHandlers(d).POST(req('/api/voice/session'))).status, 403);
  state.grants = [grant({ ends_at: new Date(NOW.getTime() - 1000).toISOString() })];
  assert.equal((await createSessionHandlers(d).POST(req('/api/voice/session'))).status, 403);
  // Agendada para o futuro ainda não vale.
  state.grants = [grant({ starts_at: new Date(NOW.getTime() + DAY).toISOString() })];
  assert.equal((await createSessionHandlers(d).POST(req('/api/voice/session'))).status, 403);
});

test('gratuidade também libera o Classify+ na interface (resolveAccess)', () => {
  const a = resolveAccess([], NOW.getTime(), [grant()]);
  assert.equal(a.tier, 'premium');
  assert.equal(a.label, 'Gratuidade');
  assert.equal(a.source, 'grant');
  // Gratuidades encadeadas: o acesso vai até o fim da última.
  const chained = resolveAccess([], NOW.getTime(), [
    grant(),
    grant({ id: 'g2', starts_at: new Date(NOW.getTime() + 10 * DAY).toISOString(), ends_at: new Date(NOW.getTime() + 40 * DAY).toISOString() }),
  ]);
  assert.equal(chained.accessUntil, new Date(NOW.getTime() + 40 * DAY).toISOString());
  assert.equal(resolveAccess([], NOW.getTime(), [grant({ revoked_at: NOW.toISOString() })]).tier, 'free');
});

test('o banco também barra (defesa em profundidade): voice_start_session/register recusam sem Classify+', async () => {
  const fake = fakeSupabase({}, {
    voice_start_session: () => ({ data: { allowed: false, reason: 'subscription_required' }, error: null }),
    voice_register_tool_call: () => ({ data: { allowed: false, reason: 'subscription_required' }, error: null }),
  });
  const { d, openaiCalls } = deps(fake, async () => true); // o handler acha que é assinante (ex.: corrida no fim do período)
  const s = await createSessionHandlers(d).POST(req('/api/voice/session'));
  assert.equal(s.status, 403);
  assert.equal((await s.json()).code, 'subscription_required');
  assert.equal(openaiCalls.length, 0);
  const t = await createToolHandler(d)(req('/api/voice/tool', 'POST', toolBody));
  assert.equal(t.status, 403);
});

test('falha ao verificar a assinatura → 503 (nunca libera por erro)', async () => {
  const fake = fakeSupabase({}, {}); // has_premium não existe (migração ausente)
  const { d, openaiCalls } = deps(fake);
  const res = await createSessionHandlers(d).POST(req('/api/voice/session'));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'access_unavailable');
  assert.equal(openaiCalls.length, 0);
});

test('sem login continua 401 (antes do paywall)', async () => {
  const { d } = deps(premiumDb({ subs: [], grants: [grant()] }));
  const res = await createSessionHandlers(d).POST(new Request('http://localhost/api/voice/session', { method: 'POST' }));
  assert.equal(res.status, 401);
});
