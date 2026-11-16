/**
 * Validação da entrada do chat e montagem do histórico reenviado ao Claude
 * (com limites de tamanho para controlar tokens e custo).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { LIMITS } from './config';
import { norm } from './data';
import type { SourceRecord } from './tools';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history: ChatTurn[];
  conversationId: string | null;
  save: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {}

export function parseChatRequest(body: unknown): ChatRequest {
  if (!body || typeof body !== 'object') throw new ValidationError('Corpo da requisição inválido.');
  const b = body as Record<string, unknown>;

  const message = typeof b.message === 'string' ? b.message.replace(/\u0000/g, '').trim() : '';
  if (!message) throw new ValidationError('Escreva uma mensagem.');
  if (message.length > LIMITS.maxMessageChars) {
    throw new ValidationError(`A mensagem pode ter no máximo ${LIMITS.maxMessageChars} caracteres.`);
  }

  if (b.history !== undefined && !Array.isArray(b.history)) throw new ValidationError('Histórico inválido.');
  const history: ChatTurn[] = [];
  for (const t of (b.history as unknown[] | undefined) ?? []) {
    if (!t || typeof t !== 'object') throw new ValidationError('Histórico inválido.');
    const { role, content } = t as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') throw new ValidationError('Histórico inválido.');
    if (content.trim()) history.push({ role, content: content.replace(/\u0000/g, '') });
  }
  if (history.length > 200) throw new ValidationError('Histórico longo demais. Comece uma nova conversa.');

  const conversationId = typeof b.conversationId === 'string' && b.conversationId ? b.conversationId : null;
  if (conversationId && !UUID.test(conversationId)) throw new ValidationError('Conversa inválida.');

  return { message, history, conversationId, save: b.save !== false };
}

/**
 * Converte o histórico em mensagens da API: mantém só as mais recentes dentro
 * dos limites, garante alternância user/assistant e que a primeira seja do usuário.
 */
export function buildMessages(history: ChatTurn[], message: string): Anthropic.Beta.BetaMessageParam[] {
  const kept: ChatTurn[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0 && kept.length < LIMITS.maxHistoryMessages; i--) {
    const t = history[i];
    const content = t.content.length > LIMITS.maxHistoryItemChars ? `${t.content.slice(0, LIMITS.maxHistoryItemChars)}…` : t.content;
    if (chars + content.length > LIMITS.maxHistoryChars) break;
    chars += content.length;
    kept.unshift({ role: t.role, content });
  }
  // Mescla turnos consecutivos do mesmo papel e descarta o que vier antes do primeiro "user".
  const merged: ChatTurn[] = [];
  for (const t of kept) {
    const last = merged[merged.length - 1];
    if (!last && t.role !== 'user') continue;
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else merged.push({ ...t });
  }
  if (merged.length && merged[merged.length - 1].role === 'user') {
    merged[merged.length - 1].content += `\n\n${message}`;
  } else {
    merged.push({ role: 'user', content: message });
  }
  return merged.map((t) => ({ role: t.role, content: t.content }));
}

/**
 * Registros consultados que de fato aparecem na resposta final (por nome).
 * São estes que viram cartões com link — sempre ligados a um registro do banco.
 */
export function citedSources(text: string, seen: Iterable<SourceRecord>): SourceRecord[] {
  const t = norm(text);
  const out: SourceRecord[] = [];
  for (const s of seen) {
    const n = norm(s.name);
    if (n.length >= 3 && t.includes(n)) out.push(s);
  }
  // Eventos primeiro (mais específicos), depois casas; no máximo 8 cartões.
  return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'event' ? -1 : 1)).slice(0, 8);
}

export const conversationTitle = (message: string) => {
  const t = message.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'Nova conversa';
};
