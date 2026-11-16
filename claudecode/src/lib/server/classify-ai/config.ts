/**
 * Configuração da Classify AI. SOMENTE NO SERVIDOR.
 *
 * A chave ANTHROPIC_API_KEY nunca deve ir para o navegador: não use
 * NEXT_PUBLIC_* para ela e não a coloque no código. Na Vercel, cadastre-a em
 * Project Settings → Environment Variables.
 */

/**
 * Modelo Claude padrão (identificador oficial da API da Anthropic).
 * Para trocar sem alterar código, defina CLASSIFY_AI_MODEL.
 */
export const DEFAULT_CLASSIFY_AI_MODEL = 'claude-opus-5-5';

export interface ClassifyAIConfig {
  apiKey: string;
  model: string;
  /** Teto de tokens de saída por chamada ao Claude (inclui o raciocínio interno). */
  maxTokens: number;
  /** Máximo de rodadas de ferramentas (consultas ao banco) por mensagem. */
  maxToolRounds: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Incluir registros demonstrativos (is_demo = true)? Padrão: não. */
  includeDemo: boolean;
}

export const LIMITS = {
  /** Caracteres por mensagem do usuário. */
  maxMessageChars: 2000,
  /** Mensagens anteriores reenviadas ao Claude (as mais recentes). */
  maxHistoryMessages: 20,
  /** Soma de caracteres do histórico reenviado. */
  maxHistoryChars: 24000,
  /** Caracteres por mensagem do histórico (respostas longas são cortadas para o contexto). */
  maxHistoryItemChars: 6000,
} as const;

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export type ConfigResult = { ok: true; config: ClassifyAIConfig } | { ok: false; missing: string[] };

export function classifyAIConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const required = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim(),
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      apiKey: required.ANTHROPIC_API_KEY!,
      model: env.CLASSIFY_AI_MODEL?.trim() || DEFAULT_CLASSIFY_AI_MODEL,
      maxTokens: int(env.CLASSIFY_AI_MAX_TOKENS, 8000, 1024, 32000),
      maxToolRounds: int(env.CLASSIFY_AI_MAX_TOOL_ROUNDS, 6, 1, 10),
      supabaseUrl: required.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseAnonKey: required.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      includeDemo: env.CLASSIFY_AI_INCLUDE_DEMO === 'true',
    },
  };
}

export function missingConfigMessage(missing: string[]): string {
  if (missing.includes('ANTHROPIC_API_KEY')) {
    return 'A Classify AI não está configurada: a variável de ambiente ANTHROPIC_API_KEY não foi definida no servidor.';
  }
  return `A Classify AI precisa do banco de dados real (Supabase). Variáveis ausentes: ${missing.join(', ')}.`;
}
