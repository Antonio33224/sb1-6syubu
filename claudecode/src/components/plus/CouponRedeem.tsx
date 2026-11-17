'use client';
import { useState, type FormEvent } from 'react';
import { Loader2, Ticket } from 'lucide-react';
import { useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { formatDate } from '@/lib/format';
import { normalizeCouponCode } from '@/lib/coupons';
import { apiAvailable, redeemCoupon } from '@/services/api-client';

/** Resgate de cupom: cada cupom vale N dias de Classify+ (gratuidade, sem cobrança). */
export function CouponRedeem() {
  const { refresh } = usePlus();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!apiAvailable()) {
    return (
      <div id="cupom" className="card p-7">
        <p className="eyebrow">Cupom</p>
        <p className="mt-3 text-[13px] text-mute">Cupons estão disponíveis apenas com o banco de dados (Supabase) configurado. No modo demonstração eles ficam desativados.</p>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeCouponCode(code);
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const r = await redeemCoupon(c);
      setCode('');
      await refresh();
      toast(`Cupom aplicado: ${r.days} ${r.days === 1 ? 'dia' : 'dias'} de Classify+ até ${formatDate(r.ends_at)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aplicar o cupom.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="cupom" onSubmit={submit} className="card p-7" noValidate>
      <p className="eyebrow flex items-center gap-2"><Ticket className="h-3.5 w-3.5" aria-hidden /> Tenho um cupom</p>
      <p className="mt-3 text-[13px] text-mute">Cupons liberam o Classify+ completo (incluindo o concierge de voz) por um período, sem cobrança.</p>
      <div className="mt-5 flex gap-3">
        <label htmlFor="coupon-code" className="sr-only">Código do cupom</label>
        <input
          id="coupon-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          placeholder="EX.: CLASSIFY-7KQ2"
          className="field h-11 font-mono uppercase tracking-wider"
          aria-invalid={!!error}
          aria-describedby={error ? 'coupon-error' : undefined}
        />
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary btn-sm h-11 shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Aplicar'}
        </button>
      </div>
      {error && <p id="coupon-error" role="alert" className="mt-3 text-[12px] text-bone">{error}</p>}
    </form>
  );
}
