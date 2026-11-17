/** Execução das tool calls do concierge de voz no banco (somente leitura). */
import { createToolHandler } from '@/lib/server/voice/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createToolHandler();
