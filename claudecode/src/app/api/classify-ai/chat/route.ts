/**
 * /api/classify-ai/chat — Classify AI (Claude via API oficial da Anthropic).
 *
 *   POST   { message, history?, conversationId?, save? } → NDJSON em streaming:
 *          {"type":"meta"} {"type":"status"} {"type":"text"} {"type":"sources"} {"type":"done"} | {"type":"error"}
 *   GET    ?conversationId=…  → mensagens de uma conversa salva (ou lista de conversas sem o parâmetro)
 *   DELETE ?conversationId=…  → apaga uma conversa salva
 *
 * Exige login (token Supabase no cabeçalho Authorization). A chave da Anthropic
 * é lida apenas aqui no servidor.
 */
import { NextResponse } from 'next/server';
import { classifyAIConfig, missingConfigMessage, type ClassifyAIConfig } from '@/lib/server/classify-ai/config';
import { ClassifyData, userClient } from '@/lib/server/classify-ai/data';
import { createAnthropicClient, describeError, runClassifyAI, type EngineEvent } from '@/lib/server/classify-ai/engine';
import { nowContext } from '@/lib/server/classify-ai/prompt';
import { buildMessages, conversationTitle, parseChatRequest, ValidationError } from '@/lib/server/classify-ai/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel: tempo máximo da função (o plano Hobby permite até 60 s).
export const maxDuration = 60;

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

async function authenticate(req: Request, config: ClassifyAIConfig) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json(401, { error: 'Entre na sua conta para conversar com a Classify AI.', code: 'unauthenticated' }) };
  const db = userClient(config.supabaseUrl, config.supabaseAnonKey, token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { error: json(401, { error: 'Sessão inválida. Entre novamente.', code: 'unauthenticated' }) };
  return { db, userId: data.user.id };
}

function loadConfig() {
  const cfg = classifyAIConfig();
  if (!cfg.ok) {
    console.error('[classify-ai] configuração ausente:', cfg.missing.join(', '));
    return { error: json(503, { error: missingConfigMessage(cfg.missing), code: 'not_configured', missing: cfg.missing }) };
  }
  return { config: cfg.config };
}

export async function POST(req: Request) {
  const c = loadConfig();
  if (c.error) return c.error;
  const config = c.config;

  const auth = await authenticate(req, config);
  if (auth.error) return auth.error;
  const { db, userId } = auth;

  let body: ReturnType<typeof parseChatRequest>;
  try {
    body = parseChatRequest(await req.json().catch(() => null));
  } catch (err) {
    if (err instanceof ValidationError) return json(400, { error: err.message, code: 'invalid_input' });
    throw err;
  }

  // Limite de requisições por usuário (no banco: vale para todas as instâncias da Vercel).
  const quota = await db.rpc('ai_consume_quota');
  if (quota.error) {
    console.error('[classify-ai] quota', quota.error.message);
    return json(503, { error: 'Controle de uso da Classify AI indisponível. Aplique a migração supabase/migrations/0004_classify_ai.sql.', code: 'quota_unavailable' });
  }
  const q = quota.data as { allowed: boolean; reason?: string; limit?: number; event_id?: string; remaining_hour?: number; remaining_day?: number };
  if (!q.allowed) {
    const msg = q.reason === 'hourly'
      ? `Você atingiu o limite de ${q.limit} mensagens por hora na Classify AI. Tente novamente mais tarde.`
      : `Você atingiu o limite de ${q.limit} mensagens por dia na Classify AI. Volte amanhã!`;
    return json(429, { error: msg, code: 'quota_exceeded' });
  }

  const now = nowContext();
  const data = new ClassifyData(db, userId, config.includeDemo, now.today);
  const client = createAnthropicClient(config);
  const messages = buildMessages(body.history, body.message);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: 'meta', model: config.model, remaining_hour: q.remaining_hour, remaining_day: q.remaining_day });

      try {
        const result = await runClassifyAI({
          client,
          config,
          data,
          messages,
          nowText: now.text,
          signal: req.signal,
          onEvent: (e: EngineEvent) => send(e as unknown as Record<string, unknown>),
        });
        await db.rpc('ai_record_usage', {
          p_event: q.event_id, p_status: 'completed', p_model: result.model,
          p_input: result.usage.input_tokens, p_output: result.usage.output_tokens,
        });

        let conversationId = body.conversationId;
        let saveWarning: string | undefined;
        if (body.save) {
          try {
            conversationId = await saveTurn(db, userId, conversationId, body.message, result.text, result.sources);
          } catch (err) {
            console.error('[classify-ai] save', err);
            saveWarning = 'A resposta não pôde ser salva no histórico.';
          }
        }
        send({ type: 'done', conversationId, model: result.model, usage: result.usage, ...(saveWarning ? { warning: saveWarning } : {}) });
      } catch (err) {
        const d = describeError(err);
        console.error('[classify-ai]', d.code, err instanceof Error ? err.message : err);
        await db.rpc('ai_record_usage', { p_event: q.event_id, p_status: 'failed', p_model: config.model, p_input: 0, p_output: 0 });
        send({ type: 'error', code: d.code, status: d.status, error: d.message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

async function saveTurn(
  db: ReturnType<typeof userClient>,
  userId: string,
  conversationId: string | null,
  userMessage: string,
  answer: string,
  sources: unknown[],
): Promise<string> {
  let id = conversationId;
  if (id) {
    const { data } = await db.from('ai_conversations').select('id').eq('id', id).maybeSingle();
    if (!data) id = null; // não pertence ao usuário (RLS) ou foi apagada: cria outra
  }
  if (!id) {
    const { data, error } = await db.from('ai_conversations').insert({ user_id: userId, title: conversationTitle(userMessage) }).select('id').single();
    if (error) throw new Error(error.message);
    id = String(data.id);
  }
  const { error } = await db.from('ai_messages').insert([
    { conversation_id: id, user_id: userId, role: 'user', content: userMessage },
    { conversation_id: id, user_id: userId, role: 'assistant', content: answer.slice(0, 20000), sources },
  ]);
  if (error) throw new Error(error.message);
  return id;
}

export async function GET(req: Request) {
  const c = loadConfig();
  if (c.error) return c.error;
  const auth = await authenticate(req, c.config);
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('conversationId');

  if (!id) {
    const { data, error } = await auth.db.from('ai_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30);
    if (error) return json(503, { error: 'Não foi possível carregar suas conversas.', code: 'database' });
    return json(200, { conversations: data ?? [] });
  }
  const { data, error } = await auth.db.from('ai_messages').select('role, content, sources, created_at').eq('conversation_id', id).order('created_at').limit(400);
  if (error) return json(503, { error: 'Não foi possível carregar a conversa.', code: 'database' });
  return json(200, { messages: data ?? [] });
}

export async function DELETE(req: Request) {
  const c = loadConfig();
  if (c.error) return c.error;
  const auth = await authenticate(req, c.config);
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('conversationId');
  if (!id) return json(400, { error: 'Informe a conversa.', code: 'invalid_input' });
  const { error } = await auth.db.from('ai_conversations').delete().eq('id', id);
  if (error) return json(503, { error: 'Não foi possível apagar a conversa.', code: 'database' });
  return json(200, { ok: true });
}
