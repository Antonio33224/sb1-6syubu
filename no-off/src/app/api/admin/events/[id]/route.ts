/** Super admin: visibilidade e status de uma festa. */
import { createAdminEventsHandlers } from '@/lib/server/platform/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const h = createAdminEventsHandlers();
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return h.PATCH(req, (await ctx.params).id);
}
