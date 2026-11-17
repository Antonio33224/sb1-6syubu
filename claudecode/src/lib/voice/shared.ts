/**
 * Tipos e funções puras compartilhados entre o servidor e o navegador
 * (sem dependências de servidor).
 */

/** Cartão clicável exibido acima do orbe, sempre vindo de um registro do banco. */
export interface VoiceCard {
  tipo: 'casa' | 'evento';
  /** slug do registro */
  id: string;
  nome: string;
  url: string;
  /** cidade (casa) ou nome da casa (evento) */
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
}

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
