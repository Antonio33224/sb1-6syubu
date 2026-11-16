/**
 * Ferramentas (tool use) que o Claude pode chamar para consultar o Classify DJ.
 * Todas são de LEITURA. Cada registro devolvido ao modelo é anotado aqui para
 * que o servidor possa vincular a resposta final aos registros reais do banco.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { CRITERIA, type VenueCategory } from '@/types';
import {
  VENUE_CATEGORIES,
  type ClassifyData,
  type EventQuery,
  type EventRecord,
  type VenueMatch,
  type VenueQuery,
  type VenueRecord,
  type VenueStatsRecord,
} from './data';

export interface SourceRecord {
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

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_catalog_overview',
    description:
      'Visão geral do catálogo real do Classify DJ: cidades com estabelecimentos cadastrados, categorias, estilos musicais existentes e quantidade de eventos futuros. Use para saber o que existe antes de filtrar ou quando o usuário pergunta em quais cidades a plataforma atua.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_venues',
    description:
      'Busca boates, festas recorrentes, festivais e experiências cadastrados no banco, com notas da comunidade (0–10, média geral e por critério), preços informados, estilos musicais, dias de funcionamento e localização. Todos os filtros são opcionais. Para estilos, inclua variações relacionadas (ex.: "eletrônica" → ["Eletrônica", "House", "Techno"]). keywords serve para ambiente/perfil (ex.: "sofisticado", "rooftop", "LGBTQIA+") e ordenam os resultados, sem excluir. Preços e dias não informados no banco vêm como null e NÃO são excluídos, a menos que only_known_prices=true.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'Cidade, ex.: "São Paulo".' },
        state: { type: 'string', description: 'UF com 2 letras, ex.: "SP".' },
        neighborhood: { type: 'string', description: 'Bairro.' },
        category: { type: 'string', enum: VENUE_CATEGORIES },
        music_styles: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        max_budget: { type: 'number', description: 'Orçamento máximo por pessoa em reais (compara com o menor gasto informado: gasto mínimo, média de gasto ou entrada).' },
        only_known_prices: { type: 'boolean', description: 'Excluir locais sem preço informado.' },
        days: { type: 'array', items: { type: 'string' }, description: 'Dias da semana em português, ex.: ["sábado"].', maxItems: 7 },
        keywords: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        min_rating: { type: 'number', minimum: 0, maximum: 10 },
        use_my_ranking: { type: 'boolean', description: 'Ordenar também pela nota personalizada do Meu Ranking (Classify+) do usuário, se ele tiver um preset ativo.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_events',
    description:
      'Busca eventos futuros cadastrados (data, horário, line-up de DJs, estilos, preço do ingresso e casa onde acontecem). Datas no formato AAAA-MM-DD; eventos passados nunca são retornados. Use para pedidos com dia específico ("sábado", "esse fim de semana") convertendo para datas a partir da data de hoje informada no sistema.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        date_from: { type: 'string', description: 'AAAA-MM-DD (padrão: hoje).' },
        date_to: { type: 'string', description: 'AAAA-MM-DD.' },
        music_styles: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        dj: { type: 'string', description: 'Nome (ou parte) de um DJ/artista do line-up.' },
        max_price: { type: 'number', description: 'Preço máximo do ingresso em reais. Ingressos sem preço informado não são excluídos.' },
        venue_slug: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        limit: { type: 'integer', minimum: 1, maximum: 15 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_venue_details',
    description:
      'Detalhes completos de um estabelecimento pelo slug retornado em search_venues: endereço, preços, notas por critério, próximos eventos e trechos de avaliações recentes publicadas.',
    input_schema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_my_preferences',
    description:
      'Preferências privadas do usuário logado: cidade do perfil, preset ativo do Meu Ranking (Classify+) com pesos por critério, casas e eventos favoritos e DJs/artistas seguidos. Use para personalizar sem perguntar o que já está salvo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// ------------------------------------------------------------------ validação de entrada

type Input = Record<string, unknown>;
const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const arr = (v: unknown, maxItems: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, maxItems).map((x) => x.trim().slice(0, 60)) : undefined;
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export function parseVenueQuery(i: Input): VenueQuery & { use_my_ranking: boolean } {
  const category = VENUE_CATEGORIES.includes(i.category as VenueCategory) ? (i.category as VenueCategory) : undefined;
  return {
    city: str(i.city),
    state: str(i.state, 2),
    neighborhood: str(i.neighborhood),
    category,
    music_styles: arr(i.music_styles, 8),
    max_budget: num(i.max_budget, 0, 100000),
    only_known_prices: i.only_known_prices === true,
    days: arr(i.days, 7),
    keywords: arr(i.keywords, 6),
    min_rating: num(i.min_rating, 0, 10),
    limit: num(i.limit, 1, 10),
    use_my_ranking: i.use_my_ranking === true,
  };
}

export function parseEventQuery(i: Input): EventQuery {
  return {
    city: str(i.city),
    date_from: date(i.date_from),
    date_to: date(i.date_to),
    music_styles: arr(i.music_styles, 8),
    dj: str(i.dj),
    max_price: num(i.max_price, 0, 100000),
    venue_slug: str(i.venue_slug, 120),
    keywords: arr(i.keywords, 6),
    limit: num(i.limit, 1, 15),
  };
}

// ------------------------------------------------------------------ serialização para o modelo

const CRITERIA_LABELS = Object.fromEntries(CRITERIA.map((c) => [c.key, c.label]));

function statsView(s: VenueStatsRecord) {
  return {
    review_count: s.review_count,
    avg_rating: s.avg_rating,
    criteria: Object.fromEntries(Object.entries(s.criteria).map(([k, v]) => [CRITERIA_LABELS[k] ?? k, v])),
  };
}

function venueView(v: VenueRecord, extended = false) {
  return {
    slug: v.slug,
    name: v.name,
    category: v.category,
    city: v.city,
    state: v.state,
    neighborhood: v.neighborhood || null,
    ...(extended ? { address: v.address || null, capacity: v.capacity } : {}),
    description: extended ? v.description.slice(0, 800) : v.description.slice(0, 280),
    music_styles: v.music_styles,
    opening_days: v.opening_days.length ? v.opening_days : null,
    hours: v.opens_at || v.closes_at ? `${v.opens_at ?? '?'}–${v.closes_at ?? '?'}` : null,
    audience: v.audience_tags.length ? v.audience_tags : null,
    price_level: v.price_range ? '$'.repeat(v.price_range) : null,
    prices_brl: v.prices,
    classify_approved: v.approved,
    indicated_by_curators: v.is_indicated,
    ...(v.is_demo ? { demo_record: true } : {}),
  };
}

function eventView(e: EventRecord) {
  return {
    slug: e.slug,
    name: e.name,
    date: e.event_date,
    start_time: e.start_time || null,
    djs: e.dj_names,
    music_styles: e.music_styles,
    ticket_price_brl: e.ticket_price,
    description: e.description.slice(0, 280),
    venue: e.venue ? { slug: e.venue.slug, name: e.venue.name, city: e.venue.city, neighborhood: e.venue.neighborhood || null } : null,
    ...(e.is_demo ? { demo_record: true } : {}),
  };
}

// ------------------------------------------------------------------ execução

export class ToolExecutor {
  /** Registros reais devolvidos ao modelo nesta interação (chave tipo:slug). */
  readonly seen = new Map<string, SourceRecord>();

  constructor(private data: ClassifyData) {}

  private noteVenue(v: VenueRecord, avg: number | null) {
    this.seen.set(`venue:${v.slug}`, {
      type: 'venue', id: v.id, slug: v.slug, name: v.name, url: `/boates/${v.slug}`, city: v.city, avg_rating: avg, is_demo: v.is_demo,
    });
  }

  private noteEvent(e: EventRecord) {
    this.seen.set(`event:${e.slug}`, {
      type: 'event', id: e.id, slug: e.slug, name: e.name, url: `/eventos/${e.slug}`, venue_name: e.venue?.name, event_date: e.event_date, is_demo: e.is_demo,
    });
    if (e.venue) this.noteVenue(e.venue, null);
  }

  async run(name: string, input: unknown): Promise<unknown> {
    const i = (input && typeof input === 'object' ? input : {}) as Input;
    switch (name) {
      case 'get_catalog_overview':
        return this.data.catalogOverview();

      case 'search_venues': {
        const { use_my_ranking, ...q } = parseVenueQuery(i);
        const res = await this.data.searchVenues(q, use_my_ranking);
        res.items.forEach((m: VenueMatch) => this.noteVenue(m.venue, m.stats.avg_rating));
        return {
          total_matches: res.total,
          returned: res.items.length,
          my_ranking_preset: res.my_ranking_applied,
          results: res.items.map((m) => ({
            ...venueView(m.venue),
            community: statsView(m.stats),
            personal_score: m.personal_score,
            matched_keywords: m.matched_keywords,
            price_informed: m.price_known,
            opening_days_informed: m.days_known,
          })),
        };
      }

      case 'search_events': {
        const res = await this.data.searchEvents(parseEventQuery(i));
        res.items.forEach((e) => this.noteEvent(e));
        return { total_matches: res.total, returned: res.items.length, date_from: res.date_from, date_to: res.date_to, results: res.items.map(eventView) };
      }

      case 'get_venue_details': {
        const slug = str(i.slug, 120);
        if (!slug) throw new ToolInputError('Informe o slug do estabelecimento.');
        const d = await this.data.venueDetails(slug);
        if (!d) return { found: false, message: `Nenhum estabelecimento com slug "${slug}" no banco.` };
        this.noteVenue(d.venue, d.stats.avg_rating);
        d.upcoming_events.forEach((e) => this.noteEvent({ ...e, venue: d.venue }));
        return {
          found: true,
          ...venueView(d.venue, true),
          community: statsView(d.stats),
          upcoming_events: d.upcoming_events.map((e) => eventView({ ...e, venue: null })),
          recent_reviews: d.recent_reviews,
        };
      }

      case 'get_my_preferences': {
        const p = await this.data.preferences();
        return {
          profile_city: p.profile_city,
          my_ranking: p.active_preset
            ? { preset: p.active_preset.name, weights: Object.fromEntries(Object.entries(p.active_preset.weights).map(([k, v]) => [CRITERIA_LABELS[k] ?? k, v])) }
            : null,
          favorite_venues: p.favorite_venues,
          favorite_events: p.favorite_events,
          followed_artists: p.followed_artists,
        };
      }

      default:
        throw new ToolInputError(`Ferramenta desconhecida: ${name}`);
    }
  }
}

export class ToolInputError extends Error {}
