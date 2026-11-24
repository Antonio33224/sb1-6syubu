/**
 * E-mail com os ingressos (QR Code embutido). Enviado SOMENTE depois que o
 * pagamento foi aprovado e os ingressos foram emitidos pelo banco.
 *
 * Idempotência: os ingressos são "reservados" para envio com um UPDATE
 * condicional (emailed_at IS NULL). Se o webhook e a rota de pagamento
 * chegarem juntos, só um deles envia. Em caso de falha, a marca é desfeita.
 */
import QRCode from 'qrcode';
import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml, type Mailer } from '../mailer';
import { log } from '../log-sanitize';
import { HIDDEN_TEXT } from '@/lib/public-events';
import { TICKET_TYPE_LABEL, type TicketType } from '@/types/tickets';

interface TicketRow {
  id: string;
  code: string;
  holder_name: string;
  batch: { name: string; ticket_type: TicketType } | null;
}

export async function sendTicketEmails(svc: SupabaseClient, mailer: Mailer | null, orderId: string, siteUrl: string): Promise<'sent' | 'nothing' | 'no_mailer' | 'failed'> {
  if (!mailer) {
    log.warn('[tickets] SMTP não configurado: ingressos disponíveis só em Meus ingressos', orderId);
    return 'no_mailer';
  }
  const { data: claimed, error } = await svc
    .from('tickets')
    .update({ emailed_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .is('emailed_at', null)
    .select('id, code, holder_name, batch:ticket_batches(name, ticket_type)');
  if (error) {
    log.error('[tickets] claim email', error.message);
    return 'failed';
  }
  const tickets = (claimed ?? []) as unknown as TicketRow[];
  if (!tickets.length) return 'nothing';

  try {
    const { data: order } = await svc.from('orders').select('id, buyer_email, buyer_name, event_id, total').eq('id', orderId).single();
    // Dados da festa pela VIEW pública: campos ocultos continuam ocultos no e-mail.
    const { data: ev } = await svc
      .from('public_events')
      .select('name, name_hidden, event_date, start_time, location_name, address, city, state, location_hidden, slug')
      .eq('id', order!.event_id)
      .maybeSingle();
    const eventName = ev?.name_hidden || !ev?.name ? HIDDEN_TEXT.name : String(ev.name);
    const where = ev?.location_hidden
      ? `${HIDDEN_TEXT.location} · ${ev.city ?? ''}`
      : [ev?.location_name, ev?.address, [ev?.city, ev?.state].filter(Boolean).join(' — ')].filter(Boolean).join(' · ');
    const date = ev ? new Date(`${ev.event_date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '';

    const attachments = await Promise.all(
      tickets.map(async (t, i) => ({
        filename: `ingresso-${i + 1}.png`,
        content: await QRCode.toBuffer(t.code, { errorCorrectionLevel: 'M', margin: 2, width: 360 }),
        contentType: 'image/png',
        cid: `qr-${t.id}@nooff`,
      })),
    );

    const rows = tickets
      .map(
        (t, i) => `<tr><td style="padding:16px;border-top:1px solid #292929">
<img src="cid:qr-${t.id}@nooff" width="180" height="180" alt="QR Code do ingresso ${i + 1}" style="display:block;background:#fff;padding:6px;border-radius:6px"/>
</td><td style="padding:16px;border-top:1px solid #292929;vertical-align:top;color:#f5f5f5">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ff3b30">${escapeHtml(t.batch ? `${TICKET_TYPE_LABEL[t.batch.ticket_type]} · ${t.batch.name}` : 'Ingresso')}</div>
<div style="font-size:16px;font-weight:bold;margin-top:6px">${escapeHtml(t.holder_name)}</div>
<div style="font-family:monospace;font-size:13px;color:#a0a0a0;margin-top:6px">${escapeHtml(t.code)}</div>
</td></tr>`,
      )
      .join('');

    const link = `${siteUrl}/meus-ingressos`;
    const html = `<div style="background:#050505;padding:32px;font-family:Arial,sans-serif;color:#f5f5f5">
<div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">NO <span style="color:#ff3b30">OFF</span></div>
<p style="color:#a0a0a0;font-size:12px;margin:4px 0 24px">Uma nova forma de adquirir experiências noturnas</p>
<h1 style="font-size:22px;margin:0 0 8px">Seus ingressos estão confirmados</h1>
<p style="margin:0;font-size:15px"><strong>${escapeHtml(eventName)}</strong></p>
<p style="margin:4px 0 0;color:#a0a0a0;font-size:13px">${escapeHtml(date)} · ${escapeHtml(ev?.start_time ?? '')}</p>
<p style="margin:4px 0 20px;color:#a0a0a0;font-size:13px">${escapeHtml(where)}</p>
<table style="border-collapse:collapse;width:100%;max-width:560px;background:#111;border:1px solid #292929;border-radius:6px">${rows}</table>
<p style="font-size:13px;color:#a0a0a0;margin-top:20px">Apresente o QR Code na portaria (impresso ou na tela). Cada QR vale para uma entrada e é bloqueado após o uso.</p>
<p style="font-size:13px"><a href="${escapeHtml(link)}" style="color:#ff3b30">Ver em Meus ingressos</a></p>
<p style="font-size:11px;color:#666;margin-top:24px">Pedido ${escapeHtml(order!.id)}. Não compartilhe estes códigos.</p>
</div>`;
    const text = [
      `Seus ingressos para ${eventName} estão confirmados.`,
      `${date} · ${ev?.start_time ?? ''}`,
      where,
      '',
      ...tickets.map((t, i) => `Ingresso ${i + 1}: ${t.holder_name} — código ${t.code}`),
      '',
      `Também disponíveis em ${link}`,
    ].join('\n');

    await mailer.send({ to: order!.buyer_email, subject: `Seus ingressos — ${eventName}`, text, html, attachments });
    return 'sent';
  } catch (err) {
    log.error('[tickets] envio de e-mail', err);
    // Desfaz a marca para permitir novo envio (webhook reenviado ou reconciliação).
    await svc.from('tickets').update({ emailed_at: null }).in('id', tickets.map((t) => t.id));
    return 'failed';
  }
}
