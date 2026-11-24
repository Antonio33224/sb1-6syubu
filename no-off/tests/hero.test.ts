import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_FALLBACK_IMAGE,
  compactPrice,
  countdownText,
  currentLot,
  fitFontSize,
  selectHeroEvents,
  shortTime,
  splitBalanced,
  toSlide,
  type HeroSource,
} from '../src/components/home/hero/hero-data';
import { placeholderVenue } from '../src/lib/public-events';
import type { PublicBatch } from '../src/types';

const TODAY = '2026-12-01';

function ev(over: Partial<HeroSource> = {}): HeroSource {
  const id = over.id ?? 'e1';
  return {
    id,
    venue_id: 'v1',
    name: 'Noite Vermelha',
    slug: `slug-${id}`,
    description: '',
    cover_image: '/c.jpg',
    event_date: '2026-12-12',
    start_time: '23:00',
    ticket_price: 60,
    ticket_url: null,
    dj_names: ['DJ A', 'DJ B', 'DJ C'],
    music_styles: [],
    is_demo: false,
    created_at: '2026-01-01T00:00:00Z',
    city: 'São Paulo',
    state: 'SP',
    has_tickets: true,
    hidden: { name: false, price: false, location: false, capacity: false },
    venue: { ...placeholderVenue({ id, name: 'Club X', city: 'São Paulo', state: 'SP' }) },
    ...over,
  };
}

function batch(over: Partial<PublicBatch> = {}): PublicBatch {
  return {
    batch_id: 'b',
    ticket_type: 'pista',
    name: '2º lote',
    price: 80,
    available: 10,
    sales_start: null,
    sales_end: null,
    state: 'on_sale',
    max_per_order: 6,
    sales_locked: false,
    ...over,
  };
}

test('hero: seleciona até 5 festas com venda aberta, destaque primeiro e depois data', () => {
  const list = [
    ev({ id: 'past', event_date: '2026-11-20' }),
    ev({ id: 'nosale', has_tickets: false, ticket_url: null }),
    ev({ id: 'link', has_tickets: false, ticket_url: 'https://x', event_date: '2026-12-03' }),
    ev({ id: 'late', event_date: '2026-12-20' }),
    ev({ id: 'early', event_date: '2026-12-02', start_time: '22:00' }),
    ev({ id: 'early2', event_date: '2026-12-02', start_time: '23:00' }),
    ev({ id: 'feat', event_date: '2026-12-30', featured: true }),
    ev({ id: 'extra', event_date: '2026-12-25' }),
  ];
  const ids = selectHeroEvents(list, TODAY).map((e) => e.id);
  assert.deepEqual(ids, ['feat', 'early', 'early2', 'link', 'late']);
});

test('hero: lote atual prefere Pista à venda e o mais barato', () => {
  const lot = currentLot([
    batch({ batch_id: 'vip', ticket_type: 'vip', name: '1º lote VIP', price: 40 }),
    batch({ batch_id: 'p2', name: '3º lote', price: 120 }),
    batch({ batch_id: 'p1', name: '2º lote', price: 80, sales_end: '2026-12-02T03:00:00Z' }),
  ]);
  assert.deepEqual(lot, { label: '2º lote', price: 80, endsAt: '2026-12-02T03:00:00Z', soldOut: false });
});

test('hero: sem lote à venda mostra o próximo; nada a vender = esgotado; sem lotes = null', () => {
  assert.equal(currentLot([batch({ state: 'sold_out' }), batch({ state: 'upcoming', name: '3º lote', price: 100 })])?.label, '3º lote');
  assert.equal(currentLot([batch({ state: 'sold_out' }), batch({ state: 'ended' })])?.soldOut, true);
  assert.equal(currentLot([]), null);
  assert.equal(currentLot(null), null);
});

test('hero: contagem regressiva só abaixo de 48h', () => {
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(countdownText('2026-12-01T01:02:03Z', now), '01:02:03');
  assert.equal(countdownText('2026-12-02T23:59:59Z', now), '47:59:59');
  assert.equal(countdownText('2026-12-03T00:00:00Z', now), null);
  assert.equal(countdownText('2026-11-30T23:00:00Z', now), null);
  assert.equal(countdownText(null, now), null);
});

test('hero: formatação curta', () => {
  assert.equal(compactPrice(80), 'R$80');
  assert.equal(compactPrice(42.5), 'R$42,50');
  assert.equal(compactPrice(0), 'Grátis');
  assert.equal(compactPrice(null), null);
  assert.equal(shortTime('23:00'), '23H');
  assert.equal(shortTime('22:30'), '22H30');
});

test('hero: nome em 2 linhas equilibradas e ajuste de fonte', () => {
  assert.deepEqual(splitBalanced('NOITE'), ['NOITE']);
  assert.deepEqual(splitBalanced('A NOITE MAIS LONGA'), ['A NOITE', 'MAIS LONGA']);
  assert.equal(fitFontSize(1000, 500, 100), 194);
  assert.equal(fitFontSize(1000, 500, 100, 120), 120);
  assert.ok(fitFontSize(300, 3000, 100) * 30 <= 300, 'nunca passa da largura');
});

test('hero: slide normal com lote', () => {
  const s = toSlide(ev(), { label: '2º lote', price: 80, endsAt: null, soldOut: false });
  assert.equal(s.mode, 'buy');
  assert.equal(s.href, '/eventos/slug-e1');
  assert.equal(s.when, 'SÁBADO 12 DEZ · 23H');
  assert.equal(s.chapterDay, 'SÁB 12');
  assert.equal(s.place, 'Club X');
  assert.equal(s.placeSub, 'São Paulo · SP');
  assert.equal(s.subtitle, 'DJ A · DJ B');
  assert.equal(s.priceText, 'R$80');
  assert.equal(s.ariaBuy, 'Comprar ingresso — Noite Vermelha, R$80, 2º lote');
});

test('hero: sem lotes usa o preço do evento e a imagem padrão quando faltar capa', () => {
  const s = toSlide(ev({ cover_image: '', music_styles: ['Techno', 'House', 'Trance'] }), null);
  assert.equal(s.priceText, 'R$60');
  assert.equal(s.lotLabel, null);
  assert.equal(s.subtitle, 'Techno · House');
  assert.equal(s.image, HERO_FALLBACK_IMAGE);
});

test('hero: campos ocultos e esgotado', () => {
  const hidden = toSlide(
    ev({ name: 'Nome revelado em breve', hidden: { name: true, price: true, location: true, capacity: false } }),
    { label: '2º lote', price: null, endsAt: '2026-12-02T00:00:00Z', soldOut: false },
  );
  assert.equal(hidden.title, 'Revelado em breve');
  assert.equal(hidden.place, 'Local em breve');
  assert.equal(hidden.mode, 'notify');
  assert.equal(hidden.priceText, 'Em breve');
  assert.equal(hidden.ringText, 'Me avise');
  assert.equal(hidden.endsAt, null);
  assert.equal(hidden.lotLabel, null);

  const sold = toSlide(ev(), { label: null, price: null, endsAt: null, soldOut: true });
  assert.equal(sold.mode, 'waitlist');
  assert.equal(sold.ringText, 'Lista de espera');
});
