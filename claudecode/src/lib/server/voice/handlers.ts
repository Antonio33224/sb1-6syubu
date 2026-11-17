/**
 * Handlers HTTP do concierge de voz. Ficam aqui (e não nos route.ts) para
 * receber dependências injetáveis — os testes trocam OpenAI e Supabase por fakes.
 *
 *   POST   /api/voice/session        → abre sessão (auth + rate limit) e devolve token efêmero
 *   DELETE /api/voice/session?id=…   → encerra a sessão
 *   POST   /api/voice/tool           → executa uma tool call no banco (somente leitura)
 *   GET/POST/DELETE /api/voice/transcripts → histórico opt-in das conversas
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceSessionResponse } from '@/lib/voice/shared';
import { missingConfigMessage, nowContext, VOICE_LIMITS, voiceConfig, voiceInstructions, type VoiceConfig, type VoiceConfigResult } from './config';
import { checkPremium } from '../auth';
import { log } from '../log-sanitize';
import { ClassifyData, DataError, userClient } from './data';
import { executeVoiceTool, ToolInputError, VOICE_TOOLS, type VoiceDataSource } from './tools';

export const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

export interface AuthContext {
  db: SupabaseClient;
  userId: string;
}

export interface VoiceDeps {
  config: () => VoiceConfigResult;
  /** Resolve o usuário a partir do token Supabase; null = não autenticado. */
  authenticate: (req: Request, config: VoiceConfig) => Promise<AuthContext | null>;
  /** Acesso Classify+ vigente (assinatura OU gratuidade). A IA é exclusiva para assinantes. */
  hasPremium: (ctx: AuthContext) => Promise<boolean>;
  fetch: typeof fetch;
  dataFor: (ctx: AuthContext, config: VoiceConfig, today: string) => VoiceDataSource;
  now: () => Date;
}

export const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function supabaseAuthenticate(req: Request, config: VoiceConfig): Promise<AuthContext | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const db = userClient(config.supabaseUrl, config.supabaseAnonKey, token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { db, userId: data.user.id };
}

export const defaultDeps: VoiceDeps = {
  config: () => voiceConfig(),
  authenticate: supabaseAuthenticate,
  hasPremium: checkPremium,
  fetch: (...args) => fetch(...args),
  dataFor: (ctx, config, today) => new ClassifyData(ctx.db, ctx.userId, config.includeDemo, today),
  now: () => new Date(),
};

type Guard = { error: Response } | { error?: undefined; config: VoiceConfig; auth: AuthContext };

async function guard(req: Request, deps: VoiceDeps): Promise<Guard> {
  const cfg = deps.config();
  if (!cfg.ok) {
    log.error('[voice] configuração ausente:', cfg.missing.join(', '));
    return { error: json(503, { error: missingConfigMessage(cfg.missing), code: 'not_configured' }) };
  }
  const auth = await deps.authenticate(req, cfg.config);
  if (!auth) return { error: json(401, { error: 'Entre na sua conta para falar com o concierge.', code: 'unauthenticated' }) };
  // Paywall no servidor (o banco confere de novo em voice_start_session / voice_register_tool_call).
  let premium: boolean;
  try {
    premium = await deps.hasPremium(auth);
  } catch (err) {
    log.error('[voice] verificação de assinatura', err);
    return { error: json(503, { error: 'Não foi possível verificar sua assinatura agora.', code: 'access_unavailable' }) };
  }
  if (!premium) return { error: json(403, { error: SUBSCRIPTION_REQUIRED, code: 'subscription_required' }) };
  return { config: cfg.config, auth };
}

const SUBSCRIPTION_REQUIRED = 'O concierge de voz é exclusivo para assinantes Classify+.';

// ------------------------------------------------------------------ sessão

/** Configuração da sessão realtime enviada ao gerar o token efêmero. */
export function realtimeSessionConfig(config: VoiceConfig, nowText: string) {
  return {
    type: 'realtime',
    model: config.model,
    instructions: voiceInstructions(nowText),
    output_modalities: ['audio'],
    max_output_tokens: 1024,
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: config.transcribeModel, language: 'pt' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: config.voice },
    },
    tools: VOICE_TOOLS,
    tool_choice: 'auto',
  };
}

interface StartSessionResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  session_id?: string;
  expires_at?: string;
  max_seconds?: number;
}

export function createSessionHandlers(deps: VoiceDeps = defaultDeps) {
  async function POST(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const { config, auth } = g;

    const start = await auth.db.rpc('voice_start_session', { p_model: config.model });
    if (start.error) {
      log.error('[voice] rate limit', start.error.message);
      return json(503, { error: 'Controle de uso indisponível. Aplique a migração supabase/migrations/0005_voice_assistant.sql.', code: 'quota_unavailable' });
    }
    const s = start.data as StartSessionResult;
    if (s.reason === 'subscription_required') return json(403, { error: SUBSCRIPTION_REQUIRED, code: 'subscription_required' });
    if (!s.allowed || !s.session_id) {
      const error =
        s.reason === 'hourly'
          ? `Você atingiu o limite de ${s.limit} conversas por hora com o concierge. Tente mais tarde.`
          : `Você atingiu o limite de ${s.limit} conversas por dia com o concierge. Volte amanhã!`;
      return json(429, { error, code: 'rate_limited' });
    }

    const now = nowContext(deps.now());
    let res: Response;
    try {
      res = await deps.fetch(OPENAI_CLIENT_SECRETS_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: VOICE_LIMITS.clientSecretTtlSeconds },
          session: realtimeSessionConfig(config, now.text),
        }),
        cache: 'no-store',
      });
    } catch (err) {
      log.error('[voice] openai fetch', err instanceof Error ? err.message : err);
      await auth.db.rpc('voice_end_session', { p_session: s.session_id, p_status: 'failed' });
      return json(502, { error: 'Não foi possível conectar ao serviço de voz.', code: 'upstream' });
    }

    const body = (await res.json().catch(() => null)) as { value?: unknown; expires_at?: unknown; error?: { code?: string; type?: string } } | null;
    if (!res.ok || typeof body?.value !== 'string') {
      // Nunca repassamos o corpo de erro da OpenAI ao cliente (nem logamos a mensagem, que pode citar a chave).
      log.error('[voice] openai client_secrets', res.status, body?.error?.code ?? body?.error?.type ?? '');
      await auth.db.rpc('voice_end_session', { p_session: s.session_id, p_status: 'failed' });
      const code = res.status === 401 ? 'not_configured' : res.status === 429 ? 'upstream_busy' : 'upstream';
      const error = res.status === 429 ? 'O serviço de voz está ocupado. Tente em instantes.' : 'O serviço de voz está indisponível no momento.';
      return json(res.status === 429 ? 503 : 502, { error, code });
    }

    const out: VoiceSessionResponse = {
      client_secret: body.value,
      client_secret_expires_at: Number(body.expires_at) || Math.floor(deps.now().getTime() / 1000) + VOICE_LIMITS.clientSecretTtlSeconds,
      session_id: s.session_id,
      session_expires_at: String(s.expires_at),
      max_seconds: Number(s.max_seconds) || 600,
      model: config.model,
    };
    return json(200, out as unknown as Record<string, unknown>);
  }

  async function DELETE(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!z.string().uuid().safeParse(id).success) return json(400, { error: 'Sessão inválida.', code: 'invalid_input' });
    await g.auth.db.rpc('voice_end_session', { p_session: id, p_status: 'ended' });
    return json(200, { ok: true });
  }

  return { POST, DELETE };
}

// ------------------------------------------------------------------ tool calls

const toolRequest = z.object({
  session_id: z.string().uuid(),
  name: z.string().min(1).max(64),
  arguments: z.string().max(VOICE_LIMITS.maxToolArgsChars).default('{}'),
});

const TOOL_DENIED: Record<string, [number, string]> = {
  not_found: [403, 'Sessão de voz não encontrada.'],
  ended: [410, 'A sessão de voz foi encerrada.'],
  expired: [410, 'A sessão de voz expirou.'],
  tool_limit: [429, 'Limite de consultas desta sessão atingido.'],
  subscription_required: [403, 'O concierge de voz é exclusivo para assinantes Classify+.'],
  unauthenticated: [401, 'Entre na sua conta para falar com o concierge.'],
};

export function createToolHandler(deps: VoiceDeps = defaultDeps) {
  return async function POST(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const { config, auth } = g;

    const parsed = toolRequest.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(400, { error: 'Requisição inválida.', code: 'invalid_input' });
    const { session_id, name } = parsed.data;

    let args: unknown;
    try {
      args = JSON.parse(parsed.data.arguments || '{}');
    } catch {
      return json(422, { error: 'Argumentos da ferramenta não são JSON válido.', code: 'invalid_arguments', output: { erro: 'Argumentos não são JSON válido.' } });
    }

    // A sessão precisa ser do usuário, estar ativa e dentro do limite de duração/consultas.
    const reg = await auth.db.rpc('voice_register_tool_call', { p_session: session_id });
    if (reg.error) {
      log.error('[voice] register tool', reg.error.message);
      return json(503, { error: 'Controle de uso indisponível.', code: 'quota_unavailable' });
    }
    const r = reg.data as { allowed: boolean; reason?: string };
    if (!r.allowed) {
      const [status, error] = TOOL_DENIED[r.reason ?? ''] ?? [403, 'Consulta não permitida.'];
      return json(status, { error, code: r.reason ?? 'denied' });
    }

    try {
      const data = deps.dataFor(auth, config, nowContext(deps.now()).today);
      const result = await executeVoiceTool(name, args, data);
      return json(200, result as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof ToolInputError) {
        // Devolvido ao modelo para que ele corrija os argumentos.
        return json(422, { error: err.message, code: 'invalid_arguments', output: { erro: err.message, detalhes: err.issues } });
      }
      log.error('[voice] tool', name, err instanceof Error ? err.message : err);
      const msg = err instanceof DataError ? 'Falha ao consultar o banco do Classify DJ.' : 'Erro ao executar a consulta.';
      return json(500, { error: msg, code: 'tool_failed', output: { erro: msg } });
    }
  };
}

// ------------------------------------------------------------------ transcrições (opt-in)

const cardSchema = z.object({
  tipo: z.enum(['casa', 'evento', 'dj']),
  id: z.string().max(120),
  nome: z.string().max(200),
  // Só links internos conhecidos (nada de javascript:, //host ou URLs externas).
  url: z.string().max(400).regex(/^\/(boates|eventos)\/[a-z0-9-]+$|^\/eventos\?dj=[A-Za-z0-9%._~-]{1,360}$/),
  subtitulo: z.string().max(200).nullable(),
  nota: z.number().nullable(),
  num_reviews: z.number().nullable(),
  preco: z.number().nullable(),
  data: z.string().max(10).nullable(),
  demo: z.boolean(),
});

const transcriptRequest = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(VOICE_LIMITS.maxTranscriptChars),
  cards: z.array(cardSchema).max(10).default([]),
});

export function conversationTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return (t.length > 60 ? `${t.slice(0, 57)}…` : t) || 'Conversa por voz';
}

export function createTranscriptHandlers(deps: VoiceDeps = defaultDeps) {
  async function POST(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const { db, userId } = g.auth;
    const p = transcriptRequest.safeParse(await req.json().catch(() => null));
    if (!p.success) return json(400, { error: 'Transcrição inválida.', code: 'invalid_input' });

    let id = p.data.conversation_id ?? null;
    if (id) {
      const { data } = await db.from('ai_conversations').select('id').eq('id', id).maybeSingle();
      if (!data) id = null; // não é do usuário (RLS) ou foi apagada: cria outra
    }
    if (!id) {
      const { data, error } = await db
        .from('ai_conversations')
        .insert({ user_id: userId, title: conversationTitle(p.data.content), channel: 'voice' })
        .select('id')
        .single();
      if (error) return json(503, { error: 'Não foi possível salvar a conversa.', code: 'database' });
      id = String(data.id);
    }
    const { error } = await db.from('ai_messages').insert({ conversation_id: id, user_id: userId, role: p.data.role, content: p.data.content, sources: p.data.cards });
    if (error) return json(503, { error: 'Não foi possível salvar a conversa.', code: 'database' });
    return json(200, { conversation_id: id });
  }

  async function GET(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const id = new URL(req.url).searchParams.get('conversationId');
    if (!id) {
      const { data, error } = await g.auth.db.from('ai_conversations').select('id, title, channel, updated_at').order('updated_at', { ascending: false }).limit(30);
      if (error) return json(503, { error: 'Não foi possível carregar suas conversas.', code: 'database' });
      return json(200, { conversations: data ?? [] });
    }
    if (!z.string().uuid().safeParse(id).success) return json(400, { error: 'Conversa inválida.', code: 'invalid_input' });
    const { data, error } = await g.auth.db.from('ai_messages').select('role, content, sources, created_at').eq('conversation_id', id).order('created_at').limit(400);
    if (error) return json(503, { error: 'Não foi possível carregar a conversa.', code: 'database' });
    return json(200, { messages: data ?? [] });
  }

  async function DELETE(req: Request): Promise<Response> {
    const g = await guard(req, deps);
    if (g.error) return g.error;
    const id = new URL(req.url).searchParams.get('conversationId') ?? '';
    if (!z.string().uuid().safeParse(id).success) return json(400, { error: 'Informe a conversa.', code: 'invalid_input' });
    const { error } = await g.auth.db.from('ai_conversations').delete().eq('id', id);
    if (error) return json(503, { error: 'Não foi possível apagar a conversa.', code: 'database' });
    return json(200, { ok: true });
  }

  return { POST, GET, DELETE };
}
