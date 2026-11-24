/**
 * Relatório final da festa — CSV, Excel (XLSX) e PDF. SOMENTE NO SERVIDOR.
 * Os dados vêm de public.producer_event_report(), que confere se o usuário é
 * o produtor dono da festa (ou super admin) antes de devolver qualquer linha.
 */
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatCpf } from '@/lib/cpf';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, TICKET_TYPE_LABEL, type EventReport } from '@/types/tickets';

export type ReportSection = 'compradores' | 'vip' | 'faturamento' | 'completo';

type Cell = string | number | null;
interface Table {
  title: string;
  header: string[];
  rows: Cell[][];
  /** Índices das colunas em R$ (formatadas como moeda no PDF/XLSX). */
  money?: number[];
}

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');
const money = (n: number) => Math.round(Number(n) * 100) / 100;
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const method = (m: string | null) => (m ? PAYMENT_METHOD_LABEL[m] ?? m : '');
const VIP_STATUS: Record<string, string> = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Recusado' };

export function buildTables(r: EventReport, section: ReportSection): Table[] {
  const out: Table[] = [];
  if (section === 'compradores' || section === 'completo') {
    out.push({
      title: 'Compradores',
      header: ['Nome', 'CPF', 'E-mail', 'Celular', 'Lote', 'Tipo', 'Qtd.', 'Valor unit.', 'Valor', 'Data da compra', 'Pagamento confirmado', 'Status do pagamento', 'Forma de pagamento', 'Parcelas', 'Check-in'],
      rows: r.buyers.map((b) => [
        b.buyer_name, formatCpf(b.buyer_cpf), b.buyer_email, b.buyer_phone, b.batch, TICKET_TYPE_LABEL[b.ticket_type] ?? b.ticket_type,
        b.quantity, money(b.unit_price), money(b.amount), dt(b.created_at), dt(b.paid_at), ORDER_STATUS_LABEL[b.status] ?? b.status,
        method(b.payment_method), b.installments ?? '', b.tickets ? `${b.checked_in}/${b.tickets}` : '—',
      ]),
      money: [7, 8],
    });
  }
  if (section === 'vip' || section === 'completo') {
    out.push({
      title: 'Lista VIP',
      header: ['Nome', 'CPF', 'E-mail', 'Celular', 'Observação', 'Status', 'Origem', 'Presença', 'Inscrito em'],
      rows: r.vip.map((v) => [
        v.name, v.cpf ? formatCpf(v.cpf) : '', v.email ?? '', v.phone ?? '', v.note, VIP_STATUS[v.status] ?? v.status,
        v.source === 'link' ? 'Link de inscrição' : v.source === 'csv' ? 'Importação CSV' : 'Manual',
        v.checked_in_at ? `Presente (${dt(v.checked_in_at)})` : 'Ausente', dt(v.created_at),
      ]),
    });
  }
  if (section === 'faturamento' || section === 'completo') {
    const rv = r.revenue;
    out.push({
      title: 'Faturamento',
      header: ['Indicador', 'Valor'],
      rows: [
        ['Faturamento bruto', money(rv.gross)],
        ['Taxas (Mercado Pago)', money(rv.fees)],
        ['Faturamento líquido', money(rv.net)],
        ['Estornos / chargebacks', money(rv.refunded)],
        ['Ingressos com check-in', `${r.checkins.tickets_used}/${r.checkins.tickets_total}`],
        ['Lista VIP presente', `${r.checkins.vip_present}/${r.checkins.vip_total}`],
      ],
      money: [1],
    });
    out.push({
      title: 'Vendas por lote',
      header: ['Lote', 'Tipo', 'Preço', 'Quantidade', 'Vendidos', 'Faturamento'],
      rows: rv.by_batch.map((b) => [b.batch, TICKET_TYPE_LABEL[b.ticket_type] ?? b.ticket_type, money(b.price), b.quantity, Number(b.sold), money(b.gross)]),
      money: [2, 5],
    });
    out.push({
      title: 'Vendas por forma de pagamento',
      header: ['Forma de pagamento', 'Pedidos', 'Ingressos', 'Faturamento'],
      rows: rv.by_method.map((m) => [method(m.method) || m.method, Number(m.orders), Number(m.tickets), money(m.gross)]),
      money: [3],
    });
  }
  return out;
}

// ------------------------------------------------------------------ CSV

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  // Evita injeção de fórmula ao abrir no Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV com BOM e separador ";" (abre corretamente no Excel em pt-BR). */
export function toCsv(tables: Table[]): string {
  const parts = tables.map((t) => [tables.length > 1 ? csvCell(`# ${t.title}`) : null, t.header.map(csvCell).join(';'), ...t.rows.map((r) => r.map(csvCell).join(';'))].filter((x) => x !== null).join('\r\n'));
  return `﻿${parts.join('\r\n\r\n')}\r\n`;
}

// ------------------------------------------------------------------ XLSX

export async function toXlsx(tables: Table[], eventName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NO OFF';
  wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.addRow([`${eventName} — ${t.title}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const head = ws.addRow(t.header);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE10600' } };
    });
    for (const r of t.rows) {
      const row = ws.addRow(r.map((v) => (v === null ? '' : v)));
      for (const i of t.money ?? []) if (typeof r[i] === 'number') row.getCell(i + 1).numFmt = '"R$" #,##0.00';
    }
    ws.columns.forEach((col, i) => {
      const max = Math.max(t.header[i]?.length ?? 10, ...t.rows.map((r) => String(r[i] ?? '').length));
      col.width = Math.min(48, Math.max(10, max + 2));
    });
    ws.views = [{ state: 'frozen', ySplit: 3 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ PDF

/** Fontes padrão do PDF usam WinAnsi: troca o que não é representável. */
const winAnsi = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

export async function toPdf(tables: Table[], r: EventReport): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório — ${winAnsi(r.event.name)}`);
  pdf.setCreator('NO OFF');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 842; // A4 paisagem
  const H = 595;
  const M = 32;
  const red = rgb(0.882, 0.024, 0);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, size: number, f: PDFFont = font, color = rgb(0.07, 0.07, 0.07)) => page.drawText(winAnsi(s), { x, y, size, font: f, color });
  const fit = (s: string, width: number, size: number, f: PDFFont) => {
    let t = winAnsi(s);
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > width) t = `${t.slice(0, -2)}.`;
    return t;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };

  text('NO', M, 18, bold);
  page.drawText('OFF', { x: M + bold.widthOfTextAtSize('NO ', 18), y, size: 18, font: bold, color: red });
  y -= 22;
  text(`Relatório final — ${r.event.name}`, M, 13, bold);
  y -= 15;
  text(`${new Date(`${r.event.event_date}T12:00:00`).toLocaleDateString('pt-BR')} · ${r.event.start_time}${r.event.capacity ? ` · capacidade ${r.event.capacity}` : ''} · gerado em ${dt(new Date().toISOString())}`, M, 9, font, rgb(0.4, 0.4, 0.4));
  y -= 22;

  for (const t of tables) {
    if (y < M + 60) newPage();
    text(t.title, M, 11, bold, red);
    y -= 14;
    const cols = t.header.length;
    const colW = (W - 2 * M) / cols;
    const size = cols > 10 ? 6.2 : cols > 6 ? 7.5 : 9;
    const drawRow = (cells: Cell[], f: PDFFont, shade: boolean, isHeader = false) => {
      if (y < M + 14) newPage();
      if (shade) page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: size + 6, color: rgb(0.95, 0.95, 0.95) });
      cells.forEach((c, i) => {
        const v = !isHeader && typeof c === 'number' && t.money?.includes(i) ? brl(c) : String(c ?? '');
        page.drawText(fit(v, colW - 4, size, f), { x: M + i * colW + 2, y, size, font: f, color: rgb(0.07, 0.07, 0.07) });
      });
      y -= size + 6;
    };
    drawRow(t.header, bold, true, true);
    if (!t.rows.length) drawRow(['Sem registros'], font, false);
    t.rows.forEach((row) => drawRow(row, font, false));
    y -= 14;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Página ${i + 1} de ${pages.length} · Documento com dados pessoais — uso restrito ao produtor (LGPD)`, { x: M, y: 14, size: 7, font, color: rgb(0.5, 0.5, 0.5) }));
  return Buffer.from(await pdf.save());
}
