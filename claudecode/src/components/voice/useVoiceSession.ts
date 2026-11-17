'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceCard } from '@/lib/voice/shared';
import { saveTranscript, VoiceClientError } from '@/services/voice-client';
import { RealtimeVoiceSession, type Caption, type VoiceState } from './realtime';

const SAVE_KEY = 'classify-voice:save';
const MAX_CAPTIONS = 8;

export interface VoiceError {
  message: string;
  code: string;
}

/** Estado React de uma conversa de voz (uma sessão realtime por vez). */
export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>('idle');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [cards, setCards] = useState<VoiceCard[]>([]);
  const [error, setError] = useState<VoiceError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [save, setSaveState] = useState(false);
  const [active, setActive] = useState(false);

  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const saveRef = useRef(false);
  const conversationRef = useRef<string | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  // "Salvar conversas" é opt-in (padrão desligado) e lembrado neste navegador.
  useEffect(() => {
    try {
      const v = localStorage.getItem(SAVE_KEY) === 'true';
      saveRef.current = v;
      setSaveState(v);
    } catch {
      /* sem storage: fica desligado */
    }
  }, []);

  const setSave = useCallback((v: boolean) => {
    saveRef.current = v;
    setSaveState(v);
    if (!v) conversationRef.current = null;
    try {
      localStorage.setItem(SAVE_KEY, String(v));
    } catch {
      /* ignora */
    }
  }, []);

  const persist = useCallback((role: 'user' | 'assistant', content: string, turnCards: VoiceCard[]) => {
    if (!saveRef.current) return;
    // Em fila: a primeira mensagem cria a conversa; as próximas usam o mesmo id.
    saveChain.current = saveChain.current
      .then(async () => {
        conversationRef.current = await saveTranscript({ conversation_id: conversationRef.current, role, content, cards: turnCards });
      })
      .catch(() => setNotice('Não foi possível salvar esta conversa no histórico.'));
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setNotice(null);
    setCards([]);
    setCaptions([]);
    setMutedState(false);
    setTextMode(false);
    conversationRef.current = null;

    const s = new RealtimeVoiceSession({
      onState: setState,
      onCaption: (c) =>
        setCaptions((list) => {
          const i = list.findIndex((x) => x.id === c.id);
          if (i >= 0) return list.map((x, j) => (j === i ? c : x));
          return [...list, c].slice(-MAX_CAPTIONS);
        }),
      onCards: setCards,
      onTurn: persist,
      onNotice: (message, code) => {
        setNotice(message);
        if (code === 'mic_denied' || code === 'mic_unavailable') setTextMode(true);
      },
      onEnded: (reason, message) => {
        sessionRef.current = null;
        setActive(false);
        if (reason === 'network' || reason === 'error') {
          if (message) setError({ message, code: reason });
          setState('error');
        } else if (message) {
          setNotice(message);
        }
      },
    });
    sessionRef.current = s;
    setActive(true);
    try {
      await s.start();
    } catch (err) {
      const e = err instanceof VoiceClientError ? err : null;
      s.stop('error');
      setError({ message: e?.message ?? 'Não foi possível iniciar a conversa de voz.', code: e?.code ?? 'unknown' });
      setState('error');
    }
  }, [persist]);

  const stop = useCallback(() => sessionRef.current?.stop('user'), []);

  const setMuted = useCallback((m: boolean) => {
    sessionRef.current?.setMuted(m);
    setMutedState(m);
  }, []);

  const sendText = useCallback((text: string) => sessionRef.current?.sendText(text) ?? false, []);

  /** Lido a cada frame pela cena 3D (sem re-render do React). */
  const level = useCallback(() => sessionRef.current?.level() ?? 0, []);

  const clearError = useCallback(() => {
    setError(null);
    setState((s) => (s === 'error' ? 'idle' : s));
  }, []);

  useEffect(() => () => sessionRef.current?.stop('user'), []);

  return { state, active, captions, cards, error, notice, textMode, muted, save, start, stop, setMuted, sendText, setSave, level, clearError };
}
