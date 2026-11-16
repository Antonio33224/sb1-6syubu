/**
 * Camada de consulta da Classify AI ao banco real (Supabase).
 *
 * - Usa o token do próprio usuário: todas as consultas passam pela RLS.
 * - SOMENTE LEITURA: nenhuma função aqui grava em tabelas do catálogo,
 *   avaliações ou configurações.
 * - Valores não informados no banco são devolvidos como null — nunca estimados.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CRITERIA, type CriteriaScores, type CriteriaWeights, type VenueCategory } from '@/types';
import { normalizeWeights, personalScore } from '@/lib/plus/personal-ranking';

type Row = Record<string, unknown>;

export const VENUE_CATEGORIES: VenueCategory[] = ['boate', 'festa', 'festival', 'experiencia'];

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
  capacity: number | null;
  opens_at: string | null;
  closes_at: string | null;
  is_indicated: boolean;
  approved: boolean;
  is_demo: boolean;
}

export interface VenueStatsRecord {
  review_count: number;
  avg_rating: number | null;
  score: number | null;
  criteria: Partial<CriteriaScores>;
}

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  event_date: string;
  start_time: string;
  ticket_price: number | null;
  ticket_url: string | null;
  dj_names: string[];
  music_styles: string[];
  is_demo: boolean;
  venue: VenueRecord | null;
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
    capacity: numOrNull(r.capacity),
    opens_at: (r.opens_at as string) ?? null,
    closes_at: (r.closes_at as string) ?? null,
    is_indicated: Boolean(r.is_indicated),
    approved: Boolean(r.approved),
    is_demo: Boolean(r.is_demo),
  };
}

export function mapStats(r: Row | undefined): VenueStatsRecord {
  if (!r) return { review_count: 0, avg_rating: null, score: null, criteria: {} };
  const count = Number(r.review_count ?? 0);
  const criteria: Partial<CriteriaScores> = {};
  for (const c of CRITERIA) {
    const v = numOrNull(r[c.key]);
    if (v !== null) criteria[c.key] = v;
  }
  return {
    review_count: count,
    avg_rating: count > 0 ? numOrNull(r.avg_rating) : null,
    score: count > 0 ? numOrNull(r.score) : null,
    criteria,
  };
}

export function mapEvent(r: Row): EventRecord {
  const v = r.venue as Row | null | undefined;
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    description: String(r.description ?? ''),
    event_date: String(r.event_date),
    start_time: String(r.start_time ?? ''),
    ticket_price: numOrNull(r.ticket_price),
    ticket_url: (r.ticket_url as string) ?? null,
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

export interface VenueQuery {
  city?: string;
  state?: string;
  neighborhood?: string;
  category?: VenueCategory;
  music_styles?: string[];
  max_budget?: number;
  only_known_prices?: boolean;
  days?: string[];
  keywords?: string[];
  min_rating?: number;
  limit?: number;
}

export interface VenueMatch {
  venue: VenueRecord;
  stats: VenueStatsRecord;
  personal_score: number | null;
  matched_keywords: string[];
  price_known: boolean;
  days_known: boolean;
}

const styleMatches = (have: string[], want: string[]) => {
  const h = have.map(norm);
  return want.map(norm).some((w) => w && h.some((s) => s.includes(w) || w.includes(s)));
};

export function filterVenues(
  rows: { venue: VenueRecord; stats: VenueStatsRecord }[],
  q: VenueQuery,
  weights: CriteriaWeights | null,
): { total: number; items: VenueMatch[] } {
  const city = q.city ? norm(q.city) : '';
  const hood = q.neighborhood ? norm(q.neighborhood) : '';
  const state = q.state ? q.state.trim().toUpperCase() : '';
  const days = (q.days ?? []).map(norm).filter(Boolean);
  const keywords = (q.keywords ?? []).map(norm).filter(Boolean);

  const out: VenueMatch[] = [];
  for (const { venue: v, stats } of rows) {
    if (city && !norm(v.city).includes(city) && !city.includes(norm(v.city))) continue;
    if (state && v.state.toUpperCase() !== state) continue;
    if (hood && !norm(v.neighborhood).includes(hood)) continue;
    if (q.category && v.category !== q.category) continue;
    if (q.music_styles?.length && !styleMatches(v.music_styles, q.music_styles)) continue;

    const spend = venueMinSpend(v);
    const priceKnown = spend !== null;
    if (q.max_budget !== undefined) {
      if (priceKnown && spend! > q.max_budget) continue;
      if (!priceKnown && q.only_known_prices) continue;
    }

    const openDays = v.opening_days.map(norm);
    const daysKnown = openDays.length > 0;
    if (days.length && daysKnown && !days.some((d) => openDays.some((o) => o.includes(d)))) continue;

    if (q.min_rating !== undefined && (stats.avg_rating === null || stats.avg_rating < q.min_rating)) continue;

    const haystack = norm([v.name, v.description, v.neighborhood, v.audience_tags.join(' '), v.music_styles.join(' ')].join(' '));
    const matched = keywords.filter((k) => haystack.includes(k));

    out.push({
      venue: v,
      stats,
      personal_score: weights ? personalScore(stats.criteria, weights) : null,
      matched_keywords: matched,
      price_known: priceKnown,
      days_known: daysKnown,
    });
  }

  out.sort(
    (a, b) =>
      b.matched_keywords.length - a.matched_keywords.length ||
      (b.personal_score ?? -1) - (a.personal_score ?? -1) ||
      (b.stats.score ?? -1) - (a.stats.score ?? -1) ||
      b.stats.review_count - a.stats.review_count ||
      a.venue.name.localeCompare(b.venue.name),
  );
  const limit = Math.min(10, Math.max(1, q.limit ?? 6));
  return { total: out.length, items: out.slice(0, limit) };
}

export interface EventQuery {
  city?: string;
  date_from?: string;
  date_to?: string;
  music_styles?: string[];
  dj?: string;
  max_price?: number;
  venue_slug?: string;
  keywords?: string[];
  limit?: number;
}

export function filterEvents(rows: EventRecord[], q: EventQuery): { total: number; items: EventRecord[] } {
  const city = q.city ? norm(q.city) : '';
  const dj = q.dj ? norm(q.dj) : '';
  const keywords = (q.keywords ?? []).map(norm).filter(Boolean);
  const out = rows.filter((e) => {
    if (city && !(e.venue && (norm(e.venue.city).includes(city) || city.includes(norm(e.venue.city))))) return false;
    if (q.venue_slug && e.venue?.slug !== q.venue_slug) return false;
    if (q.music_styles?.length && !styleMatches([...e.music_styles, ...(e.venue?.music_styles ?? [])], q.music_styles)) return false;
    if (dj && !e.dj_names.some((n) => norm(n).includes(dj))) return false;
    if (q.max_price !== undefined && e.ticket_price !== null && e.ticket_price > q.max_price) return false;
    if (keywords.length) {
      const hay = norm([e.name, e.description, e.dj_names.join(' '), e.venue?.name ?? ''].join(' '));
      if (!keywords.some((k) => hay.includes(k))) return false;
    }
    return true;
  });
  out.sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time));
  const limit = Math.min(15, Math.max(1, q.limit ?? 8));
  return { total: out.length, items: out.slice(0, limit) };
}

// ------------------------------------------------------------------ acesso ao banco

export class DataError extends Error {}

function check(error: { message: string } | null, what: string) {
  if (error) throw new DataError(`Falha ao consultar ${what}: ${error.message}`);
}

export interface UserPreferencesContext {
  profile_city: string | null;
  active_preset: { name: string; weights: CriteriaWeights } | null;
  favorite_venues: { slug: string; name: string }[];
  favorite_events: { slug: string; name: string; event_date: string }[];
  followed_artists: { name: string; kind: string }[];
}

/** Acesso de leitura ao catálogo real, sempre como o usuário autenticado. */
export class ClassifyData {
  private prefsCache: Promise<UserPreferencesContext> | null = null;

  constructor(
    private db: SupabaseClient,
    private userId: string,
    private includeDemo: boolean,
    private today: string,
  ) {}

  /** Valores aceitos de is_demo: só registros reais, salvo CLASSIFY_AI_INCLUDE_DEMO=true. */
  private get demoValues() {
    return this.includeDemo ? [true, false] : [false];
  }

  async catalogOverview() {
    const [{ data: venues, error: e1 }, { data: settings }, { count: upcoming, error: e2 }] = await Promise.all([
      this.db.from('venues').select('city,state,category,music_styles,is_demo').in('is_demo', this.demoValues).limit(2000),
      this.db.from('platform_settings').select('music_styles').eq('id', 1).maybeSingle(),
      this.db.from('events').select('id', { count: 'exact', head: true }).in('is_demo', this.demoValues).gte('event_date', this.today),
    ]);
    check(e1, 'estabelecimentos');
    check(e2, 'eventos');
    const cities = new Map<string, number>();
    const categories = new Map<string, number>();
    const styles = new Set<string>(strArr(settings?.music_styles));
    for (const v of venues ?? []) {
      const key = `${v.city}/${v.state}`;
      cities.set(key, (cities.get(key) ?? 0) + 1);
      categories.set(String(v.category), (categories.get(String(v.category)) ?? 0) + 1);
      strArr(v.music_styles).forEach((s) => styles.add(s));
    }
    return {
      total_venues: venues?.length ?? 0,
      upcoming_events: upcoming ?? 0,
      cities: [...cities.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ city: c.split('/')[0], state: c.split('/')[1], venues: n })),
      categories: Object.fromEntries(categories),
      music_styles: [...styles].sort(),
    };
  }

  private async venuesWithStats(): Promise<{ venue: VenueRecord; stats: VenueStatsRecord }[]> {
    const [{ data: venues, error: e1 }, { data: stats, error: e2 }] = await Promise.all([
      this.db.from('venues').select('*').in('is_demo', this.demoValues).limit(2000),
      this.db.from('venue_stats').select('*'),
    ]);
    check(e1, 'estabelecimentos');
    check(e2, 'notas');
    const byId = new Map((stats ?? []).map((s) => [String(s.venue_id), s as Row]));
    return (venues ?? []).map((v) => ({ venue: mapVenue(v), stats: mapStats(byId.get(String(v.id))) }));
  }

  async searchVenues(q: VenueQuery, useMyRanking: boolean) {
    const [rows, prefs] = await Promise.all([this.venuesWithStats(), useMyRanking ? this.preferences() : Promise.resolve(null)]);
    const weights = prefs?.active_preset?.weights ?? null;
    return { ...filterVenues(rows, q, weights), my_ranking_applied: weights ? prefs!.active_preset!.name : null };
  }

  async searchEvents(q: EventQuery) {
    const from = q.date_from && q.date_from > this.today ? q.date_from : this.today;
    let query = this.db.from('events').select('*, venue:venues(*)').in('is_demo', this.demoValues).gte('event_date', from).order('event_date').limit(500);
    if (q.date_to) query = query.lte('event_date', q.date_to);
    const { data, error } = await query;
    check(error, 'eventos');
    const rows = (data ?? []).map(mapEvent).filter((e) => this.includeDemo || !e.venue?.is_demo);
    return { ...filterEvents(rows, q), date_from: from, date_to: q.date_to ?? null };
  }

  async venueDetails(slug: string) {
    const { data: v, error } = await this.db.from('venues').select('*').in('is_demo', this.demoValues).eq('slug', slug).maybeSingle();
    check(error, 'estabelecimento');
    if (!v) return null;
    const venue = mapVenue(v);
    const [{ data: stats }, { data: events, error: e2 }, { data: reviews, error: e3 }] = await Promise.all([
      this.db.from('venue_stats').select('*').eq('venue_id', venue.id).maybeSingle(),
      this.db.from('events').select('*').eq('venue_id', venue.id).gte('event_date', this.today).order('event_date').limit(8),
      this.db
        .from('venue_reviews')
        .select('overall_rating, comment, experience_date, created_at')
        .eq('venue_id', venue.id)
        .eq('status', 'published')
        .neq('comment', '')
        .order('created_at', { ascending: false })
        .limit(4),
    ]);
    check(e2, 'eventos');
    check(e3, 'avaliações');
    return {
      venue,
      stats: mapStats((stats as Row) ?? undefined),
      upcoming_events: (events ?? []).map((e) => mapEvent(e as Row)),
      recent_reviews: (reviews ?? []).map((r) => ({
        overall_rating: numOrNull(r.overall_rating),
        comment: String(r.comment).slice(0, 280),
        experience_date: r.experience_date ?? null,
        created_at: String(r.created_at).slice(0, 10),
      })),
    };
  }

  /** Preferências privadas do usuário (Meu Ranking, favoritos, artistas seguidos). */
  preferences(): Promise<UserPreferencesContext> {
    if (!this.prefsCache) this.prefsCache = this.loadPreferences();
    return this.prefsCache;
  }

  private async loadPreferences(): Promise<UserPreferencesContext> {
    const [profile, prefs, favs, artists] = await Promise.all([
      this.db.from('profiles').select('city').eq('id', this.userId).maybeSingle(),
      this.db.from('user_preferences').select('ranking_presets, active_preset_id').eq('user_id', this.userId).maybeSingle(),
      this.db.from('favorites').select('venue:venues(slug,name), event:events(slug,name,event_date)').eq('user_id', this.userId).limit(100),
      this.db.from('user_favorites').select('name, kind').eq('user_id', this.userId).limit(100),
    ]);
    // Tabelas do Classify+ podem não existir se 0003 não foi aplicada: tratamos como "sem preferências".
    const presets = (prefs.data?.ranking_presets as { id: string; name: string; weights: unknown }[] | undefined) ?? [];
    const active = presets.find((p) => p.id === prefs.data?.active_preset_id) ?? null;
    const favRows = (favs.data ?? []) as unknown as { venue: Row | null; event: Row | null }[];
    return {
      profile_city: (profile.data?.city as string) ?? null,
      active_preset: active ? { name: String(active.name), weights: normalizeWeights(active.weights as Record<string, unknown>) } : null,
      favorite_venues: favRows.filter((f) => f.venue).map((f) => ({ slug: String(f.venue!.slug), name: String(f.venue!.name) })),
      favorite_events: favRows
        .filter((f) => f.event)
        .map((f) => ({ slug: String(f.event!.slug), name: String(f.event!.name), event_date: String(f.event!.event_date) })),
      followed_artists: ((artists.data ?? []) as Row[]).map((a) => ({ name: String(a.name), kind: String(a.kind) })),
    };
  }
}
