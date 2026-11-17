/**
 * Ferramentas (function calling) do concierge de voz.
 *
 * - As definições abaixo vão na sessão realtime; a EXECUÇÃO acontece só no
 *   servidor (POST /api/voice/tool), com argumentos validados por zod.
 * - Todas são de LEITURA e devolvem apenas os campos necessários, com limite de linhas.
 * - Tudo o que é devolvido vem do banco (ClassifyData); nada é completado aqui.
 *
 * Para adicionar uma tool: crie o schema zod em `schemas`, a definição em
 * `VOICE_TOOLS` (mesmo nome) e o case em `executeVoiceTool`. Os testes
 * conferem que definições e schemas estão em sincronia.
 */
import { z } from 'zod';
import type { VenueCategory } from '@/types';
import { djKey, djUrl, type VoiceCard, type VoiceToolResponse } from '@/lib/voice/shared';
import { VENUE_CATEGORIES, venueMinSpend, type ClassifyData, type EventRecord, type VenueRecord, type VenueStatsRecord } from './data';

// ------------------------------------------------------------------ schemas (validação)

const text = (max = 60) => z.string().trim().min(1).max(max);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'data inválida');
const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,119}$/, 'casa_id inválido');
const styles = z
  .union([text(), z.array(text()).max(8)])
  .transform((v) => (Array.isArray(v) ? v : [v]));
const limit = (max: number, def: number) => z.number().int().min(1).max(max).default(def);
const dateRange = <T extends { data_inicio?: string; data_fim?: string }>(v: T) => !v.data_inicio || !v.data_fim || v.data_fim >= v.data_inicio;

/** Máximo de opções exibidas na tela de uma vez. */
export const MAX_DISPLAY_IDS = 8;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const schemas = {
  buscar_casas: z.object({
    cidade: text(80).optional(),
    estilo_musical: styles.optional(),
    faixa_preco_max: z.number().min(0).max(100000).optional(),
    clima: text(120).optional(),
    dia_semana: text(20).optional(),
    categoria: z.enum(VENUE_CATEGORIES as [VenueCategory, ...VenueCategory[]]).optional(),
    nota_minima: z.number().min(0).max(10).optional(),
    ordenar_por: z.enum(['relevancia', 'nota', 'preco', 'avaliacoes']).default('relevancia'),
    limite: limit(8, 5),
  }),
  buscar_eventos: z
    .object({
      cidade: text(80).optional(),
      data_inicio: isoDate.optional(),
      data_fim: isoDate.optional(),
      estilo_musical: styles.optional(),
      dj_nome: text(80).optional(),
      preco_max: z.number().min(0).max(100000).optional(),
      casa_id: slug.optional(),
      limite: limit(10, 6),
    })
    .refine(dateRange, 'data_fim deve ser igual ou posterior a data_inicio'),
  detalhes_casa: z.object({ casa_id: slug }),
  top_reviews: z.object({ casa_id: slug, limite: limit(5, 3) }),
  djs_seguidos_pelo_usuario: z.object({}),
  eventos_de_djs_seguidos: z
    .object({ data_inicio: isoDate.optional(), data_fim: isoDate.optional(), limite: limit(10, 6) })
    .refine(dateRange, 'data_fim deve ser igual ou posterior a data_inicio'),
  // Os ids NÃO são validados aqui de propósito: ids malformados ou inexistentes são descartados na execução.
  mostrar_opcoes: z.object({
    tipo: z.enum(['casa', 'evento', 'dj']),
    ids: z.array(z.string().max(200)).min(1).max(MAX_DISPLAY_IDS * 2),
    titulo: z.string().trim().max(80).optional(),
  }),
} as const;

export type VoiceToolName = keyof typeof schemas;
export const VOICE_TOOL_NAMES = Object.keys(schemas) as VoiceToolName[];
export const isVoiceToolName = (n: unknown): n is VoiceToolName => typeof n === 'string' && Object.prototype.hasOwnProperty.call(schemas, n);

// ------------------------------------------------------------------ definições (sessão realtime)

const dateProp = (d: string) => ({ type: 'string', description: `${d} no formato AAAA-MM-DD.` });
const stylesProp = {
  type: 'array',
  items: { type: 'string' },
  maxItems: 8,
  description: 'Estilos musicais. Inclua variações próximas (ex.: eletrônica → ["Eletrônica", "House", "Techno"]).',
};

export const VOICE_TOOLS = [
  {
    type: 'function',
    name: 'buscar_casas',
    description:
      'Busca boates, festas recorrentes, festivais e experiências cadastrados no Classify DJ, com nota média da comunidade (0–10), nº de reviews, preços informados e estilos. Todos os filtros são opcionais. Preços não informados vêm como null e não são excluídos.',
    parameters: {
      type: 'object',
      properties: {
        cidade: { type: 'string', description: 'Cidade, ex.: "São Paulo".' },
        estilo_musical: stylesProp,
        faixa_preco_max: { type: 'number', description: 'Gasto máximo por pessoa em reais.' },
        clima: { type: 'string', description: 'Ambiente/vibe em termos curtos separados por vírgula, ex.: "sofisticado, rooftop".' },
        dia_semana: { type: 'string', description: 'Dia de funcionamento, ex.: "sábado".' },
        categoria: { type: 'string', enum: VENUE_CATEGORIES },
        nota_minima: { type: 'number', minimum: 0, maximum: 10 },
        ordenar_por: { type: 'string', enum: ['relevancia', 'nota', 'preco', 'avaliacoes'] },
        limite: { type: 'integer', minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'buscar_eventos',
    description:
      'Busca eventos futuros cadastrados (data, horário, line-up, estilos, preço do ingresso e casa). Eventos passados nunca são retornados. Converta "sábado", "fim de semana" etc. em datas.',
    parameters: {
      type: 'object',
      properties: {
        cidade: { type: 'string' },
        data_inicio: dateProp('Data inicial (padrão: hoje)'),
        data_fim: dateProp('Data final'),
        estilo_musical: stylesProp,
        dj_nome: { type: 'string', description: 'Nome (ou parte) de um DJ/artista do line-up.' },
        preco_max: { type: 'number', description: 'Preço máximo do ingresso em reais.' },
        casa_id: { type: 'string', description: 'casa_id retornado por buscar_casas.' },
        limite: { type: 'integer', minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'detalhes_casa',
    description: 'Detalhes de uma casa pelo casa_id retornado em outra busca: nota média, nº de reviews, preços, estilos, dias, horário e endereço.',
    parameters: { type: 'object', properties: { casa_id: { type: 'string' } }, required: ['casa_id'], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'top_reviews',
    description: 'Melhores avaliações publicadas (com comentário) de uma casa, pelo casa_id.',
    parameters: {
      type: 'object',
      properties: { casa_id: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 5 } },
      required: ['casa_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'djs_seguidos_pelo_usuario',
    description: 'DJs e artistas que o usuário logado segue no Classify DJ.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'eventos_de_djs_seguidos',
    description: 'Próximos eventos com DJs/artistas que o usuário logado segue.',
    parameters: {
      type: 'object',
      properties: { data_inicio: dateProp('Data inicial (padrão: hoje)'), data_fim: dateProp('Data final'), limite: { type: 'integer', minimum: 1, maximum: 10 } },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'mostrar_opcoes',
    description:
      'Mostra NA TELA as opções que você vai falar (cartões clicáveis), sincronizadas com a sua fala. Chame SEMPRE antes de apresentar casas, eventos ou DJs ao usuário, com os ids exatamente como vieram das outras ferramentas (casa_id, evento_id ou dj_id), na ordem em que vai citá-los. Ids que não existirem no banco são descartados.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['casa', 'evento', 'dj'] },
        ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_DISPLAY_IDS, description: 'casa_id, evento_id ou dj_id retornados pelas buscas.' },
        titulo: { type: 'string', description: 'Título curto acima dos cartões, ex.: "Techno no sábado".' },
      },
      required: ['tipo', 'ids'],
      additionalProperties: false,
    },
  },
] as const satisfies readonly { type: 'function'; name: VoiceToolName; description: string; parameters: Record<string, unknown> }[];

// ------------------------------------------------------------------ erros

export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export function parseToolArgs<N extends VoiceToolName>(name: N, args: unknown): z.output<(typeof schemas)[N]> {
  const res = schemas[name].safeParse(args ?? {});
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join('.') || 'argumentos'}: ${i.message}`);
    throw new ToolInputError(`Argumentos inválidos para ${name}.`, issues);
  }
  return res.data as z.output<(typeof schemas)[N]>;
}

// ------------------------------------------------------------------ serialização (só campos necessários)

const demoFlag = (d: boolean) => (d ? { registro_demo: true } : {});

function venueView(v: VenueRecord, s: VenueStatsRecord) {
  return {
    casa_id: v.slug,
    nome: v.name,
    categoria: v.category,
    cidade: v.city,
    bairro: v.neighborhood || null,
    estilos: v.music_styles,
    nota_media: s.avg_rating,
    num_reviews: s.review_count,
    preco_reais: {
      gasto_min: v.prices.spend_min,
      gasto_max: v.prices.spend_max,
      entrada_min: v.prices.entry_min,
      entrada_max: v.prices.entry_max,
      media: v.prices.avg_price,
    },
    nivel_preco: v.price_range ? '$'.repeat(v.price_range) : null,
    dias: v.opening_days.length ? v.opening_days : null,
    ...demoFlag(v.is_demo),
  };
}

function eventView(e: EventRecord) {
  return {
    evento_id: e.slug,
    nome: e.name,
    data: e.event_date,
    horario: e.start_time || null,
    djs: e.dj_names.map((nome) => ({ dj_id: djKey(nome), nome })),
    estilos: e.music_styles,
    ingresso_reais: e.ticket_price,
    casa: e.venue ? { casa_id: e.venue.slug, nome: e.venue.name, cidade: e.venue.city, bairro: e.venue.neighborhood || null } : null,
    ...demoFlag(e.is_demo),
  };
}

const venueCard = (v: VenueRecord, s: VenueStatsRecord | null): VoiceCard => ({
  tipo: 'casa',
  id: v.slug,
  nome: v.name,
  url: `/boates/${v.slug}`,
  subtitulo: v.city || null,
  nota: s?.avg_rating ?? null,
  num_reviews: s ? s.review_count : null,
  preco: venueMinSpend(v),
  data: null,
  demo: v.is_demo,
});

const eventCard = (e: EventRecord): VoiceCard => ({
  tipo: 'evento',
  id: e.slug,
  nome: e.name,
  url: `/eventos/${e.slug}`,
  subtitulo: e.venue?.name ?? null,
  nota: null,
  num_reviews: null,
  preco: e.ticket_price,
  data: e.event_date,
  demo: e.is_demo,
});

const djCard = (d: { key: string; name: string; upcoming: number; next_date: string | null; followed: boolean }): VoiceCard => ({
  tipo: 'dj',
  id: d.key,
  nome: d.name,
  url: djUrl(d.name),
  subtitulo: d.upcoming ? `${d.upcoming} ${d.upcoming === 1 ? 'próximo evento' : 'próximos eventos'}` : d.followed ? 'Você segue' : null,
  nota: null,
  num_reviews: null,
  preco: null,
  data: d.next_date,
  demo: false,
});

const splitTerms = (s?: string) => (s ? s.split(/[,;]/).map((t) => t.trim()).filter(Boolean).slice(0, 6) : undefined);

// ------------------------------------------------------------------ execução

/** Métodos do banco usados pelas tools (permite testar com um banco falso). */
export type VoiceDataSource = Pick<
  ClassifyData,
  'searchVenues' | 'searchEvents' | 'venueDetails' | 'topReviews' | 'followedArtists' | 'eventsOfFollowedArtists' | 'venuesBySlugs' | 'eventsBySlugs' | 'djsByKeys'
>;

export async function executeVoiceTool(name: string, rawArgs: unknown, data: VoiceDataSource): Promise<VoiceToolResponse> {
  if (!isVoiceToolName(name)) throw new ToolInputError(`Ferramenta desconhecida: ${String(name).slice(0, 60)}`);

  switch (name) {
    case 'buscar_casas': {
      const a = parseToolArgs(name, rawArgs);
      const res = await data.searchVenues({
        city: a.cidade,
        category: a.categoria,
        music_styles: a.estilo_musical,
        max_budget: a.faixa_preco_max,
        keywords: splitTerms(a.clima),
        days: a.dia_semana ? [a.dia_semana] : undefined,
        min_rating: a.nota_minima,
        sort: a.ordenar_por,
        limit: a.limite,
      });
      return {
        output: { total_encontrado: res.total, retornados: res.items.length, resultados: res.items.map((m) => venueView(m.venue, m.stats)) },
        cards: res.items.map((m) => venueCard(m.venue, m.stats)),
      };
    }

    case 'buscar_eventos': {
      const a = parseToolArgs(name, rawArgs);
      const res = await data.searchEvents({
        city: a.cidade,
        date_from: a.data_inicio,
        date_to: a.data_fim,
        music_styles: a.estilo_musical,
        dj: a.dj_nome,
        max_price: a.preco_max,
        venue_slug: a.casa_id,
        limit: a.limite,
      });
      return {
        output: { total_encontrado: res.total, retornados: res.items.length, periodo: { de: res.date_from, ate: res.date_to }, resultados: res.items.map(eventView) },
        cards: res.items.map(eventCard),
      };
    }

    case 'detalhes_casa': {
      const a = parseToolArgs(name, rawArgs);
      const d = await data.venueDetails(a.casa_id);
      if (!d) return { output: { encontrado: false, mensagem: 'Nenhuma casa com esse casa_id no Classify DJ.' }, cards: [] };
      const v = d.venue;
      return {
        output: {
          encontrado: true,
          ...venueView(v, d.stats),
          endereco: v.address || null,
          horario: v.opens_at || v.closes_at ? `${v.opens_at ?? '?'}–${v.closes_at ?? '?'}` : null,
          publico: v.audience_tags.length ? v.audience_tags : null,
          preco_drinks_reais: { min: v.prices.drink_min, max: v.prices.drink_max },
          descricao: v.description.slice(0, 300) || null,
        },
        cards: [venueCard(v, d.stats)],
      };
    }

    case 'top_reviews': {
      const a = parseToolArgs(name, rawArgs);
      const r = await data.topReviews(a.casa_id, a.limite);
      if (!r) return { output: { encontrado: false, mensagem: 'Nenhuma casa com esse casa_id no Classify DJ.' }, cards: [] };
      return {
        output: {
          encontrado: true,
          casa: { casa_id: r.venue.slug, nome: r.venue.name },
          reviews: r.reviews.map((x) => ({ nota: x.overall_rating, comentario: x.comment, data: x.experience_date ?? x.created_at })),
        },
        cards: [venueCard(r.venue, null)],
      };
    }

    case 'djs_seguidos_pelo_usuario': {
      parseToolArgs(name, rawArgs);
      const artists = await data.followedArtists();
      return { output: { total: artists.length, seguidos: artists.map((x) => ({ dj_id: djKey(x.name), nome: x.name, tipo: x.kind })) }, cards: [] };
    }

    case 'eventos_de_djs_seguidos': {
      const a = parseToolArgs(name, rawArgs);
      const res = await data.eventsOfFollowedArtists({ date_from: a.data_inicio, date_to: a.data_fim, limit: a.limite });
      return {
        output: {
          djs_seguidos: res.artists.map((x) => x.name),
          djs_seguidos_ids: res.artists.map((x) => djKey(x.name)),
          total_encontrado: res.total,
          resultados: res.items.map(eventView),
          ...(res.artists.length ? {} : { mensagem: 'O usuário ainda não segue nenhum DJ no Classify DJ.' }),
        },
        cards: res.items.map(eventCard),
      };
    }

    case 'mostrar_opcoes': {
      const a = parseToolArgs(name, rawArgs);
      // Normaliza, remove duplicados e descarta ids malformados ANTES de consultar o banco.
      const requested = [...new Set(a.ids.map((i) => i.trim()))];
      const wellFormed = requested.filter((i) => ID_RE.test(i)).slice(0, MAX_DISPLAY_IDS);
      let cards: VoiceCard[];
      if (a.tipo === 'casa') cards = (await data.venuesBySlugs(wellFormed)).map((m) => venueCard(m.venue, m.stats));
      else if (a.tipo === 'evento') cards = (await data.eventsBySlugs(wellFormed)).map(eventCard);
      else cards = (await data.djsByKeys(wellFormed, djKey)).map(djCard);
      const shown = new Set(cards.map((c) => c.id));
      const discarded = requested.filter((i) => !shown.has(i));
      return {
        output: {
          exibidos: cards.map((c) => ({ id: c.id, nome: c.nome })),
          descartados: discarded.map((i) => i.slice(0, 60)),
          ...(cards.length
            ? { mensagem: 'Opções exibidas na tela. Cite-as pelos nomes acima, na mesma ordem.' }
            : { mensagem: 'Nenhum id existe no Classify DJ; nada foi exibido. Faça uma busca e use os ids retornados.' }),
        },
        cards,
        display: { titulo: a.titulo?.trim() || null },
      };
    }
  }
}
