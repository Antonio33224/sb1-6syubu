import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRange, hasAvgPrice, normalizePrices, priceBreakdown, validatePrices } from '../src/lib/pricing';
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

test('atrações da semana: ordenação por data/hora e janela de 7 dias', () => {
  const events = [
    { event_date: '2026-11-16', start_time: '23:00' },
    { event_date: '2026-11-14', start_time: '22:00' },
    { event_date: '2026-11-14', start_time: '20:00' },
  ];
  const sorted = [...events].sort(byDateTime);
  assert.deepEqual(sorted.map((e) => `${e.event_date} ${e.start_time}`), ['2026-11-14 20:00', '2026-11-14 22:00', '2026-11-16 23:00']);
  for (let i = 1; i < sorted.length; i++) assert.ok(byDateTime(sorted[i - 1]!, sorted[i]!) <= 0);
  const w = weekWindow(new Date(2026, 10, 14, 12));
  assert.equal(w.days.length, 7);
  assert.equal(w.from, '2026-11-14');
  assert.equal(w.to, '2026-11-20');
});
