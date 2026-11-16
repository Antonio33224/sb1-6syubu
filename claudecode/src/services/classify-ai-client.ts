'use client';
/**
 * Cliente da Classify AI no navegador. Fala apenas com a rota do próprio site
 * (/api/classify-ai/chat) — a chave da Anthropic nunca chega aqui.
 */
import { getDataService } from './index';
import { SupabaseService } from './supabase-service';

export interface AISource {
  type: 'venue' | 'event';
  id: string;
  slug: string;
  name: string;
  url: string;
  city?: string;
  venue_name?: string;
  event_date?: string;
  avg_rating?: number | null;
  is_demo?: boolean;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: AISource[];
}

export interface AIConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export type AIStreamEvent =
  | { type: 'meta'; model: string; remaining_hour?: number; remaining_day?: number }
  | { type: 'status'; message: string }
  | { type: 'text'; text: string }
  | { type: 'sources'; items: AISource[] }
  | { type: 'done'; conversationId: string | null; model: string; warning?: string }
  | { type: 'error'; code: string; error: string };

export class AIClientError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const ENDPOINT = '/api/classify-ai/chat';

/** A Classify AI usa apenas dados reais: exige o Supabase configurado. */
export const aiAvailableInThisMode = () => getDataService() instanceof SupabaseService;

async function token(): Promise<string> {
  const data = getDataService();
  if (!(data instanceof SupabaseService)) throw new AIClientError('A Classify AI precisa do banco de dados real (Supabase) configurado.', 'not_configured');
  const { data: s } = await data.client.auth.getSession();
  if (!s.session) throw new AIClientError('Entre na sua conta para conversar com a Classify AI.', 'unauthenticated');
  return s.session.access_token;
}

async function call<T>(method: 'GET' | 'DELETE', query: string): Promise<T> {
  const res = await fetch(`${ENDPOINT}${query}`, { method, headers: { authorization: `Bearer ${await token()}` }, cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) throw new AIClientError(json.error ?? `Erro ${res.status}`, json.code);
  return json;
}

export const listConversations = () => call<{ conversations: AIConversationSummary[] }>('GET', '').then((r) => r.conversations);
export const loadConversation = (id: string) =>
  call<{ messages: AIMessage[] }>('GET', `?conversationId=${encodeURIComponent(id)}`).then((r) => r.messages);
export const deleteConversation = (id: string) => call<{ ok: true }>('DELETE', `?conversationId=${encodeURIComponent(id)}`);

/** Envia uma mensagem e entrega os eventos do streaming conforme chegam. */
export async function sendMessage(
  input: { message: string; history: AIMessage[]; conversationId: string | null; save: boolean },
  onEvent: (e: AIStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
    body: JSON.stringify({
      message: input.message,
      history: input.history.map(({ role, content }) => ({ role, content })),
      conversationId: input.conversationId,
      save: input.save,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new AIClientError(json.error ?? `A Classify AI respondeu com erro ${res.status}.`, json.code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: AIStreamEvent;
      try {
        event = JSON.parse(line) as AIStreamEvent;
      } catch {
        throw new AIClientError('Resposta inválida do servidor da Classify AI.');
      }
      if (event.type === 'error') throw new AIClientError(event.error, event.code);
      if (event.type === 'done') finished = true;
      onEvent(event);
    }
    if (done) break;
  }
  if (!finished) throw new AIClientError('A conexão com a Classify AI foi interrompida antes do fim da resposta.');
}
