'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mic, Trash2 } from 'lucide-react';
import { timeAgo } from '@/lib/format';
import {
  deleteVoiceConversation,
  listVoiceConversations,
  loadVoiceConversation,
  type SavedMessage,
  type VoiceConversationSummary,
} from '@/services/voice-client';
import { VoiceCards } from './VoiceCards';

/** Conversas salvas (visíveis só para o usuário, apagáveis). */
export function VoiceHistory({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<VoiceConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SavedMessage[]>([]);

  const refresh = useCallback(() => {
    listVoiceConversations()
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const open = async (id: string) => {
    setOpenId(id);
    setMessages([]);
    try {
      setMessages(await loadVoiceConversation(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteVoiceConversation(id);
      if (openId === id) setOpenId(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        onClick={openId ? () => setOpenId(null) : onBack}
        className="mb-3 inline-flex items-center gap-2 self-start text-[11px] font-semibold uppercase tracking-nav text-mute hover:text-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
      >
        <ArrowLeft className="h-4 w-4" /> {openId ? 'Conversas' : 'Voltar'}
      </button>
      {error && <p className="mb-3 text-[12px] text-mute">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {openId ? (
          <ol className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <li key={i} className={m.role === 'user' ? 'self-end text-right' : ''}>
                <p className={`inline-block max-w-[300px] rounded-card px-3 py-2 text-[13px] ${m.role === 'user' ? 'bg-blue-soft text-bone' : 'bg-panel text-bone/90'}`}>{m.content}</p>
                {m.sources?.length ? <div className="mt-2"><VoiceCards cards={m.sources} /></div> : null}
              </li>
            ))}
          </ol>
        ) : list === null ? (
          <p className="text-[12px] text-mute">Carregando…</p>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-mute">Nenhuma conversa salva. Ative “Salvar conversas” para guardar as transcrições.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2.5">
                <button onClick={() => open(c.id)} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                  <span className="flex items-center gap-1.5 truncate text-[13px] text-bone">
                    {c.channel === 'voice' && <Mic className="h-3 w-3 shrink-0 text-blue" aria-label="Voz" />}
                    {c.title}
                  </span>
                  <span className="text-[11px] text-mute">{timeAgo(c.updated_at)}</span>
                </button>
                <button
                  onClick={() => remove(c.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-mute hover:text-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
                  aria-label={`Apagar conversa “${c.title}”`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
