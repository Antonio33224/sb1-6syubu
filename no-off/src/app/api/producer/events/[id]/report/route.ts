/** Produtor: relatório da festa (CSV, XLSX ou PDF). */
import { createReportHandler } from '@/lib/server/platform/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createReportHandler();
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return h(req, (await ctx.params).id);
}
