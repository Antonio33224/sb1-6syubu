/**
 * Alertas de tentativas de login falhas: e-mail ao admin padrão quando o banco
 * indica que o limite foi atingido; IP só como hash; nada vaza na resposta.
 * Também cobre a remoção de dados pessoais dos logs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginFailedHandler, hashIp, type FailureResult, type LoginAlertDeps } from '../src/lib/server/security/login-alerts';
import { loginAlertEmail, type MailMessage } from '../src/lib/server/mailer';
import { maskEmail, redact } from '../src/lib/server/log-sanitize';

const ENV = { url: 'https://x.supabase.co', anonKey: 'anon', serviceRoleKey: 'service', siteUrl: 'https://classifydj.com' };

function setup(result: Partial<FailureResult> | null | 'throw', opts: { mailer?: boolean; mailFails?: boolean } = {}) {
  const sent: MailMessage[] = [];
  const recorded: { email: string; ipHash: string }[] = [];
  const deps: LoginAlertDeps = {
    env: () => ENV,
    record: async (_env, email, ipHash) => {
      recorded.push({ email, ipHash });
      if (result === 'throw') throw new Error('db fora');
      return result === null ? null : { recorded: true, too_many: false, should_alert: false, ...result };
    },
    mailer: () =>
      opts.mailer === false
        ? null
        : {
            send: async (m) => {
              if (opts.mailFails) throw new Error('SMTP 535 auth failed for user admin@x.com');
              sent.push(m);
            },
          },
    hashSecret: () => 'segredo',
    now: () => new Date('2026-11-17T12:00:00Z'),
  };
  return { handler: createLoginFailedHandler(deps), sent, recorded };
}

const req = (body: unknown, ip = '203.0.113.9') =>
  new Request('http://localhost/api/auth/login-failed', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) });

test('abaixo do limite: registra (com IP em hash) e não envia e-mail', async () => {
  const { handler, sent, recorded } = setup({ email_failures: 2, should_alert: false });
  const res = await handler(req({ email: 'Vitima@Exemplo.com ' }));
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true, tracked: true, too_many: false });
  assert.equal(recorded[0].email, 'vitima@exemplo.com');
  assert.equal(recorded[0].ipHash, hashIp('203.0.113.9', 'segredo'));
  assert.ok(!recorded[0].ipHash.includes('203.0.113.9'), 'IP nunca em claro');
  assert.equal(sent.length, 0);
});

test('limite atingido: envia e-mail ao admin padrão configurado no painel', async () => {
  const { handler, sent } = setup({ email_failures: 5, ip_failures: 7, threshold: 5, window_minutes: 15, should_alert: true, alert_email: 'admin@classifydj.com', too_many: true });
  const res = await handler(req({ email: 'vitima@exemplo.com' }));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.too_many, true);
  assert.equal(body.retry_after_minutes, 15);
  assert.ok(!JSON.stringify(body).includes('admin@classifydj.com'), 'a resposta não revela o e-mail do admin');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'admin@classifydj.com');
  assert.ok(!sent[0].subject.includes('vitima'), 'dado do usuário não vai no assunto');
  assert.match(sent[0].text, /vitima@exemplo\.com/);
  assert.match(sent[0].text, /Falhas para esta conta na janela: 5/);
});

test('cooldown: banco diz should_alert=false → nenhum e-mail, mesmo acima do limite', async () => {
  const { handler, sent } = setup({ email_failures: 30, should_alert: false, too_many: true });
  await handler(req({ email: 'vitima@exemplo.com' }));
  assert.equal(sent.length, 0);
});

test('SMTP fora do ar ou ausente não quebra o fluxo de login', async () => {
  const failing = setup({ should_alert: true, alert_email: 'admin@classifydj.com' }, { mailFails: true });
  assert.equal((await failing.handler(req({ email: 'a@b.com' }))).status, 202);
  const none = setup({ should_alert: true, alert_email: 'admin@classifydj.com' }, { mailer: false });
  assert.equal((await none.handler(req({ email: 'a@b.com' }))).status, 202);
});

test('entrada inválida, banco fora e sem service_role: resposta genérica', async () => {
  const bad = setup({});
  for (const body of [{ email: 'nao-e-email' }, { email: 'x'.repeat(300) + '@a.com' }, {}, { email: { $gt: '' } }]) {
    const res = await bad.handler(req(body));
    assert.equal(res.status, 202);
    assert.equal((await res.json()).tracked, false);
  }
  assert.equal(bad.recorded.length, 0, 'entrada inválida nem chega ao banco');
  assert.equal((await (await setup('throw').handler(req({ email: 'a@b.com' }))).json()).tracked, false);
  assert.equal((await (await setup(null).handler(req({ email: 'a@b.com' }))).json()).tracked, false);
});

test('conteúdo do alerta escapa HTML', () => {
  const m = loginAlertEmail({ email: '<img src=x onerror=alert(1)>@x.com', emailFailures: 5, ipFailures: 5, windowMinutes: 15, threshold: 5, at: new Date(), siteUrl: 'https://classifydj.com' });
  assert.ok(!m.html!.includes('<img'), 'HTML injetado foi escapado');
  assert.match(m.html!, /&lt;img/);
});

test('logs: e-mails, tokens e chaves são mascarados; UUIDs preservados', () => {
  assert.equal(maskEmail('joao.silva@gmail.com'), 'jo***@g***.com');
  const out = redact(
    'user joao.silva@gmail.com Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk key sk-proj-abcdefghijklmnop whsec_abcdefghijkl cpf 123.456.789-09 tel (11) 98765-4321 sessão 11111111-1111-4111-8111-111111111111',
  );
  assert.ok(!out.includes('joao.silva@gmail.com'));
  assert.ok(!out.includes('eyJhbGci'));
  assert.ok(!out.includes('sk-proj-abcdefghijklmnop'));
  assert.ok(!out.includes('whsec_abcdefghijkl'));
  assert.ok(!out.includes('123.456.789-09'));
  assert.ok(!out.includes('98765-4321'));
  assert.ok(out.includes('11111111-1111-4111-8111-111111111111'), 'UUID mantido para depuração');
});
