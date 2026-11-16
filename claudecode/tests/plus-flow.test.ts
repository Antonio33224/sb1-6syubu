/**
 * Fluxo completo Classify+ no modo demonstração, com localStorage em memória:
 * usuário gratuito → bloqueios → assinatura (teste grátis) → recursos liberados
 * → cancelamento (mantém acesso) → expiração (bloqueia de novo) → sem 2º teste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage mínimo para o ambiente Node
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

test('fluxo Classify+ (demo): bloqueio, assinatura, cancelamento e expiração', async () => {
  const { DemoService } = await import('../src/services/demo-service');
  const { DemoPlusService } = await import('../src/services/plus/demo-plus-service');
  const { resolveAccess } = await import('../src/lib/plus/subscription');

  const data = new DemoService();
  const plus = new DemoPlusService(data);

  // Cadastro gratuito
  await data.signUp({ email: 'nova@teste.dev', password: 'senha-segura-1', username: 'nova.conta', full_name: 'Nova Conta' });
  const me = (await data.getCurrentUser())!;
  assert.ok(me);
  assert.equal(resolveAccess(await plus.listMySubscriptions()).tier, 'free');

  // Avaliar continua gratuito
  const venue = (await data.listVenues())[0]!;
  await data.upsertReview({
    venue_id: venue.id, music_rating: 9, crowd_rating: 8, atmosphere_rating: 8, drinks_rating: 7, service_rating: 8,
    organization_rating: 7, experience_rating: 9, comment: 'Noite excelente do começo ao fim.', experience_date: null, photos: [],
  });

  // Bloqueios para gratuito
  const benefits = await plus.listBenefits();
  assert.ok(benefits.length > 0);
  assert.ok(benefits.every((b) => b.benefit.is_demo), 'benefícios demo são marcados como exemplo');
  await assert.rejects(plus.redeemBenefit(benefits[0]!.benefit.id), /exclusivo/i);
  assert.equal(await plus.syncNotifications(), 0, 'gratuito não recebe alertas');

  // Segue DJ que toca em evento futuro + favorita a casa do evento
  const events = await data.listEvents({ upcomingOnly: true });
  const withDj = events.find((e) => e.dj_names.some((d) => !/anunciar/i.test(d)))!;
  await plus.toggleArtistFavorite(withDj.dj_names.find((d) => !/anunciar/i.test(d))!, 'dj');

  // Assinatura (demo, sem cobrança): mensal com teste grátis
  const res = await plus.startCheckout('monthly');
  assert.equal(res.kind, 'demo_activated');
  let access = resolveAccess(await plus.listMySubscriptions());
  assert.equal(access.tier, 'premium');
  assert.equal(access.label, 'Teste grátis');
  assert.equal(access.trialEligible, false);
  assert.deepEqual(await plus.listMyPayments(), [], 'demo não registra pagamentos');
  await assert.rejects(plus.startCheckout('annual'), /já tem/i, 'não assina duas vezes');

  // Desbloqueios
  const created = await plus.syncNotifications();
  assert.ok(created >= 1, 'alerta gerado para o DJ seguido');
  assert.equal(await plus.syncNotifications(), 0, 'alertas não duplicam');
  const n = await plus.listNotifications();
  assert.ok(n.some((x) => x.kind === 'artist_event' && x.title.includes('vai tocar')));
  assert.ok(n.every((x) => x.email_status === 'not_requested'), 'nenhum envio externo simulado');
  const redemption = await plus.redeemBenefit(benefits[0]!.benefit.id);
  assert.match(redemption.code, /^DEMO-/, 'código demonstrativo identificado');
  assert.equal((await plus.redeemBenefit(benefits[0]!.benefit.id)).code, redemption.code, 'um resgate por assinante');

  // Preferências do Meu Ranking
  const prefs = await plus.savePreferences({
    ranking_presets: [{ id: 'p1', name: 'Pista', weights: { music_rating: 100, crowd_rating: 70, atmosphere_rating: 60, drinks_rating: 90, service_rating: 40, organization_rating: 30, experience_rating: 100 }, updated_at: new Date().toISOString() }],
    active_preset_id: 'p1',
  });
  assert.equal(prefs.ranking_presets[0]!.weights.music_rating, 100);

  // Cancelamento: mantém acesso até o fim do período
  await plus.cancelSubscription();
  access = resolveAccess(await plus.listMySubscriptions());
  assert.equal(access.label, 'Cancelada');
  assert.equal(access.tier, 'premium');
  await plus.resumeSubscription();
  assert.equal(resolveAccess(await plus.listMySubscriptions()).label, 'Teste grátis');

  // Expiração: bloqueia novamente
  await plus.demoExpireNow();
  access = resolveAccess(await plus.listMySubscriptions());
  assert.equal(access.tier, 'free');
  assert.equal(access.label, 'Expirada');
  await assert.rejects(plus.redeemBenefit(benefits[1]!.benefit.id), /exclusivo/i);

  // Nova assinatura mensal não ganha um 2º teste grátis
  await plus.startCheckout('monthly');
  access = resolveAccess(await plus.listMySubscriptions());
  assert.equal(access.label, 'Mensal ativa');

  // Histórico pessoal com dados reais
  const activity = await plus.listActivity();
  assert.ok(activity.some((a) => a.kind === 'review_published'));
  assert.ok(activity.some((a) => a.kind === 'benefit_redeemed'));

  // Admin: métricas sem pagamentos recebidos no demo
  await data.signOut();
  await data.signIn('admin@classifydj.demo', 'classify123');
  const m = await plus.admin.metrics();
  assert.equal(m.subscribers, 1);
  assert.equal(m.monthly_active, 1);
  assert.equal(m.received_total_cents, 0);
  assert.equal(m.top_benefits[0]?.redemptions, 1);
});
