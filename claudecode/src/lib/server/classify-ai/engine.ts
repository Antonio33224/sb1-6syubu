/**
 * Motor da Classify AI: conversa com o Claude pela API oficial da Anthropic
 * (Messages API, streaming) e executa as consultas ao banco que o modelo
 * pedir (tool use), até a resposta final.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ClassifyAIConfig } from './config';
import { SYSTEM_PROMPT } from './prompt';
import { TOOLS, ToolExecutor, ToolInputError, type SourceRecord } from './tools';
import { DataError, type ClassifyData } from './data';
import { citedSources } from './validate';

export type EngineEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; message: string }
  | { type: 'sources'; items: SourceRecord[] };

export interface EngineResult {
  text: string;
  sources: SourceRecord[];
  /** Todos os registros consultados (citados ou não). */
  consulted: SourceRecord[];
  toolCalls: { name: string; input: unknown; ok: boolean }[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
  stopReason: string | null;
}

const STATUS: Record<string, string> = {
  get_catalog_overview: 'Consultando o catálogo do Classify DJ…',
  search_venues: 'Buscando casas no banco do Classify DJ…',
  search_events: 'Buscando eventos na agenda…',
  get_venue_details: 'Abrindo os detalhes da casa…',
  get_my_preferences: 'Lendo suas preferências…',
};

export class EngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createAnthropicClient(config: ClassifyAIConfig) {
  // Timeout de 90 s por requisição; o SDK já faz até 2 novas tentativas em 408/429/5xx.
  return new Anthropic({ apiKey: config.apiKey, timeout: 90_000, maxRetries: 2 });
}

export async function runClassifyAI(opts: {
  client: Anthropic;
  config: ClassifyAIConfig;
  data: ClassifyData;
  messages: Anthropic.Beta.BetaMessageParam[];
  nowText: string;
  onEvent?: (e: EngineEvent) => void;
  signal?: AbortSignal;
}): Promise<EngineResult> {
  const { client, config, data, onEvent, signal } = opts;
  const messages = [...opts.messages];
  const tools = new ToolExecutor(data);
  const toolCalls: EngineResult['toolCalls'] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let text = '';
  let model = config.model;
  let stopReason: string | null = null;

  for (let round = 0; ; round++) {
    const lastRound = round >= config.maxToolRounds;
    const stream = client.beta.messages.stream(
      {
        model: config.model,
        max_tokens: config.maxTokens,
        // Conversa: esforço baixo mantém respostas ágeis e o custo controlado.
        output_config: { effort: 'low' },
        // Se o modelo principal recusar por política, a API repete no modelo de fallback.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        system: [
          { type: 'text', text: SYSTEM_PROMPT },
          { type: 'text', text: opts.nowText },
        ],
        // Na última rodada permitida, sem ferramentas: o modelo precisa responder com o que já consultou.
        ...(lastRound ? {} : { tools: TOOLS }),
        messages,
      },
      { signal },
    );

    let roundText = '';
    stream.on('text', (delta) => {
      if (!roundText && text && !/\s$/.test(text)) {
        text += '\n\n';
        onEvent?.({ type: 'text', text: '\n\n' });
      }
      roundText += delta;
      text += delta;
      onEvent?.({ type: 'text', text: delta });
    });

    const message = await stream.finalMessage();
    model = message.model ?? model;
    stopReason = message.stop_reason;
    usage.input_tokens += (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output_tokens += message.usage.output_tokens ?? 0;

    if (message.stop_reason === 'refusal') {
      throw new EngineError('refusal', 'O Claude não pôde responder a esta mensagem. Tente reformular seu pedido.');
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;
    if (lastRound) break;

    messages.push({ role: 'assistant', content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      onEvent?.({ type: 'status', message: STATUS[tu.name] ?? 'Consultando o banco…' });
      try {
        const out = await tools.run(tu.name, tu.input);
        toolCalls.push({ name: tu.name, input: tu.input, ok: true });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      } catch (err) {
        toolCalls.push({ name: tu.name, input: tu.input, ok: false });
        if (!(err instanceof DataError) && !(err instanceof ToolInputError)) throw err;
        console.error('[classify-ai] tool', tu.name, err.message);
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: err instanceof ToolInputError ? err.message : 'Não foi possível consultar o banco agora. Informe o usuário e não invente resultados.',
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  if (!text.trim()) throw new EngineError('empty_response', 'O Claude não retornou texto. Tente novamente.');

  const consulted = [...tools.seen.values()];
  const sources = citedSources(text, consulted);
  onEvent?.({ type: 'sources', items: sources });
  return { text, sources, consulted, toolCalls, usage, model, stopReason };
}

/** Traduz erros da API da Anthropic em mensagens reais e acionáveis (sem esconder a causa). */
export function describeError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof EngineError) return { status: 502, code: err.code, message: err.message };
  if (err instanceof Anthropic.APIUserAbortError) return { status: 499, code: 'aborted', message: 'Requisição cancelada.' };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 502, code: 'anthropic_auth', message: 'A API da Anthropic recusou a chave ANTHROPIC_API_KEY (401). Verifique a chave configurada no servidor.' };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, code: 'anthropic_permission', message: 'A chave da Anthropic não tem permissão para usar o modelo configurado (403).' };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { status: 502, code: 'anthropic_model', message: 'Modelo Claude configurado não encontrado (404). Revise CLASSIFY_AI_MODEL.' };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, code: 'anthropic_rate_limit', message: 'A Classify AI atingiu o limite de requisições da Anthropic. Tente novamente em instantes.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 502, code: 'anthropic_bad_request', message: `A API da Anthropic rejeitou a requisição (400): ${err.message}` };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return { status: 503, code: 'anthropic_unavailable', message: `O Claude está indisponível no momento (${err.status}). Tente novamente em instantes.` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 503, code: 'anthropic_connection', message: 'Não foi possível conectar à API da Anthropic. Tente novamente.' };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, code: 'anthropic_error', message: `Erro da API da Anthropic (${err.status ?? '?'}): ${err.message}` };
  }
  if (err instanceof DataError) return { status: 503, code: 'database', message: err.message };
  if (err instanceof Anthropic.AnthropicError) {
    return { status: 502, code: 'anthropic_invalid_response', message: 'Resposta inválida da API da Anthropic. Tente novamente.' };
  }
  return { status: 500, code: 'internal', message: 'Erro inesperado na Classify AI.' };
}
