/** Status do pedido do comprador (com reconciliação no MP) e desistência da reserva. */
import { createOrderHandlers } from '@/lib/server/tickets/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createOrderHandlers();
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return h.GET(req, (await ctx.params).id);
}

export async function DELETE(req: Request, ctx: Ctx) {
  return h.DELETE(req, (await ctx.params).id);
}
