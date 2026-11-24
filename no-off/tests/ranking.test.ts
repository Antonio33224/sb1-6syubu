import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverall } from '../src/lib/rating';
import { computeRankings, computeVenueStats, DEFAULT_SETTINGS, isApproved } from '../src/lib/ranking';
import { levelFor } from '../src/lib/levels';
import type { Venue, VenueReview } from '../src/types';

const NOW = Date.UTC(2026, 10, 14);
const DAY = 86_400_000;

const venue = (id: string, extra: Partial<Venue> = {}): Venue => ({
  id, name: id, slug: id, description: '', category: 'boate', city: 'Rio de Janeiro', state: 'RJ', neighborhood: '', address: '',
  latitude: 0, longitude: 0, cover_image: '', gallery: [], instagram_url: null, website_url: null, price_range: 2, music_styles: [],
  opening_days: [], approved: false, is_demo: false, created_at: new Date(NOW).toISOString(), ...extra,
});

let n = 0;
const review = (venueId: string, rating: number, ageDays = 1, status: VenueReview['status'] = 'published'): VenueReview => {
  const at = new Date(NOW - ageDays * DAY).toISOString();
  return {
    id: `r${++n}`, user_id: `u${n}`, venue_id: venueId, music_rating: rating, crowd_rating: rating, atmosphere_rating: rating,
    drinks_rating: rating, service_rating: rating, organization_rating: rating, experience_rating: rating, overall_rating: rating,
    comment: '', experience_date: null, photos: [], status, is_demo: false, created_at: at, updated_at: at,
  };
};

test('nota geral é a média ponderada dos critérios', () => {
  assert.equal(computeOverall({ music_rating: 10, crowd_rating: 10, atmosphere_rating: 10, drinks_rating: 10, service_rating: 10, organization_rating: 10, experience_rating: 10 }), 10);
  // música 20% e experiência 20% pesam mais que bebidas 10%
  const a = computeOverall({ music_rating: 10, crowd_rating: 5, atmosphere_rating: 5, drinks_rating: 5, service_rating: 5, organization_rating: 5, experience_rating: 5 });
  const b = computeOverall({ music_rating: 5, crowd_rating: 5, atmosphere_rating: 5, drinks_rating: 10, service_rating: 5, organization_rating: 5, experience_rating: 5 });
  assert.equal(a, 6);
  assert.equal(b, 5.5);
});

test('média bayesiana: poucas avaliações nota 10 não superam muitas avaliações nota 9.3', () => {
  // 'rest' representa o resto da plataforma, dando uma média global realista (C ≈ 8).
  const venues = [venue('few'), venue('many'), venue('rest')];
  const reviews = [
    review('few', 10),
    review('few', 10),
    ...Array.from({ length: 60 }, () => review('many', 9.3)),
    ...Array.from({ length: 40 }, () => review('rest', 6)),
  ];
  const rows = computeRankings({ venues, reviews, likes: [], settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(rows[0]!.venue.id, 'many');
  assert.equal(rows[1]!.stats.avg_rating, 10); // a média exibida continua real
});

test('avaliações ocultas não contam; sinalizadas contam com peso reduzido', () => {
  const s = computeVenueStats('v', [review('v', 9), review('v', 1, 1, 'hidden')], { now: NOW, settings: DEFAULT_SETTINGS, globalMean: 7 });
  assert.equal(s.review_count, 1);
  assert.equal(s.avg_rating, 9);
});

test('recência: avaliações antigas pesam menos', () => {
  const recentGood = computeVenueStats('v', [review('v', 9, 2), review('v', 5, 700)], { now: NOW, settings: DEFAULT_SETTINGS, globalMean: 7 });
  const oldGood = computeVenueStats('v', [review('v', 9, 700), review('v', 5, 2)], { now: NOW, settings: DEFAULT_SETTINGS, globalMean: 7 });
  assert.ok(recentGood.score > oldGood.score);
  assert.equal(recentGood.avg_rating, oldGood.avg_rating);
});

test('selo Approved respeita nota mínima, volume e sinais de manipulação', () => {
  assert.equal(isApproved(9, 25, 0, DEFAULT_SETTINGS), true);
  assert.equal(isApproved(9, 10, 0, DEFAULT_SETTINGS), false);
  assert.equal(isApproved(8.2, 40, 0, DEFAULT_SETTINGS), false);
  assert.equal(isApproved(9, 40, 0.3, DEFAULT_SETTINGS), false);
});

test('ranking semanal considera apenas avaliações dos últimos 7 dias', () => {
  const venues = [venue('a'), venue('b')];
  const reviews = [review('a', 9, 30), review('b', 7, 2)];
  const rows = computeRankings({ venues, reviews, likes: [], settings: DEFAULT_SETTINGS, now: NOW }, { period: 'semana' });
  assert.deepEqual(rows.map((r) => r.venue.id), ['b']);
});

test('variação de posição compara com o ranking de 7 dias atrás', () => {
  const venues = [venue('a'), venue('b')];
  const reviews = [...Array.from({ length: 5 }, () => review('a', 8, 30)), ...Array.from({ length: 30 }, () => review('b', 9.8, 2))];
  const rows = computeRankings({ venues, reviews, likes: [], settings: DEFAULT_SETTINGS, now: NOW });
  assert.equal(rows[0]!.venue.id, 'b');
  assert.equal(rows[0]!.change, null); // b não existia no ranking de 7 dias atrás
  assert.equal(rows[1]!.change, -1);
});

test('níveis de usuário', () => {
  assert.equal(levelFor(0), null);
  assert.equal(levelFor(1)?.name, 'Night Beginner');
  assert.equal(levelFor(5)?.name, 'Night Explorer');
  assert.equal(levelFor(15)?.name, 'Night Expert');
  assert.equal(levelFor(30)?.name, 'Night Legend');
});
