'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ArrowUp, CalendarDays, MapPin, MessageSquarePlus, Sparkles, Square, Star, Trash2 } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import {
  AIClientError,
  aiAvailableInThisMode,
  deleteConversation,
  listConversations,
  loadConversation,
  sendMessage,
  type AIConversationSummary,
  type AIMessage,
  type AISource,
} from '@/services/classify-ai-client';

const SUGGESTIONS = [
  'Quero sair sábado, gosto de eletrônica, quero gastar até R$ 150 e prefiro lugares sofisticados.',
  'Qual a casa mais bem avaliada para house na minha cidade?',
  'Tem algum evento com DJ que eu sigo nas próximas semanas?',
];

const SAVE_KEY = 'classify-ai:save';

export function ClassifyAIChat() {
  const { user, authReady } = useApp();
  const available = aiAvailableInThisMode();

  if (!available) {
    return (
      <Notice title="Disponível apenas com o banco real">
        A Classify AI recomenda somente casas e eventos cadastrados no banco do Classify DJ. Este ambiente está em modo demonstração (Supabase não configurado),
        então ela fica desativada em vez de inventar respostas.
      </Notice>
    );
  }
  if (!authReady) return <div className="card h-[420px] animate-pulse" />;
  if (!user) {
    return (
      <Notice title="Entre para conversar">
        A Classify AI usa suas preferências, favoritos e o Meu Ranking para recomendar a noite certa.{' '}
        <Link href="/entrar?next=/classify-ai" className="text-blue underline-offset-4 hover:underline">Entrar na sua conta</Link>
      </Notice>
    );
  }
  return <Chat />;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-8">
      <p className="font-display text-xl font-bold">{title}</p>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-mute">{children}</p>
    </div>
  );
}

function Chat() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AIConversationSummary[]>([]);
  const [save, setSave] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SAVE_KEY);
      if (v !== null) setSave(v === 'true');
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  const refreshList = useCallback(() => {
    listConversations().then(setConversations).catch(() => setConversations([]));
  }, []);
  useEffect(refreshList, [refreshList]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const toggleSave = () => {
    setSave((s) => {
      try {
        localStorage.setItem(SAVE_KEY, String(!s));
      } catch {
        /* ignore */
      }
      return !s;
    });
  };

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
    setStatus(null);
  };

  const open = async (id: string) => {
    abortRef.current?.abort();
    setError(null);
    try {
      setMessages(await loadConversation(id));
      setConversationId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível abrir a conversa.');
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteConversation(id);
      if (id === conversationId) newChat();
      refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível apagar a conversa.');
    }
  };

  const submit = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages;
    setMessages([...history, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setError(null);
    setStatus('Pensando…');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const patchLast = (fn: (m: AIMessage) => AIMessage) =>
      setMessages((ms) => {
        const copy = ms.slice();
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    try {
      await sendMessage(
        { message, history, conversationId: save ? conversationId : null, save },
        (e) => {
          if (e.type === 'status') setStatus(e.message);
          if (e.type === 'text') {
            setStatus(null);
            patchLast((m) => ({ ...m, content: m.content + e.text }));
          }
          if (e.type === 'sources') patchLast((m) => ({ ...m, sources: e.items }));
          if (e.type === 'done') {
            if (save && e.conversationId) setConversationId(e.conversationId);
            if (e.warning) setError(e.warning);
          }
        },
        ctrl.signal,
      );
      if (save) refreshList();
    } catch (e) {
      if (ctrl.signal.aborted) {
        patchLast((m) => (m.content ? m : { ...m, content: '_(resposta interrompida)_' }));
      } else {
        // Remove a resposta vazia e devolve o texto ao campo para reenviar.
        setMessages((ms) => (ms[ms.length - 1]?.content ? ms : ms.slice(0, -2)));
        setInput(message);
        setError(e instanceof AIClientError || e instanceof Error ? e.message : 'Erro inesperado.');
      }
    } finally {
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="card hidden h-fit p-4 lg:block">
        <button type="button" onClick={newChat} className="btn-ghost btn-sm w-full">
          <MessageSquarePlus className="h-4 w-4" /> Nova conversa
        </button>
        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 px-1 text-[12px] text-mute">
          Salvar conversas
          <input type="checkbox" checked={save} onChange={toggleSave} className="h-4 w-4 accent-blue" />
        </label>
        <p className="mt-1 px-1 text-[11px] leading-snug text-mute/70">Ficam visíveis só para você e podem ser apagadas a qualquer momento.</p>
        <ul className="mt-4 space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => open(c.id)}
                className={clsx('min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-[12px] transition-colors hover:bg-ink', c.id === conversationId ? 'text-blue' : 'text-bone/80')}
              >
                {c.title}
              </button>
              <button type="button" onClick={() => remove(c.id)} aria-label="Apagar conversa" className="rounded p-1.5 text-mute opacity-0 transition hover:text-bone group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="card flex min-h-[560px] flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-8" aria-live="polite">
          {messages.length === 0 && (
            <div className="py-6">
              <p className="font-display text-2xl font-bold">Me conta como você quer a sua noite.</p>
              <p className="mt-2 text-[14px] text-mute">Dia, cidade, estilo musical, orçamento, clima do lugar — eu cruzo com as notas reais da comunidade.</p>
              <div className="mt-6 flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => submit(s)} className="rounded-card border border-line px-4 py-3 text-left text-[13px] text-bone/85 transition-colors hover:border-blue hover:text-bone">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} message={m} pending={busy && i === messages.length - 1 && m.role === 'assistant'} />
          ))}
          {status && (
            <p className="flex items-center gap-2 text-[12px] text-mute">
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-blue" /> {status}
            </p>
          )}
          <div ref={endRef} />
        </div>

        {error && <p className="mx-5 mb-3 rounded-card border border-bone/30 px-4 py-3 text-[13px] text-bone sm:mx-8" role="alert">{error}</p>}

        <form
          className="flex items-end gap-3 border-t border-line p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(input);
              }
            }}
            maxLength={2000}
            rows={1}
            placeholder="Ex.: sexta em SP, techno, até R$ 120…"
            aria-label="Mensagem para a Classify AI"
            className="field h-auto max-h-40 min-h-12 resize-none py-3"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="btn-outline h-12 w-12 shrink-0 px-0" aria-label="Parar resposta">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn-primary h-12 w-12 shrink-0 px-0" aria-label="Enviar">
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </form>
        <p className="px-5 pb-4 text-[11px] text-mute/70 sm:px-8">
          Respostas geradas pelo Claude (Anthropic) a partir dos dados cadastrados no Classify DJ. Confira horários e preços antes de sair.
        </p>
      </div>
    </div>
  );
}

function Bubble({ message, pending }: { message: AIMessage; pending: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-card bg-ink px-4 py-3 text-[14px] text-bone">{message.content}</p>
      </div>
    );
  }
  if (!message.content && pending) return null;
  return (
    <div className="max-w-[92%]">
      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-nav text-blue">
        <Sparkles className="h-3 w-3" /> Classify AI
      </p>
      <RichText text={message.content} />
      {!!message.sources?.length && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {message.sources.map((s) => (
            <SourceCard key={`${s.type}:${s.slug}`} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source: s }: { source: AISource }) {
  return (
    <Link href={s.url} className="rounded-card border border-line px-4 py-3 transition-colors hover:border-blue">
      <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">
        {s.type === 'event' ? 'Evento' : 'Casa'}
        {s.is_demo ? ' · demonstração' : ''}
      </p>
      <p className="mt-1 truncate font-display text-[15px] font-bold">{s.name}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
        {s.event_date && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> {s.event_date.split('-').reverse().join('/')}
          </span>
        )}
        {(s.venue_name || s.city) && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {s.venue_name ?? s.city}
          </span>
        )}
        {typeof s.avg_rating === 'number' && (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3" /> {s.avg_rating.toFixed(1)}
          </span>
        )}
      </p>
    </Link>
  );
}

/** Markdown mínimo e seguro (sem HTML): parágrafos, listas, **negrito** e _itálico_. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[14px] leading-relaxed text-bone/90">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-bone">{part.slice(2, -2)}</strong>;
    if (/^_[^_]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}
