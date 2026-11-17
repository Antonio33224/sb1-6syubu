/** Sessão do concierge de voz: token efêmero da OpenAI Realtime (a chave fica no servidor). */
import { createSessionHandlers } from '@/lib/server/voice/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createSessionHandlers();
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
