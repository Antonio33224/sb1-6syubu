/**
 * Alertas Classify+ — gera notificações a partir de eventos REAIS cadastrados
 * que envolvem favoritos do usuário. Idempotente via `dedupe_key`.
 * Espelhado no Postgres por `notify_event_followers()` / `sync_my_notifications()`.
 */
import type { AlertSettings, ArtistFavorite, EventItem, Favorite, PlusNotification, Venue } from '@/types';

const DAY = 86_400_000;
const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Igual a `public.normalize_name()` no SQL. */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const DEFAULT_ALERTS: AlertSettings = { enabled: true, venues: true, artists: true, events: true, email: false, push: false };

/** "neste sábado", "amanhã", "hoje" ou "em 12/12". */
export function relativeDay(date: string, now = Date.now()): string {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / DAY);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff > 1 && diff < 7) return `${d.getDay() === 0 || d.getDay() === 6 ? 'neste' : 'nesta'} ${WEEKDAY[d.getDay()]}`;
  return `em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Draft = Pick<PlusNotification, 'kind' | 'title' | 'body' | 'link' | 'venue_id' | 'event_id' | 'dedupe_key'>;

export function buildAlerts(input: {
  events: (EventItem & { venue: Venue })[];
  favorites: Favorite[];
  artists: ArtistFavorite[];
  settings: AlertSettings;
  existingKeys: Set<string>;
  now?: number;
}): Draft[] {
  const { events, favorites, artists, settings, existingKeys } = input;
  const now = input.now ?? Date.now();
  if (!settings.enabled) return [];
  const today = new Date(now).toISOString().slice(0, 10);
  const in7 = new Date(now + 7 * DAY).toISOString().slice(0, 10);
  const in3 = new Date(now + 3 * DAY).toISOString().slice(0, 10);
  const favVenues = new Set(favorites.filter((f) => f.venue_id).map((f) => f.venue_id!));
  const favEvents = new Set(favorites.filter((f) => f.event_id).map((f) => f.event_id!));
  const artistByKey = new Map(artists.map((a) => [a.name_key, a]));
  const out: Draft[] = [];
  const push = (d: Draft) => {
    if (existingKeys.has(d.dedupe_key) || out.some((o) => o.dedupe_key === d.dedupe_key)) return;
    out.push(d);
  };

  for (const e of events) {
    if (e.event_date < today) continue;
    const when = relativeDay(e.event_date, now);
    const link = `/eventos/${e.slug}`;

    if (settings.artists) {
      for (const dj of e.dj_names) {
        const fav = artistByKey.get(normalizeName(dj));
        if (!fav) continue;
        push({
          kind: 'artist_event',
          title: `${fav.kind === 'dj' ? 'Seu DJ favorito' : 'Seu artista favorito'} vai tocar ${when}!`,
          body: `${dj} está no line-up de ${e.name}, em ${e.venue.name}.`,
          link, venue_id: e.venue_id, event_id: e.id,
          dedupe_key: `dj:${e.id}:${fav.name_key}`,
        });
      }
    }
    if (settings.venues && favVenues.has(e.venue_id)) {
      const thisWeek = e.event_date <= in7;
      push({
        kind: 'venue_event',
        title: thisWeek ? 'Uma nova atração foi adicionada à programação desta semana.' : `Nova festa anunciada na sua ${e.venue.category === 'boate' ? 'boate' : 'casa'} favorita.`,
        body: `${e.venue.name}: ${e.name} — ${when}${e.start_time ? `, às ${e.start_time}` : ''}.`,
        link, venue_id: e.venue_id, event_id: e.id,
        dedupe_key: `venue:${e.id}`,
      });
    }
    if (settings.events && favEvents.has(e.id) && e.event_date <= in3) {
      push({
        kind: 'event_reminder',
        title: `Seu evento salvo é ${when}.`,
        body: `${e.name} em ${e.venue.name}${e.start_time ? `, às ${e.start_time}` : ''}.`,
        link, venue_id: e.venue_id, event_id: e.id,
        dedupe_key: `event:${e.id}:reminder`,
      });
    }
  }
  return out;
}
