'use client';
/**
 * Sessão de voz com a OpenAI Realtime API via WebRTC (fala → fala).
 *
 *  1. pede o microfone (sem permissão → modo texto na MESMA sessão realtime);
 *  2. POST /api/voice/session → token efêmero (a chave fica no servidor);
 *  3. oferta SDP → https://api.openai.com/v1/realtime/calls → resposta SDP;
 *  4. eventos JSON pelo data channel "oai-events": legendas, estados e tool calls;
 *  5. tool calls são executadas no servidor (POST /api/voice/tool) e o resultado
 *     volta para a sessão como function_call_output + response.create.
 *
 * A interrupção (falar por cima) é feita pelo VAD do servidor
 * (turn_detection.interrupt_response = true); o WebRTC corta o áudio sozinho.
 */
import { citedCards, type VoiceCard, type VoiceSessionResponse } from '@/lib/voice/shared';
import { endVoiceSession, runVoiceTool, startVoiceSession, VoiceClientError } from '@/services/voice-client';

export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type EndReason = 'user' | 'timeout' | 'expired' | 'network' | 'error';

export interface Caption {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  final: boolean;
}

export interface RealtimeCallbacks {
  onState: (s: VoiceState) => void;
  onCaption: (c: Caption) => void;
  onCards: (cards: VoiceCard[]) => void;
  /** Turno finalizado (para salvar no histórico, se o usuário optou). */
  onTurn: (role: 'user' | 'assistant', text: string, cards: VoiceCard[]) => void;
  /** Aviso não fatal (ex.: microfone negado → modo texto). */
  onNotice: (message: string, code: string) => void;
  onEnded: (reason: EndReason, message?: string) => void;
}

interface ServerEvent {
  type: string;
  [k: string]: unknown;
}

interface FunctionCallItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

/** Erros do servidor que fazem parte do fluxo normal (não exibimos). */
const BENIGN_ERRORS = new Set(['response_cancel_not_active', 'conversation_already_has_active_response']);

export const supportsWebRTC = () => typeof window !== 'undefined' && 'RTCPeerConnection' in window && !!navigator.mediaDevices;

export class RealtimeVoiceSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private outAnalyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private session: VoiceSessionResponse | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tools = new Map<string, Promise<Record<string, unknown>>>();
  private handledCalls = new Set<string>();
  private turnCards: VoiceCard[] = [];
  private partial = new Map<string, string>();
  private state: VoiceState = 'idle';
  private stopped = false;
  textOnly = false;

  constructor(private cb: RealtimeCallbacks) {}

  get currentState() {
    return this.state;
  }

  private setState(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState(s);
  }

  async start(): Promise<void> {
    if (!supportsWebRTC()) throw new VoiceClientError('Seu navegador não suporta conversas por voz em tempo real (WebRTC).', 'unsupported');
    this.setState('connecting');

    // 1) Microfone antes do token, para o pedido de permissão não consumir a validade do token.
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      this.textOnly = true;
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.cb.onNotice(
        denied ? 'Sem permissão para o microfone. Você pode digitar — o concierge responde por voz.' : 'Nenhum microfone encontrado. Você pode digitar sua pergunta.',
        denied ? 'mic_denied' : 'mic_unavailable',
      );
    }
    if (this.stopped) return this.cleanup();

    // 2) Token efêmero.
    this.session = await startVoiceSession();
    if (this.stopped) return this.cleanup();

    // 3) WebRTC.
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    void this.ctx.resume().catch(() => undefined);
    if (this.mic) {
      this.micAnalyser = this.analyser(this.ctx.createMediaStreamSource(this.mic));
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.audioEl = document.createElement('audio');
    this.audioEl.autoplay = true;
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream || !this.audioEl) return;
      this.audioEl.srcObject = stream;
      void this.audioEl.play().catch(() => undefined);
      if (this.ctx && !this.outAnalyser) this.outAnalyser = this.analyser(this.ctx.createMediaStreamSource(stream));
    };
    if (this.mic) this.mic.getTracks().forEach((t) => pc.addTrack(t, this.mic!));
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (e) => {
      try {
        void this.handle(JSON.parse(String(e.data)) as ServerEvent);
      } catch {
        /* evento malformado: ignora */
      }
    };
    dc.onopen = () => this.setState('listening');
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') this.stop('network', 'A conexão de voz caiu.');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(REALTIME_CALLS_URL, {
      method: 'POST',
      body: offer.sdp,
      headers: { authorization: `Bearer ${this.session.client_secret}`, 'content-type': 'application/sdp' },
    });
    if (!res.ok) throw new VoiceClientError('Não foi possível iniciar a conversa de voz.', 'webrtc_failed', res.status);
    if (this.stopped) return this.cleanup();
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

    // Limite de duração por sessão (o servidor também recusa tool calls depois disso).
    const untilExpiry = Date.parse(this.session.session_expires_at) - Date.now();
    const ms = Math.max(5_000, Math.min(this.session.max_seconds * 1000, Number.isFinite(untilExpiry) ? untilExpiry : Infinity));
    this.timer = setTimeout(() => this.stop('timeout', 'Sessão encerrada: limite de duração atingido.'), ms);
  }

  private analyser(source: MediaStreamAudioSourceNode): AnalyserNode {
    const a = source.context.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0.6;
    source.connect(a);
    return a;
  }

  /** Amplitude atual (0–1) do mic (ouvindo) ou da fala da IA (falando). */
  level(): number {
    const a = this.state === 'speaking' ? this.outAnalyser : this.state === 'listening' ? this.micAnalyser : null;
    if (!a) return 0;
    a.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 5);
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Mensagem digitada (fallback sem microfone) na mesma sessão realtime. */
  sendText(text: string): boolean {
    const t = text.trim().slice(0, 1000);
    if (!t || this.dc?.readyState !== 'open') return false;
    this.turnCards = [];
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } });
    this.send({ type: 'response.create' });
    const id = `text-${Date.now()}`;
    this.cb.onCaption({ id, role: 'user', text: t, final: true });
    this.cb.onTurn('user', t, []);
    this.setState('thinking');
    return true;
  }

  private send(obj: Record<string, unknown>) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  private caption(role: Caption['role'], id: string, delta: string | null, full?: string) {
    const text = full ?? (this.partial.get(id) ?? '') + (delta ?? '');
    if (full === undefined) this.partial.set(id, text);
    else this.partial.delete(id);
    this.cb.onCaption({ id, role, text, final: full !== undefined });
  }

  private async handle(ev: ServerEvent): Promise<void> {
    const itemId = String(ev.item_id ?? ev.response_id ?? '');
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        // Novo turno do usuário (inclusive interrompendo a IA).
        this.turnCards = [];
        this.setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.setState('thinking');
        break;

      case 'conversation.item.input_audio_transcription.delta':
        this.caption('user', itemId, String(ev.delta ?? ''));
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const t = String(ev.transcript ?? '').trim();
        this.caption('user', itemId, null, t);
        if (t) this.cb.onTurn('user', t, []);
        break;
      }

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.caption('assistant', itemId, String(ev.delta ?? ''));
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const t = String(ev.transcript ?? '').trim();
        this.caption('assistant', itemId, null, t);
        if (t) {
          const cards = citedCards(t, this.turnCards);
          if (cards.length) this.cb.onCards(cards);
          this.cb.onTurn('assistant', t, cards);
        }
        break;
      }

      case 'output_audio_buffer.started':
        this.setState('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (this.state === 'speaking') this.setState('listening');
        break;

      case 'response.function_call_arguments.done':
        this.startTool({ call_id: ev.call_id as string, name: ev.name as string, arguments: ev.arguments as string });
        break;
      case 'response.output_item.done': {
        const item = ev.item as FunctionCallItem | undefined;
        if (item?.type === 'function_call') this.startTool(item);
        break;
      }
      case 'response.done':
        await this.finishTools(ev.response as { status?: string; output?: FunctionCallItem[] } | undefined);
        break;

      case 'error': {
        const err = (ev.error ?? {}) as { code?: string; message?: string };
        if (err.code && BENIGN_ERRORS.has(err.code)) break;
        console.warn('[voice] realtime error', err.code, err.message);
        this.cb.onNotice('O concierge teve um problema para responder. Tente de novo.', err.code ?? 'realtime_error');
        if (this.state === 'thinking') this.setState('listening');
        break;
      }
    }
  }

  private startTool(item: FunctionCallItem) {
    const callId = item.call_id;
    if (!callId || !item.name || this.tools.has(callId) || this.handledCalls.has(callId) || !this.session) return;
    this.setState('thinking');
    const p = runVoiceTool(this.session.session_id, item.name, item.arguments ?? '{}')
      .then((r) => {
        this.turnCards.push(...r.cards);
        return r.output;
      })
      .catch((err: unknown) => {
        if (err instanceof VoiceClientError && (err.status === 410 || err.status === 401)) {
          setTimeout(() => this.stop('expired', err.message), 0);
        }
        return err instanceof VoiceClientError && err.output ? err.output : { erro: err instanceof Error ? err.message : 'Falha na consulta.' };
      });
    this.tools.set(callId, p);
  }

  /** Ao fim de uma resposta com tool calls, devolve os resultados e pede a continuação. */
  private async finishTools(response: { status?: string; output?: FunctionCallItem[] } | undefined) {
    const calls = (response?.output ?? []).filter((o) => o.type === 'function_call' && o.call_id);
    if (!calls.length) {
      if (this.state === 'thinking' && response?.status !== 'in_progress') this.setState('listening');
      return;
    }
    calls.forEach((c) => this.startTool(c));
    if (response?.status !== 'completed') return; // resposta cancelada (interrupção): o VAD gera outra
    const outputs = await Promise.all(calls.map(async (c) => ({ call_id: c.call_id!, output: await this.tools.get(c.call_id!)! })));
    if (this.stopped) return;
    for (const o of outputs) {
      this.tools.delete(o.call_id);
      this.handledCalls.add(o.call_id);
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: o.call_id, output: JSON.stringify(o.output) } });
    }
    this.send({ type: 'response.create' });
  }

  stop(reason: EndReason = 'user', message?: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    this.setState('idle');
    this.cb.onEnded(reason, message);
  }

  private cleanup() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.dc?.close();
      this.pc?.getSenders().forEach((s) => s.track?.stop());
      this.pc?.close();
    } catch {
      /* já fechado */
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.audioEl) this.audioEl.srcObject = null;
    void this.ctx?.close().catch(() => undefined);
    if (this.session) void endVoiceSession(this.session.session_id);
    this.pc = this.dc = this.mic = this.audioEl = this.ctx = this.micAnalyser = this.outAnalyser = null;
    this.session = null;
    this.tools.clear();
  }
}
