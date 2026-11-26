'use client';
/**
 * Pagamento Pix pela MisticPay: QR + copia e cola + contagem regressiva.
 * O botão de cartão só aparece se cardAvailable (a MisticPay não tem cartão).
 * O status é acompanhado pela página que usa o componente (polling ~4 s).
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, CreditCard, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import type { PixInfo } from '@/services/api-client';

/** Aceita URL https, data URL ou base64 cru (PNG). */
function qrSrc(img: string): string | null {
  const v = img.trim();
  if (!v) return null;
  if (/^(https:\/\/|data:image\/)/i.test(v)) return v;
  if (/^[A-Za-z0-9+/=\s]+$/.test(v)) return `data:image/png;base64,${v.replace(/\s/g, '')}`;
  return null;
}

function useCountdown(until: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, new Date(until).getTime() - now);
}

export function PixPayment({
  pix,
  paid,
  cardAvailable,
  sandbox,
  busy,
  error,
  onCreatePix,
  onCard,
}: {
  pix: PixInfo | null;
  paid: boolean;
  cardAvailable: boolean;
  sandbox: boolean;
  /** 'pix' | 'card' enquanto a cobrança é criada. */
  busy: 'pix' | 'card' | null;
  error?: string | null;
  onCreatePix: () => void;
  onCard: () => void;
}) {
  const toast = useToast();
  const remaining = useCountdown(pix?.expires_at);
  const expired = remaining === 0;
  const src = pix ? qrSrc(pix.qr_image) : null;
  const mm = remaining !== null ? String(Math.floor(remaining / 60000)).padStart(2, '0') : '';
  const ss = remaining !== null ? String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0') : '';

  if (paid) {
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center" role="status" aria-live="polite">
        <CheckCircle2 className="h-12 w-12 text-red-bright" />
        <p className="font-display text-[24px] font-extrabold uppercase tracking-tight">Pagamento confirmado!</p>
        <p className="text-sm text-mute">Seus ingressos foram emitidos e enviados por e-mail.</p>
      </div>
    );
  }

  const copy = () =>
    pix &&
    navigator.clipboard
      .writeText(pix.br_code)
      .then(() => toast('Código Pix copiado.'))
      .catch(() => toast('Não foi possível copiar. Selecione o código e copie manualmente.'));

  return (
    <div className="card flex flex-col gap-5 p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-red-bright">Pagamento</p>
        {sandbox && <span className="rounded-full border border-line px-3 py-1 text-[10px] font-bold uppercase tracking-nav text-mute">Ambiente de teste</span>}
      </div>

      {error && <p role="alert" className="rounded-card border border-red/40 bg-red-soft px-4 py-3 text-[13px]">{error}</p>}

      {!pix ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          {busy === 'pix' ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-red-bright" />
              <p className="text-sm text-mute">Gerando o Pix…</p>
            </>
          ) : (
            <button onClick={onCreatePix} disabled={busy !== null} className="btn-primary"><QrCode className="h-4 w-4" /> Pagar com Pix</button>
          )}
        </div>
      ) : expired ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-bone/85">Este código Pix expirou.</p>
          <button onClick={onCreatePix} disabled={busy !== null} className="btn-outline self-start"><RefreshCw className="h-4 w-4" /> Gerar novo Pix</button>
        </div>
      ) : (
        <>
          <p className="text-sm text-bone/85">Abra o app do seu banco, escolha <strong>Pix → Pagar com QR Code</strong> ou use o copia e cola. A confirmação é automática.</p>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="QR Code Pix" width={224} height={224} className="h-56 w-56 self-center rounded-card bg-white p-3" />
          ) : null}
          <label>
            <span className="field-label">Pix copia e cola</span>
            <textarea readOnly className="field h-auto break-all py-3 font-mono text-[11px]" rows={3} value={pix.br_code} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button onClick={copy} className="btn-primary self-start"><Copy className="h-4 w-4" /> Copiar código</button>
          <div className="flex items-center gap-2 text-[12px] text-mute" role="timer" aria-live="off">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Aguardando pagamento{remaining !== null ? <> · expira em <strong className="font-display text-bone">{mm}:{ss}</strong></> : null}
          </div>
          {sandbox && <p className="text-[11px] text-mute">Ambiente de teste: este código não é pagável.</p>}
        </>
      )}

      {cardAvailable && (
        <div className="border-t border-line pt-5">
          <button onClick={onCard} disabled={busy !== null} className="btn-outline">
            {busy === 'card' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pagar com cartão
          </button>
          <p className="mt-2 text-[11px] text-mute">Você será levado à página segura de pagamento. Se já pagou o Pix, não pague de novo.</p>
        </div>
      )}
    </div>
  );
}
