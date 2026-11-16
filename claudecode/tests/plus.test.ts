import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { personalScore, rankByPreferences, normalizeWeights, PUBLIC_WEIGHTS } from '../src/lib/plus/personal-ranking';
import {
  annualMonthlyEquivalentCents, annualSavingsRatio, hasPremiumAccess, isTrialEligible, mapStripeStatus, resolveAccess,
  showThirdPartyAds, weightedTicketCents, canUse,
} from '../src/lib/plus/subscription';
import { activeChips, applyAdvancedFilters, isOpenAt, parseOpeningDays, removeChip, stripPremium } from '../src/lib/plus/advanced-filters';
import { buildAlerts, DEFAULT_ALERTS, normalizeName, relativeDay } from '../src/lib/plus/alerts';
import { computePulse } from '../src/lib/plus/night-pulse';
import { computeRetrospective, yearsWithActivity } from '../src/lib/plus/retrospective';
import { benefitAvailability, computePlusMetrics } from '../src/lib/plus/metrics';
import { encodeForm, verifyStripeSignature } from '../src/lib/server/stripe';
import { computeOverall } from '../src/lib/rating';
import { computeAllStats, DEFAULT_SETTINGS } from '../src/lib/ranking';
import { buildDemoDatabase } from '../src/data/demo-seed';
import { CRITERIA } from '../src/types';
import type { CriteriaScores, EventItem, PremiumBenefit, ReviewWithMeta, Subscription, Venue, VenueStats } from '../src/types';

const NOW = Date.UTC(2026, 10, 16, 15); // 16/11/2026 (segunda)
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86_400_000;

const sub = (p: Partial<Subscription>): Subscription => ({
  id: 's1', user_id: 'u1', plan_id: 'monthly', status: 'active', provider: 'stripe', provider_customer_id: null,
  provider_subscription_id: null, trial_start: null, trial_end: null, current_period_start: iso(NOW - 10 * DAY),
  current_period_end: iso(NOW + 20 * DAY), cancel_at_period_end: false, canceled_at: null, ended_at: null,
  created_at: iso(NOW - 10 * DAY), updated_at: iso(NOW - 10 * DAY), ...p,
});

const criteria = (v: Partial<CriteriaScores>): CriteriaScores => ({
  music_rating: 8, crowd_rating: 8, atmosphere_rating: 8, drinks_rating: 8, service_rating: 8, organization_rating: 8, experience_rating: 8, ...v,
});

const venue = (id: string, p: Partial<Venue> = {}): Venue => ({
  id, name: id.toUpperCase(), slug: id, description: '', category: 'boate', city: 'Rio de Janeiro', state: 'RJ', neighborhood: '', address: '',
  latitude: -22.9, longitude: -43.2, cover_image: '', gallery: [], instagram_url: null, website_url: null, price_range: 2,
  music_styles: [], opening_days: [], approved: false, is_demo: true, created_at: iso(NOW), ...p,
});

const stats = (venue_id: string, c: Partial<CriteriaScores>, review_count = 10): VenueStats => {
  const cr = criteria(c);
  return { venue_id, review_count, avg_rating: computeOverall(cr), score: computeOverall(cr), criteria: cr, distribution: [0, 0, 0, 0, 0], flagged_ratio: 0, approved: false };
};

// ------------------------------------------------------------------ Meu Ranking
test('Meu Ranking: média ponderada Σ(nota×peso)/Σpesos, ignorando pesos zero', () => {
  const c = criteria({ music_rating: 10, drinks_rating: 4 });
  const w = normalizeWeights({ music_rating: 100, drinks_rating: 50 }); // demais = 0
  // (10×100 + 4×50) / 150 = 8
  assert.equal(personalScore(c, w), 8);
  assert.equal(personalScore(c, normalizeWeights({})), null, 'sem nenhum peso positivo não há nota');
  // pesos fora da faixa são limitados a 0–100
  assert.deepEqual(normalizeWeights({ music_rating: 250, crowd_rating: -5 }).music_rating, 100);
  assert.deepEqual(normalizeWeights({ crowd_rating: -5 }).crowd_rating, 0);
});

test('Meu Ranking: exemplo do briefing gera nota diferente da pública e reordena', () => {
  const w = normalizeWeights({ music_rating: 100, crowd_rating: 70, atmosphere_rating: 60, drinks_rating: 90, service_rating: 40, organization_rating: 30, experience_rating: 100 });
  const venues = [venue('pista'), venue('servico')];
  const st = {
    pista: stats('pista', { music_rating: 10, drinks_rating: 9, service_rating: 5, organization_rating: 5 }),
    servico: stats('servico', { music_rating: 6, drinks_rating: 6, service_rating: 10, organization_rating: 10 }),
  };
  const before = JSON.stringify(st);
  const rows = rankByPreferences(venues, st, w);
  assert.equal(rows[0]!.venue.id, 'pista');
  assert.notEqual(rows[0]!.personal, rows[0]!.public, 'nota personalizada difere da pública');
  assert.equal(rows[0]!.public, st.pista.avg_rating, 'nota pública preservada');
  assert.equal(JSON.stringify(st), before, 'estatísticas públicas não são alteradas');
  const flipped = rankByPreferences(venues, st, normalizeWeights({ service_rating: 100, organization_rating: 100 }));
  assert.equal(flipped[0]!.venue.id, 'servico');
});

test('Meu Ranking: casas sem avaliações suficientes ficam de fora', () => {
  const rows = rankByPreferences([venue('a'), venue('b')], { a: stats('a', {}, 2), b: stats('b', {}, 12) }, PUBLIC_WEIGHTS, { minReviews: 3 });
  assert.deepEqual(rows.map((r) => r.venue.id), ['b']);
});

test('avaliações públicas: pesos dos critérios inalterados e mesmo peso para todos os usuários', () => {
  assert.deepEqual(CRITERIA.map((c) => c.weight), [0.2, 0.15, 0.15, 0.1, 0.1, 0.1, 0.2]);
  // computeAllStats só recebe avaliações e configurações — não existe entrada de plano/assinatura.
  const db = buildDemoDatabase(NOW);
  const v = db.venues[0]!;
  const reviews = db.reviews.filter((r) => r.venue_id === v.id);
  const s = computeAllStats(db.venues, db.reviews, db.settings ?? DEFAULT_SETTINGS).get(v.id)!;
  const simple = Math.round((reviews.reduce((a, r) => a + r.overall_rating, 0) / reviews.length) * 10) / 10;
  assert.equal(s.avg_rating, simple, 'média pública = média simples, sem pesos por usuário');
});

// ------------------------------------------------------------------ assinatura
test('acesso: estados da assinatura', () => {
  assert.equal(resolveAccess([], NOW).tier, 'free');
  assert.equal(resolveAccess([], NOW).label, 'Gratuito');
  const trial = sub({ status: 'trialing', trial_start: iso(NOW - DAY), trial_end: iso(NOW + 6 * DAY), current_period_end: iso(NOW + 6 * DAY) });
  assert.equal(resolveAccess([trial], NOW).label, 'Teste grátis');
  assert.equal(resolveAccess([sub({})], NOW).label, 'Mensal ativa');
  assert.equal(resolveAccess([sub({ plan_id: 'annual' })], NOW).label, 'Anual ativa');
  const canceled = sub({ status: 'canceled', cancel_at_period_end: true });
  assert.equal(resolveAccess([canceled], NOW).tier, 'premium', 'cancelada mantém acesso até o fim do período pago');
  assert.equal(resolveAccess([canceled], NOW).label, 'Cancelada');
  assert.equal(resolveAccess([canceled], NOW + 21 * DAY).tier, 'free', 'após o período → sem acesso');
  assert.equal(resolveAccess([canceled], NOW + 21 * DAY).label, 'Expirada');
  assert.equal(resolveAccess([sub({ status: 'expired', current_period_end: iso(NOW - DAY) })], NOW).label, 'Expirada');
  assert.equal(hasPremiumAccess(sub({ status: 'past_due' }), NOW), false, 'pagamento recusado não libera acesso');
  assert.equal(hasPremiumAccess(sub({ status: 'incomplete' }), NOW), false, 'checkout sem confirmação não libera acesso');
});

test('controle de permissões: toda funcionalidade Classify+ exige premium', () => {
  for (const f of ['meu_ranking', 'filtros_avancados', 'alertas', 'pulso', 'retrospectiva_completa', 'beneficios', 'sem_anuncios'] as const) {
    assert.equal(canUse(f, { tier: 'free' }), false);
    assert.equal(canUse(f, { tier: 'premium' }), true);
  }
});

test('teste grátis: somente uma vez por conta', () => {
  assert.equal(isTrialEligible([]), true);
  assert.equal(isTrialEligible([sub({ status: 'expired', trial_start: iso(NOW - 40 * DAY) })]), false);
  assert.equal(isTrialEligible([sub({ plan_id: 'annual' })]), true, 'assinatura sem teste não consome a elegibilidade');
});

test('status do Stripe → estado interno', () => {
  assert.equal(mapStripeStatus('active', false), 'active');
  assert.equal(mapStripeStatus('active', true), 'canceled');
  assert.equal(mapStripeStatus('trialing', false), 'trialing');
  assert.equal(mapStripeStatus('past_due', false), 'past_due');
  assert.equal(mapStripeStatus('unpaid', false), 'past_due');
  assert.equal(mapStripeStatus('canceled', false), 'expired');
  assert.equal(mapStripeStatus('incomplete_expired', false), 'expired');
});

test('preços: anual ≈ R$ 9,08/mês, economia ≈ 30%, ticket ponderado ≈ R$ 11,75', () => {
  assert.equal(annualMonthlyEquivalentCents(), 908);
  assert.ok(Math.abs(annualSavingsRatio() - 0.296) < 0.001);
  assert.equal(Math.floor(weightedTicketCents()), 1175);
});

test('anúncios de terceiros: nunca para assinantes', () => {
  assert.equal(showThirdPartyAds({ isPremium: true, adsEnabled: true, demoMode: true }), false);
  assert.equal(showThirdPartyAds({ isPremium: false, adsEnabled: true, demoMode: false }), true);
  assert.equal(showThirdPartyAds({ isPremium: false, adsEnabled: false, demoMode: false }), false, 'sem provedor configurado não há banner');
  assert.equal(showThirdPartyAds({ isPremium: false, adsEnabled: false, demoMode: true }), true);
});

// ------------------------------------------------------------------ filtros
test('filtros avançados: combinação e dados não informados', () => {
  const vs = [
    venue('a', { avg_price: 100, capacity: 300, audience_tags: ['Underground'], opens_at: '23:00', closes_at: '06:00', opening_days: ['Sexta', 'Sábado'], music_styles: ['Techno'] }),
    venue('b', { avg_price: 250, capacity: 3000, audience_tags: ['Alto padrão'], opens_at: '22:00', closes_at: '04:00', opening_days: ['Quinta a domingo'] }),
    venue('c', { avg_price: null, capacity: null }),
  ];
  const st = { a: stats('a', { music_rating: 9.5 }), b: stats('b', { music_rating: 7 }), c: stats('c', {}) };
  const ids = (f: Parameters<typeof applyAdvancedFilters>[1]) => applyAdvancedFilters(vs, f, { stats: st }).map((v) => v.id);
  assert.deepEqual(ids({ avgPriceMax: 150 }), ['a'], 'casa sem preço informado não passa');
  assert.deepEqual(ids({ capacity: ['intimista'] }), ['a']);
  assert.deepEqual(ids({ audience: ['Alto padrão'] }), ['b']);
  assert.deepEqual(ids({ openAt: '02:00' }), ['a', 'b']);
  assert.deepEqual(ids({ openAt: '05:00' }), ['a']);
  assert.deepEqual(ids({ weekdays: ['Domingo'] }), ['b']);
  assert.deepEqual(ids({ criteriaMin: { music_rating: 9 } }), ['a']);
  assert.deepEqual(ids({ avgPriceMax: 300, weekdays: ['Sábado'], criteriaMin: { music_rating: 9 } }), ['a'], 'filtros combinados (E)');
  assert.deepEqual(ids({}), ['a', 'b', 'c']);
});

test('filtros: dias de funcionamento, horário e chips removíveis', () => {
  assert.deepEqual([...parseOpeningDays(['Quinta a domingo'])!].sort(), [3, 4, 5, 6]);
  assert.deepEqual([...parseOpeningDays(['Sexta e sábado'])!].sort(), [4, 5]);
  assert.equal(parseOpeningDays(['Edições trimestrais']), null);
  assert.equal(isOpenAt({ opens_at: '23:00', closes_at: '06:00' }, '01:30'), true);
  assert.equal(isOpenAt({ opens_at: '23:00', closes_at: '06:00' }, '12:00'), false);
  assert.equal(isOpenAt({ opens_at: null, closes_at: null }, '01:00'), null);
  const f = { styles: ['Techno', 'House'], audience: ['Underground'], minRating: 8 };
  const chips = activeChips(f);
  assert.equal(chips.filter((c) => c.premium).length, 1);
  const next = removeChip(f, chips.find((c) => c.value === 'Techno')!);
  assert.deepEqual(next.styles, ['House']);
  assert.deepEqual(stripPremium(f), { city: undefined, styles: ['Techno', 'House'], priceRanges: undefined, minRating: 8 });
});

// ------------------------------------------------------------------ alertas
test('alertas: DJ favorito, casa favorita, lembrete e deduplicação', () => {
  const v = venue('club', { name: 'Club' });
  const ev = (id: string, days: number, djs: string[]): EventItem & { venue: Venue } => ({
    id, venue_id: v.id, name: `Festa ${id}`, slug: id, description: '', cover_image: '', event_date: new Date(NOW + days * DAY).toISOString().slice(0, 10),
    start_time: '23:00', ticket_price: null, ticket_url: null, dj_names: djs, music_styles: [], is_demo: true, created_at: iso(NOW), venue: v,
  });
  const events = [ev('e1', 5, ['Ana Lúcia']), ev('e2', 2, []), ev('old', -3, ['Ana Lúcia'])];
  const input = {
    events,
    favorites: [{ id: 'f1', user_id: 'u1', venue_id: v.id, event_id: null, created_at: iso(NOW) }, { id: 'f2', user_id: 'u1', venue_id: null, event_id: 'e2', created_at: iso(NOW) }],
    artists: [{ id: 'a1', user_id: 'u1', kind: 'dj' as const, name: 'Ana Lucia', name_key: normalizeName('ANA  LUCIA'), created_at: iso(NOW) }],
    settings: DEFAULT_ALERTS,
    existingKeys: new Set<string>(),
    now: NOW,
  };
  const drafts = buildAlerts(input);
  const keys = drafts.map((d) => d.dedupe_key).sort();
  assert.deepEqual(keys, ['dj:e1:ana lucia', 'event:e2:reminder', 'venue:e1', 'venue:e2'].sort());
  assert.ok(drafts.find((d) => d.kind === 'artist_event')!.title.startsWith('Seu DJ favorito vai tocar'));
  assert.equal(buildAlerts({ ...input, existingKeys: new Set(keys) }).length, 0, 'idempotente');
  assert.equal(buildAlerts({ ...input, settings: { ...DEFAULT_ALERTS, enabled: false } }).length, 0, 'alertas desativados');
  assert.equal(relativeDay('2026-11-21', NOW), 'neste sábado');
  assert.equal(relativeDay('2026-11-17', NOW), 'amanhã');
});

// ------------------------------------------------------------------ pulso
const reviewItem = (id: string, venueId: string, hoursAgo: number, overall: number, extra: Partial<CriteriaScores> = {}): ReviewWithMeta => ({
  review: { id, user_id: 'x', venue_id: venueId, ...criteria(extra), overall_rating: overall, comment: 'ok ok ok ok', experience_date: null, photos: [], status: 'published', is_demo: true, created_at: iso(NOW - hoursAgo * 3_600_000), updated_at: iso(NOW) },
  author: { id: 'x', username: 'x', full_name: 'X', avatar_url: null, city: null, bio: null, role: 'user', is_demo: true, created_at: iso(NOW) },
  venue: venue(venueId), likes: 0, likedByMe: false,
});

test('Pulso da Noite: sem dados recentes → vazio (nada é inventado)', () => {
  const p = computePulse([reviewItem('r', 'a', 50, 9)], {}, 6, NOW);
  assert.equal(p.total, 0);
  assert.deepEqual(p.topRated, []);
  assert.deepEqual(p.feed, []);
});

test('Pulso da Noite: ranking da janela, crescimento e destaque', () => {
  const list = [reviewItem('1', 'a', 1, 9.5, { music_rating: 10 }), reviewItem('2', 'a', 2, 9), reviewItem('3', 'b', 3, 7, { drinks_rating: 10 }), reviewItem('4', 'b', 30, 7)];
  const p = computePulse(list, { a: stats('a', {}), b: stats('b', {}) }, 24, NOW);
  assert.equal(p.total, 3);
  assert.equal(p.topRated[0]!.venue.id, 'a');
  assert.equal(p.bestValue[0]!.venue.id, 'b');
  assert.deepEqual(p.growth.map((g) => g.venue.id), ['a'], 'b teve 1 avaliação em cada janela: sem crescimento');
  assert.equal(p.feed[0]!.item.review.id, '1');
});

// ------------------------------------------------------------------ retrospectiva
test('retrospectiva: somente dados reais do ano escolhido', () => {
  const r1 = reviewItem('1', 'a', 24, 9);
  r1.venue.music_styles = ['Techno'];
  r1.review.photos = ['p1', 'p2'];
  const r2 = reviewItem('2', 'b', 48, 7);
  r2.venue.music_styles = ['Techno', 'House'];
  const old = reviewItem('3', 'c', 24 * 400, 10);
  const all = [r1, r2, old];
  assert.deepEqual(yearsWithActivity(all), [2026, 2025]);
  const r = computeRetrospective(all, 2026);
  assert.equal(r.reviews, 2);
  assert.equal(r.venues, 2);
  assert.equal(r.photos, 2);
  assert.equal(r.topVenue!.venue.id, 'a');
  assert.equal(r.favoriteStyle!.style, 'Techno');
  assert.equal(r.avgGiven, 8);
  const empty = computeRetrospective(all, 2020);
  assert.equal(empty.reviews, 0);
  assert.equal(empty.topVenue, null);
  assert.equal(empty.avgGiven, null);
});

// ------------------------------------------------------------------ admin / benefícios
test('métricas: estimado separado do recebido', () => {
  const m = computePlusMetrics({
    totalUsers: 10,
    subscriptions: [
      sub({ id: '1', user_id: 'u1' }),
      sub({ id: '2', user_id: 'u2', plan_id: 'annual' }),
      sub({ id: '3', user_id: 'u3', status: 'trialing', trial_start: iso(NOW), trial_end: iso(NOW + 5 * DAY) }),
      sub({ id: '4', user_id: 'u4', status: 'canceled', cancel_at_period_end: true }),
      sub({ id: '5', user_id: 'u5', status: 'expired', current_period_end: iso(NOW - DAY) }),
    ],
    payments: [{ id: 'p', subscription_id: '1', user_id: 'u1', provider_invoice_id: 'in_1', amount_cents: 1290, currency: 'BRL', status: 'paid', failure_reason: null, paid_at: iso(NOW - DAY), created_at: iso(NOW - DAY) }],
    benefits: [],
    redemptions: [],
    now: NOW,
  });
  assert.equal(m.subscribers, 4);
  assert.equal(m.monthly_active, 1);
  assert.equal(m.annual_active, 1);
  assert.equal(m.trialing, 1);
  assert.equal(m.canceled_with_access, 1);
  assert.equal(m.expired, 1);
  assert.equal(m.mrr_estimated_cents, Math.round(1290 + 10900 / 12), 'MRR: só assinaturas que renovam');
  assert.equal(m.annual_contracted_cents, 10900);
  assert.equal(m.received_total_cents, 1290, 'recebido = faturas pagas');
  assert.equal(m.conversion_rate, 0.3, '3 pagantes (sem teste) ÷ 10 usuários');
});

test('benefícios: disponibilidade', () => {
  const b: PremiumBenefit = { id: 'b', venue_id: 'v', title: 't', description: 'd', rules: 'r', how_to_redeem: 'h', image_url: '', valid_until: '2026-12-01', total_quantity: 2, active: true, is_demo: false, created_at: iso(NOW) };
  assert.equal(benefitAvailability(b, 0, NOW), 'disponivel');
  assert.equal(benefitAvailability(b, 2, NOW), 'esgotado');
  assert.equal(benefitAvailability({ ...b, valid_until: '2026-11-01' }, 0, NOW), 'expirado');
  assert.equal(benefitAvailability({ ...b, active: false }, 0, NOW), 'inativo');
});

// ------------------------------------------------------------------ webhooks
test('webhook Stripe: assinatura HMAC válida, adulterada e expirada', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
  const t = Math.floor(NOW / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, t), true);
  assert.equal(verifyStripeSignature(body.replace('paid', 'free'), `t=${t},v1=${sig}`, secret, 300, t), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'outro', 300, t), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, t + 3600), false, 'replay fora da tolerância');
  assert.equal(verifyStripeSignature(body, null, secret), false);
});

test('Stripe: codificação de parâmetros aninhados', () => {
  const s = decodeURIComponent(encodeForm({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], subscription_data: { trial_period_days: 7 }, x: null }).join('&'));
  assert.equal(s, 'mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&subscription_data[trial_period_days]=7');
});

// ------------------------------------------------------------------ dados demo
test('dados demo: indicados e detalhes só onde definidos', () => {
  const db = buildDemoDatabase(NOW);
  assert.ok(db.venues.filter((v) => v.is_indicated).length >= 1);
  assert.ok(db.venues.some((v) => v.capacity === null), 'existe casa sem capacidade informada');
  assert.ok(db.venues.every((v) => Array.isArray(v.audience_tags)));
});
