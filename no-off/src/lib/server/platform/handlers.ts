/**
 * Rotas do painel do produtor (relatório) e do super admin (festas, produtores, vendas).
 *
 * - Produtor: GET /api/producer/events/[id]/report — a função SQL
 *   producer_event_report() confere se o usuário é dono da festa (ou super admin).
 * - Super admin: /api/admin/events, /api/admin/events/[id], /api/admin/producers,
 *   /api/admin/sales — papel conferido no servidor (adminGuard) e de novo nas funções admin_*.
 */
import { z } from 'zod';
import { authenticate, json, supabaseEnv, type AuthContext, type SupabaseEnv } from '../auth';
import { adminGuard, defaultAdminDeps, type AdminDeps } from '../admin/handlers';
import { log } from '../log-sanitize';
import { buildTables, toCsv, toPdf, toXlsx, type ReportSection } from '../reports';
import type { EventReport } from '@/types/tickets';

const SAFE = /Sem permissão|Acesso restrito|não encontrad|inválid|suspender/i;
const dbFail = (where: string, e: { message: string }) => {
  const safe = SAFE.test(e.message);
  if (!safe) log.error(`[platform] ${where}`, e.message);
  return json(safe ? (/Sem permissão|Acesso restrito/i.test(e.message) ? 403 : 400) : 503, { error: safe ? e.message.slice(0, 200) : 'Falha ao acessar o banco.' });
};

// ------------------------------------------------------------------ relatório do produtor

export interface ProducerDeps {
  env: () => SupabaseEnv | null;
  authenticate: (req: Request, env: SupabaseEnv) => Promise<AuthContext | null>;
}
export const defaultProducerDeps: ProducerDeps = { env: () => supabaseEnv(), authenticate };

const FORMATS = ['csv', 'xlsx', 'pdf'] as const;
const SECTIONS = ['compradores', 'vip', 'faturamento', 'completo'] as const;

const fileSafe = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'festa';

export function createReportHandler(deps: ProducerDeps = defaultProducerDeps) {
  return async function GET(req: Request, eventId: string) {
    const env = deps.env();
    if (!env) return json(503, { error: 'Supabase não configurado.' });
    const auth = await deps.authenticate(req, env);
    if (!auth) return json(401, { error: 'Entre na sua conta.' });
    if (!z.string().uuid().safeParse(eventId).success) return json(404, { error: 'Festa não encontrada.' });
    const sp = new URL(req.url).searchParams;
    const format = (FORMATS as readonly string[]).includes(sp.get('format') ?? '') ? (sp.get('format') as (typeof FORMATS)[number]) : 'csv';
    const section = (SECTIONS as readonly string[]).includes(sp.get('section') ?? '') ? (sp.get('section') as ReportSection) : 'completo';

    const { data, error } = await auth.db.rpc('producer_event_report', { p_event: eventId });
    if (error) return dbFail('report', error);
    const report = data as EventReport;
    const tables = buildTables(report, section);
    const base = `nooff-${fileSafe(report.event.name)}-${section}`;
    const headers = (type: string, ext: string) => ({
      'content-type': type,
      'content-disposition': `attachment; filename="${base}.${ext}"`,
      'cache-control': 'no-store',
    });

    if (format === 'csv') return new Response(toCsv(tables), { headers: headers('text/csv; charset=utf-8', 'csv') });
    if (format === 'xlsx') {
      const buf = await toXlsx(tables, report.event.name);
      return new Response(new Uint8Array(buf), { headers: headers('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx') });
    }
    const pdf = await toPdf(tables, report);
    return new Response(new Uint8Array(pdf), { headers: headers('application/pdf', 'pdf') });
  };
}

// ------------------------------------------------------------------ super admin

const parseBody = async (req: Request) => req.json().catch(() => null);

export function createAdminEventsHandlers(deps: AdminDeps = defaultAdminDeps) {
  async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const { data, error } = await g.auth.db.rpc('admin_events_overview');
    if (error) return dbFail('events.list', error);
    return json(200, { events: data ?? [] });
  }

  const patchInput = z.discriminatedUnion('action', [
    z.object({
      action: z.literal('visibility'),
      visibility: z.enum(['hidden', 'partial', 'visible']),
      hide_price: z.boolean(),
      hide_location: z.boolean(),
      hide_name: z.boolean(),
      hide_capacity: z.boolean(),
    }),
    z.object({ action: z.literal('status'), status: z.enum(['draft', 'published', 'cancelled', 'suspended']), reason: z.string().trim().max(300).default('') }),
  ]);

  async function PATCH(req: Request, eventId: string) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    if (!z.string().uuid().safeParse(eventId).success) return json(404, { error: 'Festa não encontrada.' });
    const p = patchInput.safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: 'Dados inválidos.' });
    const b = p.data;
    const { error } =
      b.action === 'visibility'
        ? await g.auth.db.rpc('admin_set_event_visibility', {
            p_event: eventId,
            p_visibility: b.visibility,
            p_hide_price: b.hide_price,
            p_hide_location: b.hide_location,
            p_hide_name: b.hide_name,
            p_hide_capacity: b.hide_capacity,
          })
        : await g.auth.db.rpc('admin_set_event_status', { p_event: eventId, p_status: b.status, p_reason: b.reason });
    if (error) return dbFail('events.patch', error);
    return json(200, { ok: true });
  }

  return { GET, PATCH };
}

export function createAdminProducersHandlers(deps: AdminDeps = defaultAdminDeps) {
  async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const { data, error } = await g.auth.db.rpc('admin_producers');
    if (error) return dbFail('producers.list', error);
    return json(200, { producers: data ?? [] });
  }

  async function PATCH(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const p = z.object({ user_id: z.string().uuid(), suspended: z.boolean(), reason: z.string().trim().max(300).default('') }).safeParse(await parseBody(req));
    if (!p.success) return json(400, { error: 'Dados inválidos.' });
    const { error } = await g.auth.db.rpc('admin_set_user_suspended', { p_user: p.data.user_id, p_suspended: p.data.suspended, p_reason: p.data.reason });
    if (error) return dbFail('producers.suspend', error);
    return json(200, { ok: true });
  }

  return { GET, PATCH };
}

export function createAdminSalesHandler(deps: AdminDeps = defaultAdminDeps) {
  return async function GET(req: Request) {
    const g = await adminGuard(req, deps);
    if (g.error) return g.error;
    const { data, error } = await g.auth.db.rpc('admin_sales', { p_limit: 200 });
    if (error) return dbFail('sales', error);
    return json(200, data as Record<string, unknown>);
  };
}
