import type {
  AdminMetrics,
  EventFilter,
  EventItem,
  EventReviewWithMeta,
  Favorite,
  NewsletterEntry,
  PlatformSettings,
  Profile,
  RankingQuery,
  RankingRow,
  ReportWithMeta,
  ReviewInput,
  ReviewQuery,
  ReviewRevision,
  ReviewWithMeta,
  UserRole,
  UserStats,
  Venue,
  VenueFilter,
  VenueReview,
  VenueStats,
  ReviewStatus,
} from '@/types';
import type { ImportResult, ReviewImportRow } from '@/lib/review-import';

export type DataMode = 'demo' | 'supabase';

export class ServiceError extends Error {}

export type ImageBucket = 'avatars' | 'review-photos' | 'venue-images';

/**
 * Contrato único consumido pela interface. Duas implementações:
 *  - DemoService: banco local (localStorage) com dados demonstrativos.
 *  - SupabaseService: Postgres + Auth + Storage com RLS.
 */
export interface DataService {
  readonly mode: DataMode;

  // ---- auth
  getCurrentUser(): Promise<Profile | null>;
  onAuthChange(cb: (p: Profile | null) => void): () => void;
  signUp(input: { email: string; password: string; username: string; full_name: string }): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<{ demoLink?: string }>;
  updatePassword(password: string, token?: string): Promise<void>;

  // ---- venues
  listVenues(filter?: VenueFilter): Promise<Venue[]>;
  getVenue(slug: string): Promise<Venue | null>;
  getVenueStats(venueId: string): Promise<VenueStats | null>;
  getAllStats(): Promise<Record<string, VenueStats>>;
  listCities(): Promise<{ city: string; state: string }[]>;

  // ---- rankings
  getRankings(q: RankingQuery): Promise<RankingRow[]>;

  // ---- reviews
  listReviews(q: ReviewQuery): Promise<ReviewWithMeta[]>;
  getMyReview(venueId: string): Promise<VenueReview | null>;
  upsertReview(input: ReviewInput): Promise<VenueReview>;
  deleteMyReview(reviewId: string): Promise<void>;
  listRevisions(reviewId: string): Promise<ReviewRevision[]>;
  toggleLike(reviewId: string): Promise<boolean>;
  reportReview(reviewId: string, reason: string): Promise<void>;

  // ---- events
  listEvents(filter?: EventFilter): Promise<(EventItem & { venue: Venue })[]>;
  getEvent(slug: string): Promise<(EventItem & { venue: Venue }) | null>;
  listEventReviews(eventId: string): Promise<EventReviewWithMeta[]>;
  upsertEventReview(eventId: string, rating: number, comment: string): Promise<void>;

  // ---- favorites
  listFavorites(userId: string): Promise<Favorite[]>;
  toggleFavorite(target: { venueId?: string; eventId?: string }): Promise<boolean>;

  // ---- profiles
  getProfileByUsername(username: string): Promise<Profile | null>;
  updateProfile(patch: Partial<Pick<Profile, 'full_name' | 'username' | 'city' | 'bio' | 'avatar_url'>>): Promise<Profile>;
  getUserStats(userId: string): Promise<UserStats>;
  uploadImage(file: File, bucket: ImageBucket): Promise<string>;

  // ---- newsletter
  subscribeNewsletter(email: string): Promise<'created' | 'exists'>;

  // ---- admin
  getSettings(): Promise<PlatformSettings>;
  admin: {
    metrics(): Promise<AdminMetrics>;
    upsertVenue(v: Partial<Venue> & { name: string }): Promise<Venue>;
    deleteVenue(id: string): Promise<void>;
    upsertEvent(e: Partial<EventItem> & { name: string; venue_id: string }): Promise<EventItem>;
    deleteEvent(id: string): Promise<void>;
    listProfiles(): Promise<(Profile & { review_count: number })[]>;
    setRole(userId: string, role: UserRole): Promise<void>;
    listReports(): Promise<ReportWithMeta[]>;
    resolveReport(reportId: string, action: 'dismiss' | 'hide_review'): Promise<void>;
    setReviewStatus(reviewId: string, status: ReviewStatus): Promise<void>;
    /** Importa avaliações reais do pré-lançamento (tudo ou nada). Linhas já validadas por parseReviewImport. */
    importReviews(rows: ReviewImportRow[]): Promise<ImportResult>;
    listNewsletter(): Promise<NewsletterEntry[]>;
    deleteNewsletter(id: string): Promise<void>;
    updateSettings(s: PlatformSettings): Promise<void>;
    removeDemoData(): Promise<void>;
    resetDemo?(): Promise<void>;
  };
}
