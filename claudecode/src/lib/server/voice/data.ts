/**
 * Camada de consulta do concierge de voz ao banco real (Supabase).
 *
 * - Usa o token do próprio usuário: todas as consultas passam pela RLS.
 * - SOMENTE LEITURA: nada aqui grava em tabelas do catálogo, avaliações ou configurações.
 * - Consultas parametrizadas pelo query builder do supabase-js (nunca SQL concatenado).
 * - Valores não informados no banco são devolvidos como null — nunca estimados.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VenueCategory } from '@/types';

type Row = Record<string, unknown>;

export const VENUE_CATEGORIES: VenueCategory[] = ['boate', 'festa', 'festival', 'experiencia'];

/** Teto de linhas lidas do banco por consulta (antes dos filtros em memória). */
export const MAX_SCAN_ROWS = { venues: 2000, events: 500, reviews: 50 } as const;

/** Minúsculas, sem acentos e espaços repetidos (espelha normalize_name no Postgres). */
export function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function userClient(url: string, anonKey: string, accessToken: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// ------------------------------------------------------------------ modelos

export interface VenueRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  city: string;
  state: string;
  neighborhood: string;
  address: string;
  price_range: number | null;
  prices: {
    avg_price: number | null;
    entry_min: number | null;
    entry_max: number | null;
    drink_min: number | null;
    drink_max: number | null;
    spend_min: number | null;
    spend_max: number | null;
  };
  music_styles: string[];
  opening_days: string[];
  audience_tags: string[];
  opens_at: string | null;
  closes_at: string | null;
  is_demo: boolean;
}

export interface VenueStatsRecord {
  review_count: number;
  avg_rating: number | null;
  score: number | null;
}

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  event_date: string;
  start_time: string;
  ticket_price: number | null;
  dj_names: string[];
  music_styles: string[];
  is_demo: boolean;
  venue: VenueRecord | null;
}

export interface ReviewRecord {
  overall_rating: number | null;
  comment: string;
  experience_date: string | null;
  created_at: string;
}

export function mapVenue(r: Row): VenueRecord {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    category: String(r.category ?? ''),
    description: String(r.description ?? ''),
    city: String(r.city ?? ''),
    state: String(r.state ?? ''),
    neighborhood: String(r.neighborhood ?? ''),
    address: String(r.address ?? ''),
    price_range: numOrNull(r.price_range),
    prices: {
      avg_price: numOrNull(r.avg_price),
      entry_min: numOrNull(r.entry_price_min),
      entry_max: numOrNull(r.entry_price_max),
      drink_min: numOrNull(r.drink_price_min),
      drink_max: numOrNull(r.drink_price_max),
      spend_min: numOrNull(r.spend_min),
      spend_max: numOrNull(r.spend_max),
    },
    music_styles: strArr(r.music_styles),
    opening_days: strArr(r.opening_days),
    audience_tags: strArr(r.audience_tags),
    opens_at: (r.opens_at as string) ?? null,
    closes_at: (r.closes_at as string) ?? null,
    is_demo: Boolean(r.is_demo),
  };
}

export function mapStats(r: Row | undefined): VenueStatsRecord {
  if (!r) return { review_count: 0, avg_rating: null, score: null };
  const count = Number(r.review_count ?? 0);
  return {
    review_count: count,
    avg_rating: count > 0 ? numOrNull(r.avg_rating) : null,
    score: count > 0 ? numOrNull(r.score) : null,
  };
}

export function mapEvent(r: Row): EventRecord {
  const v = r.venue as Row | null | undefined;
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    event_date: String(r.event_date),
    start_time: String(r.start_time ?? ''),
    ticket_price: numOrNull(r.ticket_price),
    dj_names: strArr(r.dj_names),
    music_styles: strArr(r.music_styles),
    is_demo: Boolean(r.is_demo),
    venue: v ? mapVenue(v) : null,
  };
}

// ------------------------------------------------------------------ filtros (puros)

/** Menor gasto por pessoa informado no banco (null = não informado). */
export function venueMinSpend(v: VenueRecord): number | null {
  const p = v.prices;
  return p.spend_min ?? p.avg_price ?? p.entry_min ?? null;
}

export type VenueSort = 'relevancia' | 'nota' | 'preco' | 'avaliacoes';

export interface VenueQuery {
  city?: string;
  category?: VenueCategory;
  music_styles?: string[];
  max_budget?: number;
  days?: string[];
  keywords?: string[];
  min_rating?: number;
  sort?: VenueSort;
  limit: number;
}

export interface VenueMatch {
  venue: VenueRecord;
  stats: VenueStatsRecord;
  matched_keywords: string[];
}

const styleMatches = (have: string[], want: string[]) => {
  const h = have.map(norm);
  return want.map(norm).some((w) => w && h.some((s) => s.includes(w) || w.includes(s)));
};

const cityMatches = (venueCity: string, wanted: string) => {
  const c = norm(venueCity);
  return c.includes(wanted) || wanted.includes(c);
};

export function filterVenues(rows: { venue: VenueRecord; stats: VenueStatsRecord }[], q: VenueQuery): { total: number; items: VenueMatch[] } {
  const city = q.city ? norm(q.city) : '';
  const days = (q.days ?? []).map(norm).filter(Boolean);
  const keywords = (q.keywords ?? []).map(norm).filter(Boolean);

  const out: VenueMatch[] = [];
  for (const { venue: v, stats } of rows) {
    if (city && !cityMatches(v.city, city)) continue;
    if (q.category && v.category !== q.category) continue;
    if (q.music_styles?.length && !styleMatches(v.music_styles, q.music_styles)) continue;
    // Orçamento: casas sem preço informado não são excluídas (o preço vem como null e a IA avisa).
    const spend = venueMinSpend(v);
    if (q.max_budget !== undefined && spend !== null && spend > q.max_budget) continue;
    const openDays = v.opening_days.map(norm);
    if (days.length && openDays.length && !days.some((d) => openDays.some((o) => o.includes(d)))) continue;
    if (q.min_rating !== undefined && (stats.avg_rating === null || stats.avg_rating < q.min_rating)) continue;

    const haystack = norm([v.name, v.description, v.neighborhood, v.audience_tags.join(' '), v.music_styles.join(' ')].join(' '));
    out.push({ venue: v, stats, matched_keywords: keywords.filter((k) => haystack.includes(k)) });
  }

  const byScore = (a: VenueMatch, b: VenueMatch) => (b.stats.score ?? -1) - (a.stats.score ?? -1);
  const byName = (a: VenueMatch, b: VenueMatch) => a.venue.name.localeCompare(b.venue.name);
  const sorters: Record<VenueSort, (a: VenueMatch, b: VenueMatch) => number> = {
    relevancia: (a, b) => b.matched_keywords.length - a.matched_keywords.length || byScore(a, b) || b.stats.review_count - a.stats.review_count || byName(a, b),
    nota: (a, b) => (b.stats.avg_rating ?? -1) - (a.stats.avg_rating ?? -1) || b.stats.review_count - a.stats.review_count || byName(a, b),
    // Sem preço informado vai para o fim.
    preco: (a, b) => (venueMinSpend(a.venue) ?? Infinity) - (venueMinSpend(b.venue) ?? Infinity) || byScore(a, b) || byName(a, b),
    avaliacoes: (a, b) => b.stats.review_count - a.stats.review_count || byScore(a, b) || byName(a, b),
  };
  out.sort(sorters[q.sort ?? 'relevancia']);
  return { total: out.length, items: out.slice(0, q.limit) };
}

export interface EventQuery {
  city?: string;
  date_from?: string;
  date_to?: string;
  music_styles?: string[];
  dj?: string;
  /** Nomes normalizados de DJs (qualquer um deles no line-up). */
  dj_keys?: string[];
  max_price?: number;
  venue_slug?: string;
  limit: number;
}

export function filterEvents(rows: EventRecord[], q: EventQuery): { total: number; items: EventRecord[] } {
  const city = q.city ? norm(q.city) : '';
  const dj = q.dj ? norm(q.dj) : '';
  const djKeys = new Set(q.dj_keys ?? []);
  const out = rows.filter((e) => {
    if (city && !(e.venue && cityMatches(e.venue.city, city))) return false;
    if (q.venue_slug && e.venue?.slug !== q.venue_slug) return false;
    if (q.music_styles?.length && !styleMatches([...e.music_styles, ...(e.venue?.music_styles ?? [])], q.music_styles)) return false;
    if (dj && !e.dj_names.some((n) => norm(n).includes(dj))) return false;
    if (q.dj_keys && !e.dj_names.some((n) => djKeys.has(norm(n)))) return false;
    if (q.max_price !== undefined && e.ticket_price !== null && e.ticket_price > q.max_price) return false;
    return true;
  });
  out.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time));
  return { total: out.length, items: out.slice(0, q.limit) };
}

// ------------------------------------------------------------------ acesso ao banco

export class DataError extends Error {}

function check(error: { message: string } | null, what: string) {
  if (error) throw new DataError(`Falha ao consultar ${what}: ${error.message}`);
}

/** Acesso de leitura ao catálogo real, sempre como o usuário autenticado. */
export class ClassifyData {
  constructor(
    private db: SupabaseClient,
    /** Id do usuário vindo da sessão autenticada — nunca de argumentos da IA. */
    private userId: string,
    private includeDemo: boolean,
    readonly today: string,
  ) {}

  /** Valores aceitos de is_demo: só registros reais, salvo VOICE_INCLUDE_DEMO=true. */
  private get demoValues() {
    return this.includeDemo ? [true, false] : [false];
  }

  private async venuesWithStats(): Promise<{ venue: VenueRecord; stats: VenueStatsRecord }[]> {
    const [{ data: venues, error: e1 }, { data: stats, error: e2 }] = await Promise.all([
      this.db.from('venues').select('*').in('is_demo', this.demoValues).limit(MAX_SCAN_ROWS.venues),
      this.db.from('venue_stats').select('venue_id, review_count, avg_rating, score').limit(MAX_SCAN_ROWS.venues),
    ]);
    check(e1, 'estabelecimentos');
    check(e2, 'notas');
    const byId = new Map((stats ?? []).map((s) => [String((s as Row).venue_id), s as Row]));
    return (venues ?? []).map((v) => ({ venue: mapVenue(v as Row), stats: mapStats(byId.get(String((v as Row).id))) }));
  }

  async searchVenues(q: VenueQuery) {
    return filterVenues(await this.venuesWithStats(), q);
  }

  async searchEvents(q: EventQuery) {
    const from = q.date_from && q.date_from > this.today ? q.date_from : this.today;
    let query = this.db.from('events').select('*, venue:venues(*)').in('is_demo', this.demoValues).gte('event_date', from).order('event_date').limit(MAX_SCAN_ROWS.events);
    if (q.date_to) query = query.lte('event_date', q.date_to);
    const { data, error } = await query;
    check(error, 'eventos');
    const rows = (data ?? []).map((r) => mapEvent(r as Row)).filter((e) => this.includeDemo || !e.venue?.is_demo);
    return { ...filterEvents(rows, q), date_from: from, date_to: q.date_to ?? null };
  }

  private async venueBySlug(slug: string): Promise<VenueRecord | null> {
    const { data, error } = await this.db.from('venues').select('*').in('is_demo', this.demoValues).eq('slug', slug).maybeSingle();
    check(error, 'estabelecimento');
    return data ? mapVenue(data as Row) : null;
  }

  async venueDetails(slug: string) {
    const venue = await this.venueBySlug(slug);
    if (!venue) return null;
    const { data: stats, error } = await this.db.from('venue_stats').select('venue_id, review_count, avg_rating, score').eq('venue_id', venue.id).maybeSingle();
    check(error, 'notas');
    return { venue, stats: mapStats((stats as Row) ?? undefined) };
  }

  /** Avaliações publicadas com comentário, das maiores notas para as menores. */
  async topReviews(slug: string, limit: number) {
    const venue = await this.venueBySlug(slug);
    if (!venue) return null;
    const { data, error } = await this.db
      .from('venue_reviews')
      .select('overall_rating, comment, experience_date, created_at')
      .eq('venue_id', venue.id)
      .eq('status', 'published')
      .neq('comment', '')
      .order('overall_rating', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, MAX_SCAN_ROWS.reviews));
    check(error, 'avaliações');
    const reviews: ReviewRecord[] = (data ?? []).map((r) => ({
      overall_rating: numOrNull((r as Row).overall_rating),
      comment: String((r as Row).comment ?? '').slice(0, 280),
      experience_date: ((r as Row).experience_date as string) ?? null,
      created_at: String((r as Row).created_at).slice(0, 10),
    }));
    return { venue, reviews };
  }

  /** DJs/artistas seguidos pelo usuário da SESSÃO (Classify+ → Alertas). */
  async followedArtists(): Promise<{ name: string; kind: string }[]> {
    const { data, error } = await this.db.from('user_favorites').select('name, kind').eq('user_id', this.userId).order('name').limit(100);
    check(error, 'artistas seguidos');
    return (data ?? []).map((a) => ({ name: String((a as Row).name), kind: String((a as Row).kind) }));
  }

  async eventsOfFollowedArtists(q: { date_from?: string; date_to?: string; limit: number }) {
    const artists = await this.followedArtists();
    if (!artists.length) return { artists, total: 0, items: [] as EventRecord[], date_from: q.date_from ?? this.today, date_to: q.date_to ?? null };
    const res = await this.searchEvents({ ...q, dj_keys: artists.map((a) => norm(a.name)) });
    return { artists, ...res };
  }
}
