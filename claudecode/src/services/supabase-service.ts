'use client';
/**
 * SupabaseService — backend real (Postgres + Auth + Storage).
 * Toda regra sensível (nota geral, anti-spam, permissões, selo, ranking)
 * é aplicada no banco via triggers, RPCs e RLS — ver supabase/migrations.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { compressImage } from '@/lib/image';
import { validateComment, validateEmail, validatePassword, validateUsername } from '@/lib/moderation';
import { DEFAULT_SETTINGS } from '@/lib/ranking';
import { slugify } from '@/lib/format';
import { normalizePrices, PRICE_FIELDS, validatePrices } from '@/lib/pricing';
import { CRITERIA } from '@/types';
import type {
  CriteriaScores,
  EventFilter,
  EventItem,
  PlatformSettings,
  Profile,
  RankingQuery,
  RankingRow,
  ReviewInput,
  ReviewQuery,
  ReviewWithMeta,
  Venue,
  VenueFilter,
  VenueReview,
  VenueStats,
} from '@/types';
import { ServiceError, type DataService, type ImageBucket } from './data-service';
import { sortReviews } from '@/lib/reviews';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new ServiceError(translate(error.message));
}

function translate(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/User already registered/i.test(msg)) return 'Já existe uma conta com este e-mail.';
  if (/Email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar.';
  if (/duplicate key.*username/i.test(msg)) return 'Este nome de usuário já está em uso.';
  if (/duplicate key.*newsletter/i.test(msg)) return 'E-mail já inscrito.';
  if (/row-level security/i.test(msg)) return 'Você não tem permissão para esta ação.';
  return msg;
}

function mapStats(row: Record<string, unknown>, settings: PlatformSettings): VenueStats {
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c.key, num(row[c.key])])) as CriteriaScores;
  return {
    venue_id: String(row.venue_id),
    review_count: num(row.review_count),
    avg_rating: num(row.avg_rating),
    score: num(row.score),
    criteria,
    distribution: ((row.distribution as number[]) ?? [0, 0, 0, 0, 0]).map(num),
    flagged_ratio: 0,
    approved: Boolean(row.approved) && num(row.review_count) >= settings.approved_min_reviews,
  };
}

const mapVenue = (r: Record<string, unknown>): Venue => ({
  ...(r as unknown as Venue),
  latitude: num(r.latitude),
  longitude: num(r.longitude),
  gallery: (r.gallery as string[]) ?? [],
  // numeric do Postgres chega como string; null permanece null (não informado)
  ...Object.fromEntries(PRICE_FIELDS.map((f) => [f, r[f] === null || r[f] === undefined ? null : num(r[f])])),
  music_styles: (r.music_styles as string[]) ?? [],
  opening_days: (r.opening_days as string[]) ?? [],
  audience_tags: (r.audience_tags as string[]) ?? [],
  capacity: r.capacity === null || r.capacity === undefined ? null : num(r.capacity),
  opens_at: (r.opens_at as string) ?? null,
  closes_at: (r.closes_at as string) ?? null,
  is_indicated: Boolean(r.is_indicated),
});

const mapReview = (r: Record<string, unknown>): VenueReview => {
  const out = { ...(r as unknown as VenueReview), overall_rating: num(r.overall_rating), photos: (r.photos as string[]) ?? [] };
  for (const c of CRITERIA) out[c.key] = num(r[c.key]);
  return out;
};

export class SupabaseService implements DataService {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;
  private settingsCache: PlatformSettings | null = null;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }

  /** Client compartilhado com o SupabasePlusService (mesma sessão). */
  get client(): SupabaseClient {
    return this.sb;
  }

  private async uid(): Promise<string | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async requireUid(): Promise<string> {
    const id = await this.uid();
    if (!id) throw new ServiceError('Entre na sua conta para continuar.');
    return id;
  }

  // ------------------------------------------------------------ auth
  async getCurrentUser() {
    const id = await this.uid();
    if (!id) return null;
    const { data } = await this.sb.from('profiles').select('*').eq('id', id).maybeSingle();
    return (data as Profile) ?? null;
  }

  onAuthChange(cb: (p: Profile | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange(async (_e, session) => {
      if (!session) return cb(null);
      const { data: p } = await this.sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      cb((p as Profile) ?? null);
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(input: { email: string; password: string; username: string; full_name: string }) {
    if (!validateEmail(input.email)) throw new ServiceError('Informe um e-mail válido.');
    const p = validatePassword(input.password);
    if (p) throw new ServiceError(p);
    const u = validateUsername(input.username);
    if (u) throw new ServiceError(u);
    const { data: taken } = await this.sb.from('profiles').select('id').eq('username', input.username).maybeSingle();
    if (taken) throw new ServiceError('Este nome de usuário já está em uso.');
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: { username: input.username, full_name: input.full_name },
        emailRedirectTo: `${location.origin}/perfil`,
      },
    });
    fail(error);
    return { needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    fail(error);
    const p = await this.getCurrentUser();
    if (!p) throw new ServiceError('Perfil não encontrado.');
    return p;
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async requestPasswordReset(email: string) {
    const site = process.env.NEXT_PUBLIC_SITE_URL || location.origin;
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${site}/redefinir-senha` });
    fail(error);
    return {};
  }

  async updatePassword(password: string) {
    const p = validatePassword(password);
    if (p) throw new ServiceError(p);
    const { error } = await this.sb.auth.updateUser({ password });
    fail(error);
  }

  // ------------------------------------------------------------ venues
  async listVenues(f: VenueFilter = {}) {
    let q = this.sb.from('venues').select('*').order('name');
    if (f.city) q = q.eq('city', f.city);
    if (f.state) q = q.eq('state', f.state);
    if (f.category) q = q.eq('category', f.category);
    if (f.style) q = q.contains('music_styles', [f.style]);
    if (f.maxPrice) q = q.lte('price_range', f.maxPrice);
    if (f.search) {
      const s = f.search.replace(/[%,()]/g, ' ').trim();
      q = q.or(`name.ilike.%${s}%,city.ilike.%${s}%,neighborhood.ilike.%${s}%`);
    }
    const { data, error } = await q;
    fail(error);
    let venues = (data ?? []).map(mapVenue);
    if (f.minRating) {
      const stats = await this.getAllStats();
      venues = venues.filter((v) => (stats[v.id]?.avg_rating ?? 0) >= f.minRating!);
    }
    return venues;
  }

  async getVenue(slug: string) {
    const { data, error } = await this.sb.from('venues').select('*').eq('slug', slug).maybeSingle();
    fail(error);
    return data ? mapVenue(data) : null;
  }

  async getVenueStats(venueId: string) {
    const settings = await this.getSettings();
    const { data, error } = await this.sb.from('venue_stats').select('*').eq('venue_id', venueId).maybeSingle();
    fail(error);
    return data ? mapStats(data, settings) : null;
  }

  async getAllStats() {
    const settings = await this.getSettings();
    const { data, error } = await this.sb.from('venue_stats').select('*');
    fail(error);
    return Object.fromEntries((data ?? []).map((r) => [String(r.venue_id), mapStats(r, settings)]));
  }

  async listCities() {
    const { data, error } = await this.sb.from('venues').select('city,state');
    fail(error);
    const m = new Map<string, string>();
    (data ?? []).forEach((r) => m.set(r.city, r.state));
    return [...m].map(([city, state]) => ({ city, state })).sort((a, b) => a.city.localeCompare(b.city));
  }

  async getRankings(q: RankingQuery): Promise<RankingRow[]> {
    const { data, error } = await this.sb.rpc('get_rankings', {
      p_category: q.category ?? 'all',
      p_period: q.period ?? 'geral',
      p_city: q.city ?? null,
      p_state: q.state ?? null,
      p_min_rating: q.minRating ?? null,
      p_limit: q.limit ?? null,
    });
    fail(error);
    const rows = (data ?? []) as { venue_id: string; position: number; score: number; avg_rating: number; review_count: number; prev_position: number | null }[];
    if (!rows.length) return [];
    const ids = rows.map((r) => r.venue_id);
    const [{ data: venues }, stats] = await Promise.all([this.sb.from('venues').select('*').in('id', ids), this.getAllStats()]);
    const vmap = new Map((venues ?? []).map((v) => [v.id as string, mapVenue(v)]));
    return rows
      .filter((r) => vmap.has(r.venue_id))
      .map((r) => {
        const full = stats[r.venue_id]!;
        return {
          position: r.position,
          venue: vmap.get(r.venue_id)!,
          stats: { ...full, avg_rating: num(r.avg_rating), review_count: num(r.review_count), score: num(r.score) },
          change: r.prev_position ? r.prev_position - r.position : null,
          period_count: num(r.review_count),
        };
      });
  }

  // ------------------------------------------------------------ reviews
  async listReviews(q: ReviewQuery) {
    const me = await this.uid();
    let query = this.sb
      .from('venue_reviews')
      .select('*, author:profiles!venue_reviews_user_id_fkey(*), venue:venues!inner(*), likes:review_likes(user_id)')
      .order('updated_at', { ascending: false })
      .limit(q.sort === 'recent' && q.limit ? q.limit : 300);
    if (!q.includeHidden) query = query.neq('status', 'hidden');
    if (q.venueId) query = query.eq('venue_id', q.venueId);
    if (q.userId) query = query.eq('user_id', q.userId);
    if (q.minRating) query = query.gte('overall_rating', q.minRating);
    if (q.sinceDays) query = query.gte('created_at', new Date(Date.now() - q.sinceDays * 86_400_000).toISOString());
    if (q.city) query = query.eq('venue.city', q.city);
    if (q.category) query = query.eq('venue.category', q.category);
    const { data, error } = await query;
    fail(error);
    const rows: ReviewWithMeta[] = (data ?? []).map((r: Record<string, unknown>) => {
      const likes = (r.likes as { user_id: string }[]) ?? [];
      return {
        review: mapReview(r),
        author: r.author as Profile,
        venue: mapVenue(r.venue as Record<string, unknown>),
        likes: likes.length,
        likedByMe: !!me && likes.some((l) => l.user_id === me),
      };
    });
    const sorted = sortReviews(rows, q.sort ?? 'recent');
    return q.limit ? sorted.slice(0, q.limit) : sorted;
  }

  async getMyReview(venueId: string) {
    const me = await this.uid();
    if (!me) return null;
    const { data } = await this.sb.from('venue_reviews').select('*').eq('venue_id', venueId).eq('user_id', me).maybeSingle();
    return data ? mapReview(data) : null;
  }

  async upsertReview(input: ReviewInput) {
    const me = await this.requireUid();
    const m = validateComment(input.comment);
    if (m) throw new ServiceError(m);
    // overall_rating NÃO é enviado: o trigger enforce_review_rules o calcula no servidor.
    const payload = {
      user_id: me,
      venue_id: input.venue_id,
      music_rating: input.music_rating,
      crowd_rating: input.crowd_rating,
      atmosphere_rating: input.atmosphere_rating,
      drinks_rating: input.drinks_rating,
      service_rating: input.service_rating,
      organization_rating: input.organization_rating,
      experience_rating: input.experience_rating,
      comment: input.comment.trim(),
      experience_date: input.experience_date,
      photos: input.photos,
    };
    const { data, error } = await this.sb.from('venue_reviews').upsert(payload, { onConflict: 'user_id,venue_id' }).select().single();
    fail(error);
    return mapReview(data);
  }

  async deleteMyReview(reviewId: string) {
    const me = await this.requireUid();
    const { error } = await this.sb.from('venue_reviews').delete().eq('id', reviewId).eq('user_id', me);
    fail(error);
  }

  async listRevisions(reviewId: string) {
    const { data, error } = await this.sb.from('venue_review_revisions').select('*').eq('review_id', reviewId).order('created_at', { ascending: false });
    fail(error);
    return (data ?? []).map((r) => ({ ...mapReview(r), review_id: r.review_id })) as never;
  }

  async toggleLike(reviewId: string) {
    const me = await this.requireUid();
    const { data: existing } = await this.sb.from('review_likes').select('id').eq('review_id', reviewId).eq('user_id', me).maybeSingle();
    if (existing) {
      const { error } = await this.sb.from('review_likes').delete().eq('id', existing.id);
      fail(error);
      return false;
    }
    const { error } = await this.sb.from('review_likes').insert({ review_id: reviewId, user_id: me });
    fail(error);
    return true;
  }

  async reportReview(reviewId: string, reason: string) {
    const me = await this.requireUid();
    const { error } = await this.sb.from('review_reports').insert({ review_id: reviewId, user_id: me, reason: reason.trim() });
    if (error && /duplicate/i.test(error.message)) throw new ServiceError('Você já denunciou esta avaliação.');
    fail(error);
  }

  // ------------------------------------------------------------ events
  async listEvents(f: EventFilter = {}) {
    let q = this.sb.from('events').select('*, venue:venues!inner(*)').order('event_date', { ascending: !f.pastOnly });
    const today = new Date().toISOString().slice(0, 10);
    if (f.venueId) q = q.eq('venue_id', f.venueId);
    if (f.upcomingOnly) q = q.gte('event_date', today);
    if (f.pastOnly) q = q.lt('event_date', today);
    if (f.from) q = q.gte('event_date', f.from);
    if (f.to) q = q.lte('event_date', f.to);
    if (f.style) q = q.contains('music_styles', [f.style]);
    if (f.maxPrice) q = q.lte('ticket_price', f.maxPrice);
    if (f.city) q = q.eq('venue.city', f.city);
    const { data, error } = await q;
    fail(error);
    return (data ?? []).map((e: Record<string, unknown>) => ({
      ...(e as unknown as EventItem),
      ticket_price: e.ticket_price === null ? null : num(e.ticket_price),
      venue: mapVenue(e.venue as Record<string, unknown>),
    }));
  }

  async getEvent(slug: string) {
    const { data, error } = await this.sb.from('events').select('*, venue:venues!inner(*)').eq('slug', slug).maybeSingle();
    fail(error);
    if (!data) return null;
    return { ...(data as EventItem), ticket_price: data.ticket_price === null ? null : num(data.ticket_price), venue: mapVenue(data.venue) };
  }

  async listEventReviews(eventId: string) {
    const { data, error } = await this.sb
      .from('event_reviews')
      .select('*, author:profiles(*)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    fail(error);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      review: { ...(r as never as EventItem & { rating: number }), rating: num(r.rating) } as never,
      author: r.author as Profile,
    }));
  }

  async upsertEventReview(eventId: string, rating: number, comment: string) {
    const me = await this.requireUid();
    const m = validateComment(comment);
    if (m) throw new ServiceError(m);
    const { error } = await this.sb
      .from('event_reviews')
      .upsert({ event_id: eventId, user_id: me, rating, comment: comment.trim() }, { onConflict: 'user_id,event_id' });
    fail(error);
  }

  // ------------------------------------------------------------ favorites
  async listFavorites(userId: string) {
    const { data, error } = await this.sb.from('favorites').select('*').eq('user_id', userId);
    fail(error);
    return data ?? [];
  }

  async toggleFavorite(t: { venueId?: string; eventId?: string }) {
    const me = await this.requireUid();
    const col = t.venueId ? 'venue_id' : 'event_id';
    const val = t.venueId ?? t.eventId!;
    const { data: existing } = await this.sb.from('favorites').select('id').eq('user_id', me).eq(col, val).maybeSingle();
    if (existing) {
      const { error } = await this.sb.from('favorites').delete().eq('id', existing.id);
      fail(error);
      return false;
    }
    const { error } = await this.sb.from('favorites').insert({ user_id: me, [col]: val });
    fail(error);
    return true;
  }

  // ------------------------------------------------------------ profiles
  async getProfileByUsername(username: string) {
    const { data } = await this.sb.from('profiles').select('*').eq('username', username).maybeSingle();
    return (data as Profile) ?? null;
  }

  async updateProfile(patch: Partial<Pick<Profile, 'full_name' | 'username' | 'city' | 'bio' | 'avatar_url'>>) {
    const me = await this.requireUid();
    if (patch.username) {
      const err = validateUsername(patch.username);
      if (err) throw new ServiceError(err);
    }
    const { data, error } = await this.sb.from('profiles').update(patch).eq('id', me).select().single();
    fail(error);
    return data as Profile;
  }

  async getUserStats(userId: string) {
    const { data, error } = await this.sb.rpc('user_stats', { p_user: userId });
    fail(error);
    const row = (data as { review_count: number; likes_received: number }[])?.[0];
    return { review_count: num(row?.review_count), likes_received: num(row?.likes_received) };
  }

  async uploadImage(file: File, bucket: ImageBucket) {
    const me = await this.requireUid();
    const blob = await compressImage(file, bucket === 'avatars' ? 400 : 1600, 0.8);
    const path = `${bucket === 'venue-images' ? 'venues' : me}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await this.sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    fail(error);
    return this.sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  // ------------------------------------------------------------ newsletter
  async subscribeNewsletter(email: string) {
    if (!validateEmail(email)) throw new ServiceError('Informe um e-mail válido.');
    const { error } = await this.sb.from('newsletter').insert({ email: email.trim().toLowerCase() });
    if (error && /duplicate/i.test(error.message)) return 'exists' as const;
    fail(error);
    return 'created' as const;
  }

  async getSettings(): Promise<PlatformSettings> {
    if (this.settingsCache) return this.settingsCache;
    const { data } = await this.sb.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    this.settingsCache = data
      ? {
          approved_min_rating: num(data.approved_min_rating),
          approved_min_reviews: num(data.approved_min_reviews),
          approved_max_flag_ratio: num(data.approved_max_flag_ratio),
          bayes_prior_weight: num(data.bayes_prior_weight),
          recency_half_life_days: num(data.recency_half_life_days),
          music_styles: data.music_styles ?? DEFAULT_SETTINGS.music_styles,
        }
      : DEFAULT_SETTINGS;
    return this.settingsCache;
  }

  // ------------------------------------------------------------ admin
  admin = {
    metrics: async () => {
      const { data, error } = await this.sb.rpc('admin_metrics');
      fail(error);
      const stats = await this.getAllStats();
      const { data: venues } = await this.sb.from('venues').select('*');
      const popular = (venues ?? [])
        .map((v) => ({ venue: mapVenue(v), review_count: stats[v.id]?.review_count ?? 0, avg_rating: stats[v.id]?.avg_rating ?? 0 }))
        .sort((a, b) => b.review_count - a.review_count)
        .slice(0, 6);
      const m = data as Record<string, number>;
      return {
        users: num(m.users), venues: num(m.venues), reviews: num(m.reviews), events: num(m.events),
        avg_rating: num(m.avg_rating), newsletter: num(m.newsletter), pending_reports: num(m.pending_reports), popular,
      };
    },
    upsertVenue: async (v: Partial<Venue> & { name: string }) => {
      const pErr = validatePrices(v);
      if (pErr) throw new ServiceError(pErr);
      const { approved: _a, id, created_at: _c, ...rest } = v;
      const prices = normalizePrices(v);
      // Só envia os campos de preço presentes no patch (não apaga valores ao editar outros campos).
      const pricePatch = Object.fromEntries(PRICE_FIELDS.filter((f) => f in v).map((f) => [f, prices[f]]));
      const payload = { ...rest, ...pricePatch, slug: v.slug || slugify(v.name) };
      const q = id ? this.sb.from('venues').update(payload).eq('id', id) : this.sb.from('venues').insert(payload);
      const { data, error } = await q.select().single();
      fail(error);
      return mapVenue(data);
    },
    deleteVenue: async (id: string) => {
      const { error } = await this.sb.from('venues').delete().eq('id', id);
      fail(error);
    },
    upsertEvent: async (e: Partial<EventItem> & { name: string; venue_id: string }) => {
      // `venue` pode vir aninhado quando o evento foi carregado por listEvents — não é coluna.
      const { id, created_at: _c, venue: _v, ...rest } = e as EventItem & { venue?: unknown };
      const payload = { ...rest, slug: e.slug || slugify(`${e.name}-${e.event_date}`) };
      const q = id ? this.sb.from('events').update(payload).eq('id', id) : this.sb.from('events').insert(payload);
      const { data, error } = await q.select().single();
      fail(error);
      return data as EventItem;
    },
    deleteEvent: async (id: string) => {
      const { error } = await this.sb.from('events').delete().eq('id', id);
      fail(error);
    },
    listProfiles: async () => {
      const { data, error } = await this.sb.from('profiles').select('*, venue_reviews(count)').order('created_at', { ascending: false });
      fail(error);
      return (data ?? []).map((p: Record<string, unknown>) => ({
        ...(p as unknown as Profile),
        review_count: num((p.venue_reviews as { count: number }[])?.[0]?.count),
      }));
    },
    setRole: async (userId: string, role: 'user' | 'admin') => {
      const { error } = await this.sb.from('profiles').update({ role }).eq('id', userId);
      fail(error);
    },
    listReports: async () => {
      const { data, error } = await this.sb
        .from('review_reports')
        .select('*, reporter:profiles(*), review:venue_reviews(*, venue:venues(*), author:profiles!venue_reviews_user_id_fkey(*))')
        .order('created_at', { ascending: false });
      fail(error);
      return (data ?? []).map((r: Record<string, unknown>) => {
        const review = r.review as Record<string, unknown> | null;
        return {
          report: r as never,
          reporter: (r.reporter as Profile) ?? null,
          review: review ? mapReview(review) : null,
          venue: review?.venue ? mapVenue(review.venue as Record<string, unknown>) : null,
          author: (review?.author as Profile) ?? null,
        };
      });
    },
    resolveReport: async (reportId: string, action: 'dismiss' | 'hide_review') => {
      const { error } = await this.sb.rpc('admin_resolve_report', { p_report: reportId, p_action: action });
      fail(error);
    },
    setReviewStatus: async (reviewId: string, status: 'published' | 'flagged' | 'hidden') => {
      const { error } = await this.sb.from('venue_reviews').update({ status }).eq('id', reviewId);
      fail(error);
    },
    listNewsletter: async () => {
      const { data, error } = await this.sb.from('newsletter').select('*').order('created_at', { ascending: false });
      fail(error);
      return data ?? [];
    },
    deleteNewsletter: async (id: string) => {
      const { error } = await this.sb.from('newsletter').delete().eq('id', id);
      fail(error);
    },
    updateSettings: async (s: PlatformSettings) => {
      const { error } = await this.sb.from('platform_settings').update(s).eq('id', 1);
      fail(error);
      this.settingsCache = null;
    },
    removeDemoData: async () => {
      const { error } = await this.sb.rpc('remove_demo_data');
      fail(error);
    },
  };
}
