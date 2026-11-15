import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRange, hasAvgPrice, normalizePrices, priceBreakdown, validatePrices } from '../src/lib/pricing';
import { buildDemoDatabase, DEMO_PRICES } from '../src/data/demo-seed';
import { byDateTime, weekWindow } from '../src/lib/week';
import type { Venue } from '../src/types';

const nbsp = (s: string | null) => s?.replace(/ /g, ' ') ?? null;

test('faixas de preço: formatação e ausência de valor', () => {
  assert.equal(nbsp(formatRange(30, 60)), 'R$ 30–60');
  assert.equal(nbsp(formatRange(30, null)), 'a partir de R$ 30');
  assert.equal(nbsp(formatRange(null, 60)), 'até R$ 60');
  assert.equal(formatRange(null, null), null);
});

test('preço não informado nunca vira zero', () => {
  const n = normalizePrices({ avg_price: undefined, entry_price_min: 40 });
  assert.equal(n.avg_price, null);
  assert.equal(n.entry_price_min, 40);
  assert.equal(hasAvgPrice({ avg_price: null } as Venue), false);
  assert.deepEqual(priceBreakdown({} as Venue), []);
});

test('validação: negativos e mínimo maior que máximo são rejeitados', () => {
  assert.ok(validatePrices({ avg_price: -1 }));
  assert.ok(validatePrices({ drink_price_min: 50, drink_price_max: 20 }));
  assert.equal(validatePrices({ avg_price: 120, entry_price_min: 30, entry_price_max: 60 }), null);
  assert.equal(validatePrices({ avg_price: null }), null);
});

test('dados demo: preços só onde definidos; demais ficam "não informado"', () => {
  const db = buildDemoDatabase(Date.UTC(2026, 10, 14, 15));
  for (const v of db.venues) {
    if (DEMO_PRICES[v.slug]) assert.equal(v.avg_price, DEMO_PRICES[v.slug]![0]);
    else assert.equal(v.avg_price, null);
    assert.ok(v.is_demo);
  }
  assert.ok(db.venues.some((v) => v.avg_price === null), 'deve existir ao menos uma casa sem preço para o estado vazio');
});

test('atrações da semana: cada evento pertence a uma única casa e IDs são únicos', () => {
  const db = buildDemoDatabase(Date.UTC(2026, 10, 14, 15));
  const venueIds = new Set(db.venues.map((v) => v.id));
  assert.equal(new Set(db.events.map((e) => e.id)).size, db.events.length);
  for (const e of db.events) assert.ok(venueIds.has(e.venue_id));
  const sorted = [...db.events].sort(byDateTime);
  for (let i = 1; i < sorted.length; i++) assert.ok(byDateTime(sorted[i - 1]!, sorted[i]!) <= 0);
  const w = weekWindow(new Date(2026, 10, 14, 12));
  assert.equal(w.days.length, 7);
  assert.equal(w.from, '2026-11-14');
  assert.equal(w.to, '2026-11-20');
});
