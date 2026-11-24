/**
 * Envio de e-mails transacionais por SMTP (nodemailer). SOMENTE NO SERVIDOR.
 *
 * Variáveis: SMTP_HOST, SMTP_PORT (padrão 587), SMTP_SECURE ("true" para 465),
 * SMTP_USER, SMTP_PASS, EMAIL_FROM (ex.: "NO OFF <alertas@seudominio.com>").
 * Sem SMTP_HOST/EMAIL_FROM o envio fica desativado (o alerta continua no audit log).
 */
import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Para imagens embutidas no HTML: <img src="cid:..."> */
  cid?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export function smtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user: env.SMTP_USER?.trim() || undefined,
    pass: env.SMTP_PASS || undefined,
    from,
  };
}

export function createSmtpMailer(cfg: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return {
    async send(msg) {
      await transport.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, attachments: msg.attachments });
    },
  };
}

/** Mailer configurado pelo ambiente, ou null quando o SMTP não está definido. */
export function defaultMailer(): Mailer | null {
  const cfg = smtpConfig();
  return cfg ? createSmtpMailer(cfg) : null;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface LoginAlertInput {
  email: string;
  emailFailures: number;
  ipFailures: number;
  windowMinutes: number;
  threshold: number;
  at: Date;
  siteUrl: string;
}

/** Conteúdo do alerta de tentativas de login falhas (texto + HTML escapado). */
export function loginAlertEmail(i: LoginAlertInput): Omit<MailMessage, 'to'> {
  const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(i.at);
  // O e-mail tentado é dado do usuário: só vai no corpo (nunca no assunto/cabeçalhos) e é escapado no HTML.
  const account = i.email.slice(0, 254);
  const lines = [
    'Alerta de segurança — NO OFF',
    '',
    `Detectamos muitas tentativas de login falhas (limite: ${i.threshold} em ${i.windowMinutes} min).`,
    '',
    `Conta tentada: ${account}`,
    `Falhas para esta conta na janela: ${i.emailFailures}`,
    `Falhas vindas do mesmo IP na janela: ${i.ipFailures}`,
    `Horário: ${when} (Brasília)`,
    '',
    'Pode ser alguém tentando adivinhar a senha. Se persistir, considere ativar CAPTCHA no Supabase Auth e revisar o Audit Log no painel.',
    `Painel: ${i.siteUrl}/admin`,
    '',
    'Novos alertas são agrupados pelo intervalo mínimo configurado no painel.',
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<h2 style="margin:0 0 12px">Alerta de segurança — NO OFF</h2>
<p>Detectamos muitas tentativas de login falhas (limite: ${i.threshold} em ${i.windowMinutes} min).</p>
<table style="border-collapse:collapse">
<tr><td style="padding:4px 12px 4px 0;color:#555">Conta tentada</td><td><strong>${escapeHtml(account)}</strong></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Falhas desta conta</td><td>${i.emailFailures}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Falhas do mesmo IP</td><td>${i.ipFailures}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#555">Horário</td><td>${escapeHtml(when)} (Brasília)</td></tr>
</table>
<p>Se persistir, considere ativar CAPTCHA no Supabase Auth e revise o Audit Log no <a href="${escapeHtml(i.siteUrl)}/admin">painel</a>.</p>
</div>`;
  return { subject: '[NO OFF] Alerta: muitas tentativas de login falhas', text: lines.join('\n'), html };
}
