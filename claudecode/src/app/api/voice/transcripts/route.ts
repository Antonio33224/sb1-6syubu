/** Histórico opt-in das conversas por voz (privado por RLS e apagável). */
import { createTranscriptHandlers } from '@/lib/server/voice/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createTranscriptHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
