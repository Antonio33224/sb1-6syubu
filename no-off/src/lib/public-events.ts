/**
 * Mapeamento das linhas de public.public_events (view do banco).
 *
 * A view já devolve NULL nos campos ocultos pelo super admin — o valor real
 * nunca chega ao navegador. Aqui só trocamos o NULL por um texto de exibição
 * ("Em breve" / "Revelado em breve") e, com o local oculto, por um marcador de
 * casa SEM dados reais (sem slug, endereço ou coordenadas).
 */
import type { EventWithVenue, HiddenFields, Venue, VenueCategory } from '@/types';

export const HIDDEN_TEXT = {
  name: 'Nome revelado em breve',
  location: 'Local revelado em breve',
  price: 'Em breve',
  capacity: 'Em breve',
} as const;

/** Colunas lidas da view (nunca `*` de events). */
export const PUBLIC_EVENT_COLUMNS =
  'id, slug, name, description, cover_image, gallery, event_date, start_time, category, ticket_price, ticket_url, venue_id, location_name, address, city, state, capacity, tickets_sold, dj_names, music_styles, is_demo, created_at, name_hidden, price_hidden, location_hidden, capacity_hidden, has_tickets';

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Casa "fantasma" usada quando o local está oculto ou a festa não é numa casa cadastrada. */
export function placeholderVenue(opts: { id: string; name: string; city: string; state: string; category?: VenueCategory; address?: string | null; cover?: string }): Venue {
  return {
    id: `placeholder:${opts.id}`,
    name: opts.name,
    slug: '',
    description: '',
    category: opts.category ?? 'festa',
    city: opts.city,
    state: opts.state,
    neighborhood: '',
    address: opts.address ?? '',
    latitude: 0,
    longitude: 0,
    cover_image: opts.cover ?? '',
    gallery: [],
    instagram_url: null,
    website_url: null,
    price_range: 2,
    music_styles: [],
    opening_days: [],
    approved: false,
    is_demo: false,
    created_at: new Date(0).toISOString(),
  };
}

/** Marcador de casa? (sem página própria, sem mapa). */
export const isPlaceholderVenue = (v: Pick<Venue, 'id'>) => v.id.startsWith('placeholder:');

export function mapPublicEvent(row: Record<string, unknown>, venues: Map<string, Venue>): EventWithVenue {
  const hidden: HiddenFields = {
    name: Boolean(row.name_hidden),
    price: Boolean(row.price_hidden),
    location: Boolean(row.location_hidden),
    capacity: Boolean(row.capacity_hidden),
  };
  const id = String(row.id);
  const city = (row.city as string) ?? '';
  const state = (row.state as string) ?? '';
  const venueId = (row.venue_id as string) ?? null;
  const real = venueId ? venues.get(venueId) : undefined;
  const venue =
    real ??
    placeholderVenue({
      id,
      name: hidden.location ? HIDDEN_TEXT.location : ((row.location_name as string) || 'Local a confirmar'),
      city,
      state,
      category: (row.category as VenueCategory) ?? 'festa',
      address: hidden.location ? null : ((row.address as string) ?? null),
      cover: (row.cover_image as string) ?? '',
    });
  return {
    id,
    venue_id: venueId,
    name: hidden.name ? HIDDEN_TEXT.name : String(row.name ?? ''),
    slug: String(row.slug),
    description: (row.description as string) ?? '',
    cover_image: (row.cover_image as string) ?? '',
    gallery: (row.gallery as string[]) ?? [],
    event_date: String(row.event_date),
    start_time: (row.start_time as string) ?? '23:00',
    category: (row.category as VenueCategory) ?? 'festa',
    ticket_price: n(row.ticket_price),
    ticket_url: (row.ticket_url as string) ?? null,
    location_name: (row.location_name as string) ?? null,
    address: (row.address as string) ?? null,
    city,
    state,
    capacity: n(row.capacity),
    tickets_sold: n(row.tickets_sold),
    dj_names: (row.dj_names as string[]) ?? [],
    music_styles: (row.music_styles as string[]) ?? [],
    is_demo: Boolean(row.is_demo),
    created_at: String(row.created_at),
    has_tickets: Boolean(row.has_tickets),
    hidden,
    venue,
  };
}

/** Preço curto para listas/cards: "Em breve" quando oculto (nunca "Gratuito" por engano). */
export function eventPriceText(e: Pick<EventWithVenue, 'ticket_price' | 'hidden' | 'has_tickets'>, fmt: (n: number | null) => string): string {
  if (e.hidden?.price) return HIDDEN_TEXT.price;
  if (e.ticket_price === null || e.ticket_price === undefined) return e.has_tickets ? '—' : fmt(null);
  return fmt(e.ticket_price);
}

/** Rótulo de preço para cards ("a partir de"), respeitando campos ocultos. */
export function priceLabel(e: Pick<EventWithVenue, 'ticket_price' | 'hidden'>, fmt: (n: number) => string): string | null {
  if (e.hidden?.price) return HIDDEN_TEXT.price;
  if (e.ticket_price === null || e.ticket_price === undefined) return null;
  return e.ticket_price === 0 ? 'Gratuito' : `a partir de ${fmt(e.ticket_price)}`;
}
