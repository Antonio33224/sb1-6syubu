/**
 * Tipos e funções puras compartilhados entre o servidor e o navegador
 * (sem dependências de servidor).
 */

export type VoiceCardKind = 'casa' | 'evento' | 'dj';

/** Cartão clicável exibido acima do orbe, sempre vindo de um registro do banco. */
export interface VoiceCard {
  tipo: VoiceCardKind;
  /** slug do registro (casa/evento) ou dj_id (nome normalizado) */
  id: string;
  nome: string;
  url: string;
  /** cidade (casa), nome da casa (evento) ou "N próximos eventos" (DJ) */
  subtitulo: string | null;
  nota: number | null;
  num_reviews: number | null;
  /** menor preço informado em reais (gasto mínimo/entrada ou ingresso) */
  preco: number | null;
  /** AAAA-MM-DD (eventos) */
  data: string | null;
  demo: boolean;
}

export interface VoiceToolResponse {
  /** JSON devolvido ao modelo como function_call_output. */
  output: Record<string, unknown>;
  cards: VoiceCard[];
  /**
   * Presente só em `mostrar_opcoes`: os cartões devem aparecer NA HORA na tela
   * (substituindo os anteriores), sincronizados com a fala da IA.
   */
  display?: { titulo: string | null };
}

/**
 * Identificador estável de DJ/artista: nome sem acentos, minúsculo, com hífens.
 * "JOSÉ  Pérez" → "jose-perez". Não existe tabela de DJs: o id vem dos line-ups.
 */
export function djKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Página da agenda filtrada pelo DJ. */
export const djUrl = (name: string) => `/eventos?dj=${encodeURIComponent(name.slice(0, 120)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

export interface VoiceSessionResponse {
  client_secret: string;
  client_secret_expires_at: number;
  session_id: string;
  /** ISO — depois disso o servidor recusa tool calls. */
  session_expires_at: string;
  max_seconds: number;
  model: string;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Cartões citados na fala da IA (pelo nome do registro). Só mostramos o que foi
 * consultado no banco E mencionado — nunca um nome inventado vira cartão.
 */
export function citedCards(transcript: string, cards: VoiceCard[], max = 6): VoiceCard[] {
  const said = ` ${fold(transcript)} `;
  const seen = new Set<string>();
  const out: VoiceCard[] = [];
  for (const c of cards) {
    const key = `${c.tipo}:${c.id}`;
    const name = fold(c.nome);
    if (!name || seen.has(key) || !said.includes(` ${name} `)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
