// ---------------------------------------------------------------
// Domain types — mirror the Supabase schema (supabase/migrations)
// ---------------------------------------------------------------

export type VenueCategory = 'boate' | 'festa' | 'festival' | 'experiencia';
export type UserRole = 'user' | 'admin';
export type ReviewStatus = 'published' | 'flagged' | 'hidden';
export type ReportStatus = 'pending' | 'dismissed' | 'upheld';

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  city: string | null;
  bio: string | null;
  role: UserRole;
  is_demo: boolean;
  created_at: string;
}

export interface Venue {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: VenueCategory;
  city: string;
  state: string;
  neighborhood: string;
  address: string;
  latitude: number;
  longitude: number;
  cover_image: string;
  gallery: string[];
  instagram_url: string | null;
  website_url: string | null;
  /** 1 a 4 — R$ a R$$$$ */
  price_range: number;
  music_styles: string[];
  opening_days: string[];
  /** Calculado pelo sistema (selo Classify Approved). */
  approved: boolean;
  is_demo: boolean;
  created_at: string;
}

export const CRITERIA = [
  { key: 'music_rating', label: 'Música e DJs', weight: 0.2 },
  { key: 'crowd_rating', label: 'Público', weight: 0.15 },
  { key: 'atmosphere_rating', label: 'Ambiente', weight: 0.15 },
  { key: 'drinks_rating', label: 'Bebidas e preços', weight: 0.1 },
  { key: 'service_rating', label: 'Atendimento', weight: 0.1 },
  { key: 'organization_rating', label: 'Organização e filas', weight: 0.1 },
  { key: 'experience_rating', label: 'Experiência geral', weight: 0.2 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];
export type CriteriaScores = Record<CriterionKey, number>;

export interface VenueReview extends CriteriaScores {
  id: string;
  user_id: string;
  venue_id: string;
  /** Calculada no servidor a partir dos critérios (trigger no Postgres). */
  overall_rating: number;
  comment: string;
  experience_date: string | null;
  photos: string[];
  status: ReviewStatus;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewRevision extends CriteriaScores {
  id: string;
  review_id: string;
  overall_rating: number;
  comment: string;
  experience_date: string | null;
  created_at: string;
}

export interface EventItem {
  id: string;
  venue_id: string;
  name: string;
  slug: string;
  description: string;
  cover_image: string;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  ticket_price: number | null;
  ticket_url: string | null;
  dj_names: string[];
  music_styles: string[];
  is_demo: boolean;
  created_at: string;
}

export interface EventReview {
  id: string;
  user_id: string;
  event_id: string;
  rating: number;
  comment: string;
  is_demo: boolean;
  created_at: string;
}

export interface Favorite {
  id: string;
  user_id: string;
  venue_id: string | null;
  event_id: string | null;
  created_at: string;
}

export interface ReviewLike {
  id: string;
  user_id: string;
  review_id: string;
  created_at: string;
}

export interface ReviewReport {
  id: string;
  user_id: string;
  review_id: string;
  reason: string;
  status: ReportStatus;
  created_at: string;
}

export interface NewsletterEntry {
  id: string;
  email: string;
  created_at: string;
}

export interface PlatformSettings {
  approved_min_rating: number;
  approved_min_reviews: number;
  /** Proporção máxima de avaliações denunciadas/ocultas para manter o selo. */
  approved_max_flag_ratio: number;
  /** Peso "m" da média bayesiana (avaliações fictícias na média global). */
  bayes_prior_weight: number;
  /** Meia-vida em dias para o peso de recência. */
  recency_half_life_days: number;
  music_styles: string[];
}

// ---------------- Derived / view models ----------------

export interface VenueStats {
  venue_id: string;
  review_count: number;
  /** Média simples (exibida ao usuário). */
  avg_rating: number;
  /** Pontuação bayesiana ponderada por recência (usada no ranking). */
  score: number;
  criteria: CriteriaScores;
  /** Distribuição: índices 0..4 => [9-10, 7-8.9, 5-6.9, 3-4.9, 0-2.9] */
  distribution: number[];
  flagged_ratio: number;
  approved: boolean;
}

export type RankingCategory = 'all' | 'boates' | 'festas' | 'festivais' | 'experiencias' | 'hype' | 'ascensao';
export type RankingPeriod = 'geral' | 'semana' | 'mes' | 'historico';

export interface RankingQuery {
  category?: RankingCategory;
  period?: RankingPeriod;
  city?: string;
  state?: string;
  minRating?: number;
  limit?: number;
}

export interface RankingRow {
  position: number;
  venue: Venue;
  stats: VenueStats;
  /** Variação de posição em relação a 7 dias atrás (positivo = subiu). null = sem histórico. */
  change: number | null;
  /** Avaliações no período considerado. */
  period_count: number;
}

export type ReviewSort = 'recent' | 'best' | 'liked' | 'useful';

export interface ReviewQuery {
  venueId?: string;
  userId?: string;
  city?: string;
  category?: VenueCategory;
  minRating?: number;
  sinceDays?: number;
  sort?: ReviewSort;
  limit?: number;
  includeHidden?: boolean;
}

export interface ReviewWithMeta {
  review: VenueReview;
  author: Profile;
  venue: Venue;
  likes: number;
  likedByMe: boolean;
}

export interface EventReviewWithMeta {
  review: EventReview;
  author: Profile;
}

export interface ReviewInput extends CriteriaScores {
  venue_id: string;
  comment: string;
  experience_date: string | null;
  photos: string[];
}

export interface VenueFilter {
  city?: string;
  state?: string;
  category?: VenueCategory;
  style?: string;
  maxPrice?: number;
  minRating?: number;
  search?: string;
}

export interface EventFilter {
  venueId?: string;
  from?: string;
  to?: string;
  style?: string;
  city?: string;
  maxPrice?: number;
  upcomingOnly?: boolean;
  pastOnly?: boolean;
}

export interface UserStats {
  review_count: number;
  likes_received: number;
}

export interface AdminMetrics {
  users: number;
  venues: number;
  reviews: number;
  events: number;
  avg_rating: number;
  newsletter: number;
  pending_reports: number;
  popular: { venue: Venue; review_count: number; avg_rating: number }[];
}

export interface ReportWithMeta {
  report: ReviewReport;
  reporter: Profile | null;
  review: VenueReview | null;
  venue: Venue | null;
  author: Profile | null;
}
