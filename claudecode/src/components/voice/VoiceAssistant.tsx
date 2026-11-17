'use client';
/**
 * Concierge de voz do Classify DJ: orbe flutuante (canto inferior direito, em
 * todas as páginas) que expande para um painel com o geoide, legendas ao vivo,
 * cartões de resultado, mutar e encerrar.
 *
 * Atalhos: Ctrl/Cmd + J abre/fecha · Esc fecha o painel (a conversa continua no orbe).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, History, Mic, MicOff, PhoneOff, Send, X } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { voiceAvailableInThisMode } from '@/services/voice-client';
import { supportsWebRTC, type VoiceState } from './realtime';
import { useGeoidScene } from './useGeoidScene';
import { useVoiceSession } from './useVoiceSession';
import { VoiceCards } from './VoiceCards';
import { VoiceHistory } from './VoiceHistory';

const STATUS: Record<VoiceState, string> = {
  idle: 'Toque para falar',
  connecting: 'Conectando…',
  listening: 'Ouvindo…',
  thinking: 'Consultando o Classify DJ…',
  speaking: 'Falando…',
  error: 'Algo deu errado',
};

const SAFE_CORNER = { bottom: 'calc(24px + env(safe-area-inset-bottom))', right: 'calc(24px + env(safe-area-inset-right))' };

export function VoiceAssistant() {
  const { user, authReady } = useApp();
  const { isPremium, ready: plusReady } = usePlus();
  const pathname = usePathname();
  const v = useVoiceSession();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'talk' | 'history'>('talk');
  const [available, setAvailable] = useState(true);
  const [orbHost, setOrbHost] = useState<HTMLDivElement | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState('');
  const orbButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => setAvailable(voiceAvailableInThisMode()), []);

  const visual: VoiceState = v.error ? 'error' : v.active ? v.state : 'idle';
  const host = open && view === 'talk' ? panelHost : orbHost;
  const { failed: noWebGL } = useGeoidScene(host, open ? 'full' : 'mini', visual, v.level);
  // Exclusivo Classify+ (assinatura ou gratuidade). O servidor confere de novo (403).
  const canTalk = Boolean(user) && available && isPremium;
  const needsPlus = Boolean(user) && available && plusReady && !isPremium;
  const { start, stop, active } = v;

  const openPanel = useCallback(() => {
    setOpen(true);
    setView('talk');
    // Clique = gesto do usuário: libera microfone e áudio. Abre já ouvindo.
    if (canTalk && !active && supportsWebRTC()) void start();
  }, [canTalk, active, start]);

  const closePanel = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => orbButton.current?.focus());
  }, []);

  // Atalhos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'j' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (open) closePanel();
        else openPanel();
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, openPanel, closePanel]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => closeButton.current?.focus());
  }, [open]);

  // Encerrar a sessão ao sair da conta.
  useEffect(() => {
    if (authReady && !user && active) stop();
  }, [authReady, user, active, stop]);

  // ...e quando o acesso Classify+ termina durante a conversa.
  useEffect(() => {
    if (plusReady && !isPremium && active) stop();
  }, [plusReady, isPremium, active, stop]);

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    if (v.sendText(draft)) setDraft('');
  };

  const lastUser = [...v.captions].reverse().find((c) => c.role === 'user');
  const lastAssistant = [...v.captions].reverse().find((c) => c.role === 'assistant');
  const unsupported = typeof window !== 'undefined' && !supportsWebRTC();

  return (
    <>
      {/* ------------------------------------------------ orbe */}
      {!open && (
        <div className="pointer-events-none fixed z-[90] flex flex-col items-end gap-3" style={SAFE_CORNER}>
          {v.active && v.cards.length > 0 && (
            <div className="pointer-events-auto max-h-[50vh] overflow-y-auto">
              <VoiceCards cards={v.cards.slice(0, 3)} title={v.cardsTitle} compact />
            </div>
          )}
          <button
            ref={orbButton}
            onClick={openPanel}
            className="pointer-events-auto relative h-[72px] w-[72px] overflow-hidden rounded-full border border-blue/30 bg-ink shadow-[0_0_32px_rgba(131,169,245,0.25)] transition-transform duration-300 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue motion-reduce:transition-none"
            aria-label={`Concierge de voz do Classify DJ${v.active ? ` — ${STATUS[visual]}` : ''}. Atalho: Ctrl ou Cmd + J`}
            aria-haspopup="dialog"
          >
            <div ref={setOrbHost} className="absolute inset-0" />
            {noWebGL && <StaticOrb state={visual} />}
            {visual === 'error' && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-bone text-ink">
                <AlertCircle className="h-3 w-3" aria-hidden />
              </span>
            )}
          </button>
        </div>
      )}

      {/* ------------------------------------------------ painel */}
      {open && (
        <div
          role="dialog"
          aria-label="Concierge de voz do Classify DJ"
          className="fixed inset-0 z-[95] flex animate-fade-in flex-col bg-ink px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] sm:inset-auto sm:bottom-[calc(24px+env(safe-area-inset-bottom))] sm:right-[calc(24px+env(safe-area-inset-right))] sm:h-[min(680px,calc(100dvh-48px))] sm:w-[420px] sm:rounded-card sm:border sm:border-line sm:pb-5 sm:shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        >
          <header className="flex items-center justify-between pb-2">
            <div>
              <p className="font-display text-[13px] font-extrabold uppercase tracking-[0.14em] text-bone">
                Concierge <span className="text-blue">DJ</span>
              </p>
              <p className="text-[11px] text-mute" aria-live="polite">
                {canTalk ? STATUS[visual] : 'Assistente de voz'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {canTalk && (
                <IconButton label={view === 'history' ? 'Voltar à conversa' : 'Conversas salvas'} onClick={() => setView(view === 'history' ? 'talk' : 'history')}>
                  <History className="h-[18px] w-[18px]" />
                </IconButton>
              )}
              <IconButton ref={closeButton} label="Fechar painel (Esc)" onClick={closePanel}>
                <X className="h-5 w-5" />
              </IconButton>
            </div>
          </header>

          {view === 'history' && canTalk ? (
            <VoiceHistory onBack={() => setView('talk')} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {v.cards.length > 0 && (
                <div className="pb-3">
                  <VoiceCards cards={v.cards} title={v.cardsTitle} onNavigate={() => window.innerWidth < 640 && closePanel()} />
                </div>
              )}

              <div className="relative mx-auto aspect-square w-full max-w-[280px] shrink overflow-hidden rounded-full">
                <div ref={setPanelHost} className="absolute inset-0" />
                {noWebGL && <StaticOrb state={visual} large />}
              </div>

              <div className="mt-4 min-h-[88px] flex-1 overflow-y-auto text-center" aria-live="polite" aria-atomic="false">
                {!authReady ? null : !available ? (
                  <p className="text-[13px] text-mute">O concierge de voz usa apenas dados reais e precisa do banco de dados (Supabase) configurado. No modo demonstração ele fica desativado.</p>
                ) : !user ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-[14px] text-bone/90">Entre na sua conta para conversar por voz com o concierge do Classify DJ.</p>
                    <Link href={`/entrar?next=${encodeURIComponent(pathname)}`} onClick={closePanel} className="btn-outline">
                      Entrar
                    </Link>
                  </div>
                ) : needsPlus ? (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-[14px] text-bone/90">O concierge de voz é exclusivo para assinantes <span className="text-blue">Classify+</span>.</p>
                    <p className="text-[12px] text-mute">Assine ou resgate um cupom para conversar por voz com o Classify DJ.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Link href="/classify-plus" onClick={closePanel} className="btn-primary btn-sm">Conhecer o Classify+</Link>
                      <Link href="/assinatura#cupom" onClick={closePanel} className="btn-outline btn-sm">Tenho um cupom</Link>
                    </div>
                  </div>
                ) : !plusReady ? null : (
                  <>
                    {lastUser && <p className="text-[13px] text-mute">“{lastUser.text}”</p>}
                    {lastAssistant && <p className="mt-2 text-[15px] leading-relaxed text-bone">{lastAssistant.text}</p>}
                    {!lastUser && !lastAssistant && v.active && !v.textMode && (
                      <p className="text-[13px] text-mute">Pergunte, por exemplo: “Onde tem techno sábado em São Paulo até 100 reais?”</p>
                    )}
                    {unsupported && <p className="text-[13px] text-mute">Seu navegador não suporta conversa por voz em tempo real (WebRTC). Tente em um navegador atualizado.</p>}
                  </>
                )}
                {v.error && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-card border border-line px-3 py-2 text-[12px] text-bone" role="alert">
                    <AlertCircle className="h-4 w-4 shrink-0 text-blue" aria-hidden /> {v.error.message}
                  </p>
                )}
                {v.notice && !v.error && <p className="mt-3 text-[12px] text-mute">{v.notice}</p>}
              </div>

              {canTalk && (
                <div className="pt-3">
                  {v.active && v.textMode && (
                    <form onSubmit={submitText} className="mb-3 flex items-center gap-2">
                      <label htmlFor="voice-text" className="sr-only">Digite sua pergunta</label>
                      <input
                        id="voice-text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={1000}
                        placeholder="Digite sua pergunta…"
                        className="h-10 min-w-0 flex-1 rounded-full border border-line bg-panel px-4 text-[13px] text-bone placeholder:text-mute focus:border-blue focus:outline-none"
                      />
                      <IconButton label="Enviar" type="submit" disabled={!draft.trim()}>
                        <Send className="h-4 w-4" />
                      </IconButton>
                    </form>
                  )}

                  <div className="flex items-center justify-center gap-4">
                    {v.active ? (
                      <>
                        <IconButton
                          label={v.muted ? 'Ativar microfone' : 'Mutar microfone'}
                          onClick={() => v.setMuted(!v.muted)}
                          disabled={v.textMode}
                          pressed={v.muted}
                          size="lg"
                        >
                          {v.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                        </IconButton>
                        <button
                          onClick={v.stop}
                          className="inline-flex h-12 items-center gap-2 rounded-full bg-bone px-6 text-[11px] font-bold uppercase tracking-nav text-ink transition-colors hover:bg-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                        >
                          <PhoneOff className="h-4 w-4" aria-hidden /> Encerrar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          v.clearError();
                          void v.start();
                        }}
                        disabled={unsupported}
                        className="inline-flex h-12 items-center gap-2 rounded-full border border-blue px-6 text-[11px] font-bold uppercase tracking-nav text-bone transition-colors hover:bg-blue hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-40"
                      >
                        <Mic className="h-4 w-4" aria-hidden /> {v.error ? 'Tentar de novo' : 'Começar a falar'}
                      </button>
                    )}
                  </div>

                  <label className="mt-4 flex items-center justify-center gap-2 text-[11px] text-mute">
                    <input type="checkbox" checked={v.save} onChange={(e) => v.setSave(e.target.checked)} className="h-3.5 w-3.5 accent-blue" />
                    Salvar conversas (só você vê; pode apagar quando quiser)
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Orbe estático (sem WebGL ou enquanto a cena carrega com falha). */
function StaticOrb({ state, large = false }: { state: VoiceState; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'absolute inset-0 rounded-full',
        'bg-[radial-gradient(circle_at_35%_30%,#A38BF0_0%,#83A9F5_35%,#7FD8F2_55%,#050505_75%)]',
        state === 'connecting' || state === 'thinking' ? 'motion-safe:animate-pulse' : '',
        state === 'error' ? 'opacity-40 grayscale' : 'opacity-90',
        large ? 'scale-75' : 'scale-90',
      )}
    />
  );
}

interface IconButtonProps {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  type?: 'button' | 'submit';
  size?: 'md' | 'lg';
  ref?: React.Ref<HTMLButtonElement>;
}

function IconButton({ label, onClick, children, disabled, pressed, type = 'button', size = 'md', ref }: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={clsx(
        'flex items-center justify-center rounded-full border border-line text-bone transition-colors hover:border-blue hover:text-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-40 disabled:hover:border-line disabled:hover:text-bone',
        size === 'lg' ? 'h-12 w-12' : 'h-10 w-10',
        pressed && 'border-blue text-blue',
      )}
    >
      {children}
    </button>
  );
}
