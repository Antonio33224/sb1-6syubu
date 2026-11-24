'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Camera, CameraOff, CheckCircle2, Search, XCircle } from 'lucide-react';
import { maskCpf } from '@/lib/cpf';
import { producerService } from '@/services/ticket-service';
import type { AttendeeHit, CheckinResult } from '@/types';

const MESSAGES: Record<CheckinResult['result'], string> = {
  ok: 'Entrada liberada',
  already_used: 'Ingresso JÁ UTILIZADO',
  cancelled: 'Ingresso cancelado / estornado',
  not_approved: 'Nome não aprovado na lista VIP',
  not_found: 'QR Code não encontrado',
  wrong_event: 'Ingresso de OUTRA festa',
};

/**
 * Portaria: leitura do QR pela câmera do celular e busca por nome/CPF.
 * A validação e o bloqueio de reuso acontecem no banco (checkin_ticket com FOR UPDATE).
 */
export function CheckinPanel({ eventId }: { eventId: string }) {
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AttendeeHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const show = (r: CheckinResult) => {
    setResult(r);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(r.result === 'ok' ? 80 : [200, 80, 200]);
  };

  const submitCode = useCallback(
    async (raw: string) => {
      const c = raw.trim().toUpperCase();
      if (!c) return;
      // Ignora a mesma leitura repetida pela câmera por 3 s.
      if (lastRef.current.code === c && Date.now() - lastRef.current.at < 3000) return;
      lastRef.current = { code: c, at: Date.now() };
      setBusy(true);
      try {
        show(await producerService.checkinCode(eventId, c));
      } catch (e) {
        setCamError(e instanceof Error ? e.message : 'Erro no check-in.');
      } finally {
        setBusy(false);
      }
    },
    [eventId],
  );

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const start = async () => {
    setCamError(null);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      setScanning(true);
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current!,
        (res) => {
          if (res) void submitCode(res.getText());
        },
      );
    } catch (e) {
      setScanning(false);
      setCamError(e instanceof Error && /Permission|NotAllowed/i.test(e.name + e.message) ? 'Permita o acesso à câmera no navegador.' : 'Não foi possível abrir a câmera. Use a busca ou digite o código.');
    }
  };

  useEffect(() => () => controlsRef.current?.stop(), []);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      setHits(await producerService.searchAttendees(eventId, q));
    } finally {
      setBusy(false);
    }
  };

  const checkHit = async (h: AttendeeHit) => {
    setBusy(true);
    try {
      show(h.kind === 'vip' ? await producerService.checkinVip(h.id) : await producerService.checkinTicket(h.id));
      setHits(await producerService.searchAttendees(eventId, q));
    } finally {
      setBusy(false);
    }
  };

  const ok = result?.result === 'ok';

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="relative aspect-square overflow-hidden rounded-card border border-line bg-panel sm:aspect-video lg:aspect-square">
          <video ref={videoRef} className={clsx('h-full w-full object-cover', !scanning && 'hidden')} muted playsInline />
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <Camera className="h-10 w-10 text-mute" />
              <p className="text-sm text-mute">Aponte a câmera para o QR Code do ingresso.</p>
            </div>
          )}
          {scanning && <div className="pointer-events-none absolute inset-[18%] rounded-card border-2 border-red-bright" />}
        </div>
        <div className="flex flex-wrap gap-3">
          {scanning ? (
            <button onClick={stop} className="btn-ghost"><CameraOff className="h-4 w-4" /> Parar câmera</button>
          ) : (
            <button onClick={start} className="btn-primary"><Camera className="h-4 w-4" /> Ler QR Code</button>
          )}
        </div>
        {camError && <p role="alert" className="text-[13px] text-red-bright">{camError}</p>}
        <form onSubmit={(e) => { e.preventDefault(); void submitCode(code); setCode(''); }} className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ou digite o código (NO…)" className="field font-mono uppercase" aria-label="Código do ingresso" />
          <button disabled={busy} className="btn-outline">Validar</button>
        </form>
      </div>

      <div className="flex flex-col gap-6">
        <div
          role="status"
          aria-live="assertive"
          className={clsx(
            'flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-card border-2 p-6 text-center transition-colors',
            !result ? 'border-line' : ok ? 'border-bone bg-bone/10' : 'border-red-bright bg-red-soft',
          )}
        >
          {!result ? (
            <p className="text-sm text-mute">O resultado da leitura aparece aqui.</p>
          ) : (
            <>
              {ok ? <CheckCircle2 className="h-12 w-12" /> : <XCircle className="h-12 w-12 text-red-bright" />}
              <p className="font-display text-[24px] font-extrabold uppercase tracking-tight">{MESSAGES[result.result]}</p>
              {'holder_name' in result && <p className="text-[15px]">{result.holder_name}</p>}
              {'batch' in result && result.batch && <p className="text-[12px] text-mute">{result.batch}</p>}
              {result.result === 'already_used' && <p className="text-[12px] text-mute">Usado em {new Date(result.used_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</p>}
            </>
          )}
        </div>

        <form onSubmit={search} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou CPF" className="field" aria-label="Buscar participante" />
          <button disabled={busy} className="btn-outline"><Search className="h-4 w-4" /></button>
        </form>
        {hits && (
          <ul className="divide-y divide-line rounded-card border border-line">
            {hits.length === 0 && <li className="p-4 text-sm text-mute">Ninguém encontrado.</li>}
            {hits.map((h) => {
              const used = h.status === 'used';
              const blocked = h.status === 'cancelled' || h.status === 'pending' || h.status === 'rejected';
              return (
                <li key={`${h.kind}-${h.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-semibold">{h.name}</p>
                    <p className="text-[11px] text-mute">{h.batch} · CPF {maskCpf(h.cpf)}</p>
                  </div>
                  {used ? (
                    <span className="text-[10px] font-bold uppercase tracking-nav text-mute">Já entrou {h.used_at ? new Date(h.used_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  ) : blocked ? (
                    <span className="text-[10px] font-bold uppercase tracking-nav text-red-bright">{h.status === 'cancelled' ? 'Cancelado' : 'Não aprovado'}</span>
                  ) : (
                    <button disabled={busy} onClick={() => checkHit(h)} className="btn-primary btn-sm">Check-in</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
