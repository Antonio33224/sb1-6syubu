'use client';
/**
 * DemoService — banco de dados local para MODO DEMONSTRAÇÃO.
 * Persiste no localStorage do navegador. Nada é enviado a servidores.
 * Implementa as mesmas regras de negócio do backend Supabase.
 */
import { buildDemoDatabase, demoDetailsFor, demoPricesFor, DEMO_DB_VERSION, type DemoDB } from '@/data/demo-seed';
import { normalizePrices, validatePrices } from '@/lib/pricing';
import { blobToDataUrl, compressImage } from '@/lib/image';
import {
  MAX_REVIEW_PHOTOS,
  REPORTS_TO_FLAG,
  REVIEW_RATE_LIMIT_PER_HOUR,
  validateComment,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/lib/moderation';
import { computeAllStats, computeRankings, DEFAULT_SETTINGS } from '@/lib/ranking';
import { computeOverall, round1, validateCriteria } from '@/lib/rating';
import { slugify, uid } from '@/lib/format';
import { sortReviews } from '@/lib/reviews';
import type {
  EventFilter,
  EventItem,
  Profile,
  ReviewInput,
  ReviewQuery,
  ReviewWithMeta,
  Venue,
  VenueFilter,
  VenueReview,
} from '@/types';
import { ServiceError, type DataService } from './data-service';

const DB_KEY = 'classifydj:demo-db';
const SESSION_KEY = 'classifydj:demo-session';
const RESET_KEY = 'classifydj:demo-reset';
const DAY = 86_400_000;

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`classifydj-demo:${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const hasWindow = () => typeof window !== 'undefined';
const now = () => new Date().toISOString();

export class DemoService implements DataService {
  readonly mode = 'demo' as const;
  private db: DemoDB | null = null;
  private loading: Promise<DemoDB> | null = null;
  private listeners = new Set<(p: Profile | null) => void>();

  // ------------------------------------------------------------ storage
  private async load(): Promise<DemoDB> {
    if (this.db) return this.db;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (hasWindow()) {
        try {
          const raw = localStorage.getItem(DB_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as DemoDB;
            let migrated = false;
            // v4 → v5: adiciona os campos de preço sem apagar avaliações/contas criadas localmente.
            if (parsed.version === 4) {
              const fresh = buildDemoDatabase();
              parsed.venues = parsed.venues.map((v) => (v.is_demo ? { ...demoPricesFor(v.slug), ...v } : { ...normalizePrices(v), ...v }));
              const known = new Set(parsed.events.map((e) => e.slug));
              const ids = new Set(parsed.venues.map((v) => v.id));
              parsed.events.push(...fresh.events.filter((e) => !known.has(e.slug) && ids.has(e.venue_id) && e.event_date >= new Date().toISOString().slice(0, 10)));
              parsed.version = 5;
              migrated = true;
            }
            // v5 → v6: detalhes para filtros avançados e marcação INDICADO (casas demo).
            if (parsed.version === 5) {
              parsed.venues = parsed.venues.map((v) =>
                v.is_demo ? { ...demoDetailsFor(v.slug), ...v } : { audience_tags: [], capacity: null, opens_at: null, closes_at: null, is_indicated: false, ...v },
              );
              parsed.version = DEMO_DB_VERSION;
              migrated = true;
            }
            if (migrated) {
              this.db = parsed;
              this.persist();
              return parsed;
            }
            if (parsed.version === DEMO_DB_VERSION) {
              this.db = parsed;
              return parsed;
            }
          }
        } catch {
          /* storage indisponível ou corrompido: recria */
        }
      }
      const seed = buildDemoDatabase();
      const credentials = await Promise.all(
        seed.credentialSeeds.map(async (c) => ({ user_id: c.user_id, email: c.email, password_hash: await hashPassword(c.password) })),
      );
      const { credentialSeeds: _ignored, ...rest } = seed;
      this.db = { ...rest, credentials };
      this.persist();
      return this.db;
    })();
    return this.loading;
  }

  private persist() {
    if (!hasWindow() || !this.db) return;
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this.db));
    } catch {
      throw new ServiceError('Armazenamento local cheio. Remova fotos ou redefina a demonstração.');
    }
  }

  private sessionUserId(): string | null {
    if (!hasWindow()) return null;
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  private async requireUser(): Promise<Profile> {
    const user = await this.getCurrentUser();
    if (!user) throw new ServiceError('Entre na sua conta para continuar.');
    return user;
  }

  private async requireAdmin(): Promise<DemoDB> {
    const user = await this.requireUser();
    if (user.role !== 'admin') throw new ServiceError('Acesso restrito a administradores.');
    return this.load();
  }

  private emit(p: Profile | null) {
    this.listeners.forEach((l) => l(p));
  }

  private stats(db: DemoDB) {
    return computeAllStats(db.venues, db.reviews, db.settings);
  }

  private withApproved(db: DemoDB, venues: Venue[]): Venue[] {
    const stats = this.stats(db);
    return venues.map((v) => ({ ...v, approved: stats.get(v.id)?.approved ?? false }));
  }

  // ------------------------------------------------------------ auth
  async getCurrentUser() {
    const id = this.sessionUserId();
    if (!id) return null;
    const db = await this.load();
    return db.profiles.find((p) => p.id === id) ?? null;
  }

  onAuthChange(cb: (p: Profile | null) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async signUp({ email, password, username, full_name }: { email: string; password: string; username: string; full_name: string }) {
    const db = await this.load();
    const e = email.trim().toLowerCase();
    if (!validateEmail(e)) throw new ServiceError('Informe um e-mail válido.');
    const pErr = validatePassword(password);
    if (pErr) throw new ServiceError(pErr);
    const uErr = validateUsername(username);
    if (uErr) throw new ServiceError(uErr);
    if (!full_name.trim()) throw new ServiceError('Informe seu nome.');
    if (db.credentials.some((c) => c.email === e)) throw new ServiceError('Já existe uma conta com este e-mail.');
    if (db.profiles.some((p) => p.username === username)) throw new ServiceError('Este nome de usuário já está em uso.');
    const profile: Profile = {
      id: uid(), username, full_name: full_name.trim(), avatar_url: null, city: null, bio: null, role: 'user',
      is_demo: false, created_at: now(),
    };
    db.profiles.push(profile);
    db.credentials.push({ user_id: profile.id, email: e, password_hash: await hashPassword(password) });
    this.persist();
    localStorage.setItem(SESSION_KEY, profile.id);
    this.emit(profile);
    return { needsConfirmation: false };
  }

  async signIn(email: string, password: string) {
    const db = await this.load();
    const cred = db.credentials.find((c) => c.email === email.trim().toLowerCase());
    if (!cred || cred.password_hash !== (await hashPassword(password))) throw new ServiceError('E-mail ou senha incorretos.');
    const profile = db.profiles.find((p) => p.id === cred.user_id)!;
    localStorage.setItem(SESSION_KEY, profile.id);
    this.emit(profile);
    return profile;
  }

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
    this.emit(null);
  }

  async requestPasswordReset(email: string) {
    const db = await this.load();
    const cred = db.credentials.find((c) => c.email === email.trim().toLowerCase());
    // Não revela se o e-mail existe; em modo demo, retorna o link diretamente (nenhum e-mail é enviado).
    if (!cred) return {};
    const token = uid();
    const map = JSON.parse(localStorage.getItem(RESET_KEY) || '{}') as Record<string, { user_id: string; exp: number }>;
    map[token] = { user_id: cred.user_id, exp: Date.now() + 3600_000 };
    localStorage.setItem(RESET_KEY, JSON.stringify(map));
    return { demoLink: `/redefinir-senha?token=${token}` };
  }

  async updatePassword(password: string, token?: string) {
    const db = await this.load();
    const pErr = validatePassword(password);
    if (pErr) throw new ServiceError(pErr);
    let userId = this.sessionUserId();
    if (token) {
      const map = JSON.parse(localStorage.getItem(RESET_KEY) || '{}') as Record<string, { user_id: string; exp: number }>;
      const entry = map[token];
      if (!entry || entry.exp < Date.now()) throw new ServiceError('Link de recuperação inválido ou expirado.');
      userId = entry.user_id;
      delete map[token];
      localStorage.setItem(RESET_KEY, JSON.stringify(map));
    }
    if (!userId) throw new ServiceError('Sessão expirada.');
    const cred = db.credentials.find((c) => c.user_id === userId);
    if (!cred) throw new ServiceError('Conta não encontrada.');
    cred.password_hash = await hashPassword(password);
    this.persist();
  }

  // ------------------------------------------------------------ venues
  async listVenues(f: VenueFilter = {}) {
    const db = await this.load();
    const stats = this.stats(db);
    const q = f.search?.trim().toLowerCase();
    return this.withApproved(
      db,
      db.venues.filter((v) => {
        if (f.city && v.city !== f.city) return false;
        if (f.state && v.state !== f.state) return false;
        if (f.category && v.category !== f.category) return false;
        if (f.style && !v.music_styles.includes(f.style)) return false;
        if (f.maxPrice && v.price_range > f.maxPrice) return false;
        if (f.minRating && (stats.get(v.id)?.avg_rating ?? 0) < f.minRating) return false;
        if (q && !`${v.name} ${v.city} ${v.neighborhood} ${v.music_styles.join(' ')}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    );
  }

  async getVenue(slug: string) {
    const db = await this.load();
    const v = db.venues.find((x) => x.slug === slug);
    return v ? this.withApproved(db, [v])[0]! : null;
  }

  async getVenueStats(venueId: string) {
    const db = await this.load();
    return this.stats(db).get(venueId) ?? null;
  }

  async getAllStats() {
    const db = await this.load();
    return Object.fromEntries(this.stats(db));
  }

  async listCities() {
    const db = await this.load();
    const seen = new Map<string, string>();
    db.venues.forEach((v) => seen.set(v.city, v.state));
    return [...seen].map(([city, state]) => ({ city, state })).sort((a, b) => a.city.localeCompare(b.city));
  }

  async getRankings(q: Parameters<DataService['getRankings']>[0]) {
    const db = await this.load();
    return computeRankings({ venues: db.venues, reviews: db.reviews, likes: db.likes, settings: db.settings }, q);
  }

  // ------------------------------------------------------------ reviews
  async listReviews(q: ReviewQuery) {
    const db = await this.load();
    const me = this.sessionUserId();
    const venues = new Map(this.withApproved(db, db.venues).map((v) => [v.id, v]));
    const profiles = new Map(db.profiles.map((p) => [p.id, p]));
    const likeCount = new Map<string, number>();
    const mine = new Set<string>();
    for (const l of db.likes) {
      likeCount.set(l.review_id, (likeCount.get(l.review_id) ?? 0) + 1);
      if (l.user_id === me) mine.add(l.review_id);
    }
    let rows: ReviewWithMeta[] = db.reviews
      .filter((r) => (q.includeHidden ? true : r.status !== 'hidden'))
      .filter((r) => !q.venueId || r.venue_id === q.venueId)
      .filter((r) => !q.userId || r.user_id === q.userId)
      .filter((r) => !q.minRating || r.overall_rating >= q.minRating)
      .filter((r) => !q.sinceDays || Date.now() - new Date(r.created_at).getTime() <= q.sinceDays * DAY)
      .map((r) => ({
        review: r,
        venue: venues.get(r.venue_id)!,
        author: profiles.get(r.user_id)!,
        likes: likeCount.get(r.id) ?? 0,
        likedByMe: mine.has(r.id),
      }))
      .filter((r) => r.venue && r.author)
      .filter((r) => !q.city || r.venue.city === q.city)
      .filter((r) => !q.category || r.venue.category === q.category);

    rows = sortReviews(rows, q.sort ?? 'recent');
    return q.limit ? rows.slice(0, q.limit) : rows;
  }

  async getMyReview(venueId: string) {
    const me = this.sessionUserId();
    if (!me) return null;
    const db = await this.load();
    return db.reviews.find((r) => r.user_id === me && r.venue_id === venueId) ?? null;
  }

  async upsertReview(input: ReviewInput) {
    const user = await this.requireUser();
    const db = await this.load();
    if (!db.venues.some((v) => v.id === input.venue_id)) throw new ServiceError('Estabelecimento não encontrado.');
    const cErr = validateCriteria(input);
    if (cErr) throw new ServiceError(cErr);
    const comment = input.comment.trim();
    const mErr = validateComment(comment);
    if (mErr) throw new ServiceError(mErr);
    if (input.photos.length > MAX_REVIEW_PHOTOS) throw new ServiceError(`Máximo de ${MAX_REVIEW_PHOTOS} fotos.`);
    if (input.experience_date && new Date(input.experience_date).getTime() > Date.now() + DAY)
      throw new ServiceError('A data da experiência não pode estar no futuro.');

    const mineAll = db.reviews.filter((r) => r.user_id === user.id);
    const lastHour = mineAll.filter((r) => Date.now() - new Date(r.updated_at).getTime() < 3600_000).length;
    if (lastHour >= REVIEW_RATE_LIMIT_PER_HOUR)
      throw new ServiceError('Você atingiu o limite de avaliações por hora. Tente novamente mais tarde.');
    if (comment && mineAll.some((r) => r.venue_id !== input.venue_id && r.comment.trim() === comment))
      throw new ServiceError('Você já publicou este mesmo comentário em outra avaliação.');

    const scores = {
      music_rating: input.music_rating, crowd_rating: input.crowd_rating, atmosphere_rating: input.atmosphere_rating,
      drinks_rating: input.drinks_rating, service_rating: input.service_rating, organization_rating: input.organization_rating,
      experience_rating: input.experience_rating,
    };
    const overall = computeOverall(scores); // nunca confia em valor externo
    const existing = mineAll.find((r) => r.venue_id === input.venue_id);
    const ts = now();
    if (existing) {
      db.revisions.push({
        id: uid(), review_id: existing.id, music_rating: existing.music_rating, crowd_rating: existing.crowd_rating,
        atmosphere_rating: existing.atmosphere_rating, drinks_rating: existing.drinks_rating,
        service_rating: existing.service_rating, organization_rating: existing.organization_rating,
        experience_rating: existing.experience_rating, overall_rating: existing.overall_rating, comment: existing.comment,
        experience_date: existing.experience_date, created_at: existing.updated_at,
      });
      Object.assign(existing, scores, { overall_rating: overall, comment, experience_date: input.experience_date, photos: input.photos, updated_at: ts });
      this.persist();
      return existing;
    }
    const review: VenueReview = {
      id: uid(), user_id: user.id, venue_id: input.venue_id, ...scores, overall_rating: overall, comment,
      experience_date: input.experience_date, photos: input.photos, status: 'published', is_demo: false,
      created_at: ts, updated_at: ts,
    };
    db.reviews.push(review);
    this.persist();
    return review;
  }

  async deleteMyReview(reviewId: string) {
    const user = await this.requireUser();
    const db = await this.load();
    const r = db.reviews.find((x) => x.id === reviewId);
    if (!r || r.user_id !== user.id) throw new ServiceError('Você só pode remover suas próprias avaliações.');
    db.reviews = db.reviews.filter((x) => x.id !== reviewId);
    db.likes = db.likes.filter((l) => l.review_id !== reviewId);
    db.reports = db.reports.filter((l) => l.review_id !== reviewId);
    this.persist();
  }

  async listRevisions(reviewId: string) {
    const db = await this.load();
    return db.revisions.filter((r) => r.review_id === reviewId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async toggleLike(reviewId: string) {
    const user = await this.requireUser();
    const db = await this.load();
    const review = db.reviews.find((r) => r.id === reviewId);
    if (!review) throw new ServiceError('Avaliação não encontrada.');
    if (review.user_id === user.id) throw new ServiceError('Você não pode curtir a própria avaliação.');
    const idx = db.likes.findIndex((l) => l.review_id === reviewId && l.user_id === user.id);
    if (idx >= 0) db.likes.splice(idx, 1);
    else db.likes.push({ id: uid(), user_id: user.id, review_id: reviewId, created_at: now() });
    this.persist();
    return idx < 0;
  }

  async reportReview(reviewId: string, reason: string) {
    const user = await this.requireUser();
    const db = await this.load();
    const review = db.reviews.find((r) => r.id === reviewId);
    if (!review) throw new ServiceError('Avaliação não encontrada.');
    if (review.user_id === user.id) throw new ServiceError('Você não pode denunciar a própria avaliação.');
    if (reason.trim().length < 5) throw new ServiceError('Descreva o motivo da denúncia.');
    if (db.reports.some((r) => r.review_id === reviewId && r.user_id === user.id))
      throw new ServiceError('Você já denunciou esta avaliação.');
    db.reports.push({ id: uid(), user_id: user.id, review_id: reviewId, reason: reason.trim(), status: 'pending', created_at: now() });
    const pending = db.reports.filter((r) => r.review_id === reviewId && r.status === 'pending').length;
    if (pending >= REPORTS_TO_FLAG && review.status === 'published') review.status = 'flagged';
    this.persist();
  }

  // ------------------------------------------------------------ events
  async listEvents(f: EventFilter = {}) {
    const db = await this.load();
    const venues = new Map(this.withApproved(db, db.venues).map((v) => [v.id, v]));
    const today = new Date().toISOString().slice(0, 10);
    return db.events
      .filter((e) => !f.venueId || e.venue_id === f.venueId)
      .filter((e) => !f.upcomingOnly || e.event_date >= today)
      .filter((e) => !f.pastOnly || e.event_date < today)
      .filter((e) => !f.from || e.event_date >= f.from)
      .filter((e) => !f.to || e.event_date <= f.to)
      .filter((e) => !f.style || e.music_styles.includes(f.style))
      .filter((e) => !f.maxPrice || (e.ticket_price ?? 0) <= f.maxPrice)
      .map((e) => ({ ...e, venue: venues.get(e.venue_id)! }))
      .filter((e) => e.venue && (!f.city || e.venue.city === f.city))
      .sort((a, b) => (f.pastOnly ? b.event_date.localeCompare(a.event_date) : a.event_date.localeCompare(b.event_date)));
  }

  async getEvent(slug: string) {
    const db = await this.load();
    const e = db.events.find((x) => x.slug === slug);
    if (!e) return null;
    const venue = this.withApproved(db, db.venues.filter((v) => v.id === e.venue_id))[0];
    return venue ? { ...e, venue } : null;
  }

  async listEventReviews(eventId: string) {
    const db = await this.load();
    const profiles = new Map(db.profiles.map((p) => [p.id, p]));
    return db.eventReviews
      .filter((r) => r.event_id === eventId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((review) => ({ review, author: profiles.get(review.user_id)! }))
      .filter((r) => r.author);
  }

  async upsertEventReview(eventId: string, rating: number, comment: string) {
    const user = await this.requireUser();
    const db = await this.load();
    const ev = db.events.find((e) => e.id === eventId);
    if (!ev) throw new ServiceError('Evento não encontrado.');
    if (ev.event_date > new Date().toISOString().slice(0, 10)) throw new ServiceError('Só é possível avaliar edições que já aconteceram.');
    if (!(rating >= 0 && rating <= 10)) throw new ServiceError('A nota deve estar entre 0 e 10.');
    const mErr = validateComment(comment);
    if (mErr) throw new ServiceError(mErr);
    const existing = db.eventReviews.find((r) => r.event_id === eventId && r.user_id === user.id);
    if (existing) Object.assign(existing, { rating: round1(rating), comment: comment.trim() });
    else db.eventReviews.push({ id: uid(), user_id: user.id, event_id: eventId, rating: round1(rating), comment: comment.trim(), is_demo: false, created_at: now() });
    this.persist();
  }

  // ------------------------------------------------------------ favorites
  async listFavorites(userId: string) {
    const db = await this.load();
    return db.favorites.filter((f) => f.user_id === userId);
  }

  async toggleFavorite(t: { venueId?: string; eventId?: string }) {
    const user = await this.requireUser();
    const db = await this.load();
    const idx = db.favorites.findIndex(
      (f) => f.user_id === user.id && (t.venueId ? f.venue_id === t.venueId : f.event_id === t.eventId),
    );
    if (idx >= 0) db.favorites.splice(idx, 1);
    else db.favorites.push({ id: uid(), user_id: user.id, venue_id: t.venueId ?? null, event_id: t.eventId ?? null, created_at: now() });
    this.persist();
    return idx < 0;
  }

  // ------------------------------------------------------------ profiles
  async getProfileByUsername(username: string) {
    const db = await this.load();
    return db.profiles.find((p) => p.username === username) ?? null;
  }

  async updateProfile(patch: Partial<Pick<Profile, 'full_name' | 'username' | 'city' | 'bio' | 'avatar_url'>>) {
    const user = await this.requireUser();
    const db = await this.load();
    if (patch.username !== undefined) {
      const err = validateUsername(patch.username);
      if (err) throw new ServiceError(err);
      if (db.profiles.some((p) => p.username === patch.username && p.id !== user.id))
        throw new ServiceError('Este nome de usuário já está em uso.');
    }
    if (patch.bio && patch.bio.length > 280) throw new ServiceError('A biografia pode ter no máximo 280 caracteres.');
    const p = db.profiles.find((x) => x.id === user.id)!;
    // role nunca é alterável pelo próprio usuário
    Object.assign(p, {
      ...(patch.full_name !== undefined && { full_name: patch.full_name.trim() }),
      ...(patch.username !== undefined && { username: patch.username }),
      ...(patch.city !== undefined && { city: patch.city || null }),
      ...(patch.bio !== undefined && { bio: patch.bio || null }),
      ...(patch.avatar_url !== undefined && { avatar_url: patch.avatar_url }),
    });
    this.persist();
    this.emit(p);
    return p;
  }

  async getUserStats(userId: string) {
    const db = await this.load();
    const mine = new Set(db.reviews.filter((r) => r.user_id === userId && r.status !== 'hidden').map((r) => r.id));
    return { review_count: mine.size, likes_received: db.likes.filter((l) => mine.has(l.review_id)).length };
  }

  async uploadImage(file: File, bucket: 'avatars' | 'review-photos' | 'venue-images') {
    await this.requireUser();
    const blob = await compressImage(file, bucket === 'avatars' ? 320 : 900, 0.7);
    return blobToDataUrl(blob);
  }

  // ------------------------------------------------------------ newsletter
  async subscribeNewsletter(email: string) {
    const db = await this.load();
    const e = email.trim().toLowerCase();
    if (!validateEmail(e)) throw new ServiceError('Informe um e-mail válido.');
    if (db.newsletter.some((n) => n.email === e)) return 'exists' as const;
    db.newsletter.push({ id: uid(), email: e, created_at: now() });
    this.persist();
    return 'created' as const;
  }

  async getSettings() {
    const db = await this.load();
    return db.settings ?? DEFAULT_SETTINGS;
  }

  // ------------------------------------------------------------ admin
  admin = {
    metrics: async () => {
      const db = await this.requireAdmin();
      const stats = this.stats(db);
      const visible = db.reviews.filter((r) => r.status !== 'hidden');
      return {
        users: db.profiles.length,
        venues: db.venues.length,
        reviews: visible.length,
        events: db.events.length,
        avg_rating: visible.length ? round1(visible.reduce((s, r) => s + r.overall_rating, 0) / visible.length) : 0,
        newsletter: db.newsletter.length,
        pending_reports: db.reports.filter((r) => r.status === 'pending').length,
        popular: db.venues
          .map((v) => ({ venue: v, review_count: stats.get(v.id)?.review_count ?? 0, avg_rating: stats.get(v.id)?.avg_rating ?? 0 }))
          .sort((a, b) => b.review_count - a.review_count)
          .slice(0, 6),
      };
    },
    upsertVenue: async (v: Partial<Venue> & { name: string }) => {
      const db = await this.requireAdmin();
      if (!v.name.trim()) throw new ServiceError('Nome obrigatório.');
      const pErr = validatePrices(v);
      if (pErr) throw new ServiceError(pErr);
      const slug = v.slug?.trim() || slugify(v.name);
      if (db.venues.some((x) => x.slug === slug && x.id !== v.id)) throw new ServiceError('Já existe um estabelecimento com este slug.');
      if (v.id) {
        const cur = db.venues.find((x) => x.id === v.id);
        if (!cur) throw new ServiceError('Registro não encontrado.');
        Object.assign(cur, v, normalizePrices({ ...cur, ...v }), { slug, approved: cur.approved });
        this.persist();
        return cur;
      }
      const venue: Venue = {
        id: uid(), name: v.name.trim(), slug, description: v.description ?? '', category: v.category ?? 'boate',
        city: v.city ?? 'Rio de Janeiro', state: v.state ?? 'RJ', neighborhood: v.neighborhood ?? '', address: v.address ?? '',
        latitude: v.latitude ?? -22.9068, longitude: v.longitude ?? -43.1729, cover_image: v.cover_image || '/images/dance-floor.jpg',
        gallery: v.gallery ?? [], instagram_url: v.instagram_url ?? null, website_url: v.website_url ?? null,
        price_range: v.price_range ?? 2, ...normalizePrices(v), music_styles: v.music_styles ?? [], opening_days: v.opening_days ?? [],
        audience_tags: v.audience_tags ?? [], capacity: v.capacity ?? null, opens_at: v.opens_at || null, closes_at: v.closes_at || null,
        is_indicated: v.is_indicated ?? false, approved: false,
        is_demo: false, created_at: now(),
      };
      db.venues.push(venue);
      this.persist();
      return venue;
    },
    deleteVenue: async (id: string) => {
      const db = await this.requireAdmin();
      const reviewIds = new Set(db.reviews.filter((r) => r.venue_id === id).map((r) => r.id));
      const eventIds = new Set(db.events.filter((e) => e.venue_id === id).map((e) => e.id));
      db.venues = db.venues.filter((v) => v.id !== id);
      db.reviews = db.reviews.filter((r) => r.venue_id !== id);
      db.likes = db.likes.filter((l) => !reviewIds.has(l.review_id));
      db.reports = db.reports.filter((l) => !reviewIds.has(l.review_id));
      db.events = db.events.filter((e) => e.venue_id !== id);
      db.eventReviews = db.eventReviews.filter((r) => !eventIds.has(r.event_id));
      db.favorites = db.favorites.filter((f) => f.venue_id !== id && !(f.event_id && eventIds.has(f.event_id)));
      this.persist();
    },
    upsertEvent: async (e: Partial<EventItem> & { name: string; venue_id: string }) => {
      const db = await this.requireAdmin();
      if (!e.name.trim()) throw new ServiceError('Nome obrigatório.');
      if (!db.venues.some((v) => v.id === e.venue_id)) throw new ServiceError('Selecione o local do evento.');
      if (!e.event_date) throw new ServiceError('Informe a data do evento.');
      const slug = e.slug?.trim() || slugify(`${e.name}-${e.event_date}`);
      if (db.events.some((x) => x.slug === slug && x.id !== e.id)) throw new ServiceError('Já existe um evento com este slug.');
      if (e.id) {
        const cur = db.events.find((x) => x.id === e.id);
        if (!cur) throw new ServiceError('Evento não encontrado.');
        const { venue: _v, ...patch } = e as typeof e & { venue?: unknown };
        Object.assign(cur, patch, { slug });
        this.persist();
        return cur;
      }
      const ev: EventItem = {
        id: uid(), venue_id: e.venue_id, name: e.name.trim(), slug, description: e.description ?? '',
        cover_image: e.cover_image || '/images/stage-glow.jpg', event_date: e.event_date, start_time: e.start_time ?? '23:00',
        ticket_price: e.ticket_price ?? null, ticket_url: e.ticket_url ?? null, dj_names: e.dj_names ?? [],
        music_styles: e.music_styles ?? [], is_demo: false, created_at: now(),
      };
      db.events.push(ev);
      this.persist();
      return ev;
    },
    deleteEvent: async (id: string) => {
      const db = await this.requireAdmin();
      db.events = db.events.filter((e) => e.id !== id);
      db.eventReviews = db.eventReviews.filter((r) => r.event_id !== id);
      db.favorites = db.favorites.filter((f) => f.event_id !== id);
      this.persist();
    },
    listProfiles: async () => {
      const db = await this.requireAdmin();
      const counts = new Map<string, number>();
      db.reviews.forEach((r) => counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1));
      return db.profiles
        .map((p) => ({ ...p, review_count: counts.get(p.id) ?? 0 }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    setRole: async (userId: string, role: 'user' | 'admin') => {
      const db = await this.requireAdmin();
      if (userId === this.sessionUserId() && role !== 'admin') throw new ServiceError('Você não pode remover seu próprio acesso.');
      const p = db.profiles.find((x) => x.id === userId);
      if (!p) throw new ServiceError('Usuário não encontrado.');
      p.role = role;
      this.persist();
    },
    listReports: async () => {
      const db = await this.requireAdmin();
      const profiles = new Map(db.profiles.map((p) => [p.id, p]));
      const venues = new Map(db.venues.map((v) => [v.id, v]));
      return db.reports
        .slice()
        .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || b.created_at.localeCompare(a.created_at))
        .map((report) => {
          const review = db.reviews.find((r) => r.id === report.review_id) ?? null;
          return {
            report,
            reporter: profiles.get(report.user_id) ?? null,
            review,
            venue: review ? venues.get(review.venue_id) ?? null : null,
            author: review ? profiles.get(review.user_id) ?? null : null,
          };
        });
    },
    resolveReport: async (reportId: string, action: 'dismiss' | 'hide_review') => {
      const db = await this.requireAdmin();
      const rep = db.reports.find((r) => r.id === reportId);
      if (!rep) throw new ServiceError('Denúncia não encontrada.');
      const review = db.reviews.find((r) => r.id === rep.review_id);
      if (action === 'hide_review') {
        db.reports.filter((r) => r.review_id === rep.review_id && r.status === 'pending').forEach((r) => (r.status = 'upheld'));
        if (review) review.status = 'hidden';
      } else {
        rep.status = 'dismissed';
        const stillPending = db.reports.some((r) => r.review_id === rep.review_id && r.status === 'pending');
        if (review && review.status === 'flagged' && !stillPending) review.status = 'published';
      }
      this.persist();
    },
    setReviewStatus: async (reviewId: string, status: 'published' | 'flagged' | 'hidden') => {
      const db = await this.requireAdmin();
      const r = db.reviews.find((x) => x.id === reviewId);
      if (!r) throw new ServiceError('Avaliação não encontrada.');
      // Moderação altera apenas a visibilidade — nunca o conteúdo ou as notas.
      r.status = status;
      this.persist();
    },
    listNewsletter: async () => {
      const db = await this.requireAdmin();
      return db.newsletter.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    deleteNewsletter: async (id: string) => {
      const db = await this.requireAdmin();
      db.newsletter = db.newsletter.filter((n) => n.id !== id);
      this.persist();
    },
    updateSettings: async (s: Parameters<DataService['admin']['updateSettings']>[0]) => {
      const db = await this.requireAdmin();
      if (s.approved_min_rating < 0 || s.approved_min_rating > 10) throw new ServiceError('Nota mínima inválida.');
      if (s.approved_min_reviews < 1) throw new ServiceError('Quantidade mínima inválida.');
      if (s.bayes_prior_weight < 0) throw new ServiceError('Peso bayesiano inválido.');
      if (s.recency_half_life_days < 7) throw new ServiceError('Meia-vida mínima de 7 dias.');
      db.settings = { ...s };
      this.persist();
    },
    removeDemoData: async () => {
      const db = await this.requireAdmin();
      const me = this.sessionUserId();
      const keepProfile = (p: Profile) => !p.is_demo || p.id === me;
      const demoVenueIds = new Set(db.venues.filter((v) => v.is_demo).map((v) => v.id));
      db.venues = db.venues.filter((v) => !v.is_demo);
      db.events = db.events.filter((e) => !e.is_demo && !demoVenueIds.has(e.venue_id));
      const eventIds = new Set(db.events.map((e) => e.id));
      db.reviews = db.reviews.filter((r) => !r.is_demo && !demoVenueIds.has(r.venue_id));
      const reviewIds = new Set(db.reviews.map((r) => r.id));
      db.eventReviews = db.eventReviews.filter((r) => !r.is_demo && eventIds.has(r.event_id));
      db.likes = db.likes.filter((l) => reviewIds.has(l.review_id));
      db.reports = db.reports.filter((r) => reviewIds.has(r.review_id));
      db.revisions = db.revisions.filter((r) => reviewIds.has(r.review_id));
      db.favorites = db.favorites.filter((f) => (f.venue_id ? !demoVenueIds.has(f.venue_id) : eventIds.has(f.event_id!)));
      db.profiles = db.profiles.filter(keepProfile);
      db.credentials = db.credentials.filter((c) => db.profiles.some((p) => p.id === c.user_id));
      this.persist();
    },
    resetDemo: async () => {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('classifydj:plus-db'); // assinaturas/preferências Classify+ do modo demo
      this.db = null;
      this.loading = null;
      await this.load();
      this.emit(null);
    },
  };
}

