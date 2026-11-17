'use client';
/**
 * Cliente HTTP do concierge de voz. Fala só com as rotas do próprio site —
 * a OPENAI_API_KEY nunca chega ao navegador (recebemos apenas um token efêmero).
 */
import type { VoiceCard, VoiceSessionResponse, VoiceToolResponse } from '@/lib/voice/shared';
import { getDataService } from './index';
import { SupabaseService } from './supabase-service';

export class VoiceClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    /** Saída a devolver ao modelo quando a falha é de uma tool call. */
    readonly output?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** O concierge usa apenas dados reais: exige o Supabase configurado. */
export const voiceAvailableInThisMode = () => getDataService() instanceof SupabaseService;

async function accessToken(): Promise<string> {
  const data = getDataService();
  if (!(data instanceof SupabaseService)) throw new VoiceClientError('O concierge de voz precisa do banco de dados real (Supabase) configurado.', 'not_configured');
  const { data: s } = await data.client.auth.getSession();
  if (!s.session) throw new VoiceClientError('Entre na sua conta para falar com o concierge.', 'unauthenticated', 401);
  return s.session.access_token;
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    keepalive: method === 'DELETE',
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; output?: Record<string, unknown> } & T;
  if (!res.ok) throw new VoiceClientError(json.error ?? `Erro ${res.status}`, json.code, res.status, json.output);
  return json;
}

export const startVoiceSession = () => request<VoiceSessionResponse>('POST', '/api/voice/session');
export const endVoiceSession = (id: string) => request<{ ok: true }>('DELETE', `/api/voice/session?id=${encodeURIComponent(id)}`).catch(() => undefined);
export const runVoiceTool = (sessionId: string, name: string, args: string) =>
  request<VoiceToolResponse>('POST', '/api/voice/tool', { session_id: sessionId, name, arguments: args });

export interface VoiceConversationSummary {
  id: string;
  title: string;
  channel: 'text' | 'voice';
  updated_at: string;
}

export interface SavedMessage {
  role: 'user' | 'assistant';
  content: string;
  sources: VoiceCard[];
  created_at: string;
}

export const saveTranscript = (input: { conversation_id: string | null; role: 'user' | 'assistant'; content: string; cards: VoiceCard[] }) =>
  request<{ conversation_id: string }>('POST', '/api/voice/transcripts', input).then((r) => r.conversation_id);
export const listVoiceConversations = () => request<{ conversations: VoiceConversationSummary[] }>('GET', '/api/voice/transcripts').then((r) => r.conversations);
export const loadVoiceConversation = (id: string) =>
  request<{ messages: SavedMessage[] }>('GET', `/api/voice/transcripts?conversationId=${encodeURIComponent(id)}`).then((r) => r.messages);
export const deleteVoiceConversation = (id: string) => request<{ ok: true }>('DELETE', `/api/voice/transcripts?conversationId=${encodeURIComponent(id)}`);
