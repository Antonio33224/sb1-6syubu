'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { Check, Clock, Lock } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { PixPayment } from '@/components/tickets/PixPayment';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatEventDate } from '@/lib/format';
import { formatCpf, formatPhone, isFullName, isValidCpf, isValidPhone, onlyDigits } from '@/lib/cpf';
import { ApiError, checkoutApi, type PaymentOptions, type PixInfo, type ReserveResponse } from '@/services/api-client';
import { ticketService } from '@/services/ticket-service';
import { TICKET_TYPE_LABEL, type BuyerInfo } from '@/types';

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="container-site py-16"><Skeleton className="h-96" /></div>}>
      <Checkout />
    </Suspense>
  );
}

type Step = 'dados' | 'pagamento';

/** Intervalo do acompanhamento do status (webhook ou reconciliação no servidor). */
const POLL_MS = 4000;

function parseItems(raw: string | null): { batch_id: string; quantity: number }[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.split(':'))
    .filter(([id, n]) => /^[0-9a-f-]{36}$/i.test(id ?? '') && Number(n) > 0)
    .map(([id, n]) => ({ batch_id: id!, quantity: Math.min(10, Math.floor(Number(n))) }));
}

function Checkout() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, user, authReady } = useApp();
  const slug = params.get('evento') ?? '';
  const items = useMemo(() => parseItems(params.get('itens')), [params]);

  const [step, setStep] = useState<Step>('dados');
  const [buyer, setBuyer] = useState<BuyerInfo>({ name: '', cpf: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payBusy, setPayBusy] = useState<'pix' | 'card' | null>(null);
  const [order, setOrder] = useState<ReserveResponse | null>(null);
  const [options, setOptions] = useState<PaymentOptions>({ environment: 'sandbox', card_available: false });
  const [pix, setPix] = useState<PixInfo | null>(null);
  const [paid, setPaid] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (authReady && !user) router.replace(`/entrar?next=${encodeURIComponent(`/checkout?${params.toString()}`)}`);
  }, [authReady, user, router, params]);

  useEffect(() => {
    if (!user) return;
    ticketService
      .sessionContact()
      .then((c) => setBuyer((b) => ({ ...b, name: b.name || user.full_name, email: b.email || c.email, phone: b.phone || formatPhone(c.phone.replace(/^\+?55/, '')) })))
      .catch(() => {});
  }, [user]);

  // Relógio da reserva.
  useEffect(() => {
    if (!order) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [order]);

  // Acompanha o pedido até o pagamento ser confirmado (a cada ~4 s).
  useEffect(() => {
    if (step !== 'pagamento' || !order || !pix || paid) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const s = await checkoutApi.status(order.order_id);
        if (stop) return;
        if (s.order.status === 'paid') {
          setPaid(true);
          setTimeout(() => router.push(`/pedido/${order.order_id}`), 2000);
        } else if (['expired', 'cancelled', 'refunded', 'charged_back'].includes(s.order.status)) {
          router.push(`/pedido/${order.order_id}`);
        } else if (s.payment?.pix) {
          setPix(s.payment.pix);
        }
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [step, order, pix, paid, router]);

  const pay = useCallback(
    async (orderId: string, method: 'pix' | 'card') => {
      setPayError(null);
      setPayBusy(method);
      try {
        const r = await checkoutApi.pay(orderId, method);
        setOptions({ environment: r.environment, card_available: r.card_available });
        if (r.order_status === 'paid') {
          setPaid(true);
          router.push(`/pedido/${orderId}`);
          return;
        }
        if (method === 'card') {
          if (r.checkout_url) {
            window.location.assign(r.checkout_url);
            return; // mantém o botão ocupado durante o redirecionamento
          }
          setPayError('Não foi possível abrir o pagamento com cartão. Tente o Pix.');
        } else if (r.pix) {
          setPix(r.pix);
        } else {
          setPayError('Não foi possível gerar o Pix. Tente novamente.');
        }
      } catch (err) {
        setPayError(err instanceof ApiError ? err.message : 'Não foi possível gerar o pagamento. Tente novamente.');
      }
      setPayBusy(null);
    },
    [router],
  );

  const { data: base, error: loadError } = useAsync(async () => {
    if (!slug) return null;
    const event = await data.getEvent(slug);
    if (!event) return null;
    const batches = await ticketService.batches(event.id);
    return { event, batches };
  }, [data, slug]);

  const lines = useMemo(() => {
    if (!base) return [];
    return items
      .map((i) => ({ ...i, batch: base.batches.find((b) => b.batch_id === i.batch_id) }))
      .filter((l) => l.batch);
  }, [base, items]);
  const subtotal = lines.reduce((s, l) => s + l.quantity * (l.batch!.price ?? 0), 0);

  if (!authReady || !user || (!base && !loadError)) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!base || !lines.length)
    return <div className="container-site py-24"><EmptyState title="Nada para pagar" text="Escolha os ingressos na página do evento." action={{ href: slug ? `/eventos/${slug}` : '/eventos', label: 'Voltar ao evento' }} /></div>;

  const { event } = base;
  const d = formatEventDate(event.event_date);
  const remaining = order ? Math.max(0, new Date(order.expires_at).getTime() - now) : 0;
  const expired = order !== null && remaining === 0 && !paid;

  const reserve = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isFullName(buyer.name)) return setError('Informe o nome completo.');
    if (!isValidCpf(buyer.cpf)) return setError('CPF inválido.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyer.email.trim())) return setError('E-mail inválido.');
    if (!isValidPhone(buyer.phone)) return setError('Celular inválido (DDD + número).');
    setBusy(true);
    try {
      const r = await checkoutApi.reserve(event.id, items, { ...buyer, cpf: onlyDigits(buyer.cpf), phone: onlyDigits(buyer.phone), email: buyer.email.trim() });
      setOrder(r);
      if (r.payment) setOptions(r.payment);
      setNow(Date.now());
      setStep('pagamento');
      void pay(r.order_id, 'pix'); // Pix é o meio padrão: gera o QR na hora
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reservar.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (order) await checkoutApi.cancel(order.order_id).catch(() => {});
    router.push(`/eventos/${event.slug}`);
  };

  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');

  return (
    <section className="container-site py-12 sm:py-16">
      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[48px]">Finalizar compra</h1>
      <ol className="mt-8 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-nav">
        {(['Ingressos', 'Seus dados', 'Pagamento', 'Confirmação'] as const).map((label, i) => {
          const idx = step === 'dados' ? 1 : paid ? 3 : 2;
          return (
            <li key={label} className={clsx('flex items-center gap-2 rounded-full border px-4 py-2', i < idx ? 'border-line text-mute' : i === idx ? 'border-red-bright text-red-bright' : 'border-line text-mute/60')}>
              {i < idx ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>} {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <div>
          {order && !paid && (
            <div className={clsx('mb-6 flex items-center gap-3 rounded-card border px-4 py-3 text-[13px]', expired ? 'border-red-bright bg-red-soft' : 'border-line bg-panel')} role="timer" aria-live="polite">
              <Clock className="h-4 w-4 text-red-bright" />
              {expired ? 'Sua reserva expirou e os ingressos foram liberados.' : <>Ingressos reservados por <strong className="font-display">{mm}:{ss}</strong></>}
            </div>
          )}

          {step === 'dados' && (
            <form onSubmit={reserve} className="card grid gap-4 p-6 sm:grid-cols-2 sm:p-8" noValidate>
              <p className="eyebrow sm:col-span-2">Dados do comprador</p>
              <label className="sm:col-span-2"><span className="field-label">Nome completo</span><input className="field" autoComplete="name" required value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></label>
              <label><span className="field-label">CPF</span><input className="field" inputMode="numeric" autoComplete="off" required value={formatCpf(buyer.cpf)} onChange={(e) => setBuyer({ ...buyer, cpf: onlyDigits(e.target.value).slice(0, 11) })} placeholder="000.000.000-00" /></label>
              <label><span className="field-label">Celular</span><input className="field" inputMode="tel" autoComplete="tel-national" required value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: formatPhone(e.target.value) })} placeholder="(21) 99999-9999" /></label>
              <label className="sm:col-span-2"><span className="field-label">E-mail (receberá os ingressos)</span><input className="field" type="email" autoComplete="email" required value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></label>
              <p className="text-[11px] text-mute sm:col-span-2">Os ingressos são nominais ao comprador. Seus dados são compartilhados apenas com o produtor da festa para controle de acesso, conforme a <Link href="/privacidade">política de privacidade</Link>.</p>
              <div className="sm:col-span-2"><FieldError message={error} /></div>
              <div className="flex flex-wrap justify-between gap-3 sm:col-span-2">
                <Link href={`/eventos/${event.slug}`} className="btn-ghost">Voltar</Link>
                <button disabled={busy} className="btn-primary"><Lock className="h-4 w-4" /> {busy ? 'Reservando…' : 'Reservar e pagar'}</button>
              </div>
            </form>
          )}

          {step === 'pagamento' && order && (
            <div className="flex flex-col gap-4">
              {expired && !pix ? (
                <div className="card p-6">
                  <p className="text-sm text-mute">Volte ao evento e escolha os ingressos novamente.</p>
                  <Link href={`/eventos/${event.slug}`} className="btn-primary mt-5">Escolher de novo</Link>
                </div>
              ) : (
                <>
                  <PixPayment
                    pix={pix}
                    paid={paid}
                    cardAvailable={options.card_available}
                    sandbox={options.environment === 'sandbox'}
                    busy={payBusy}
                    error={payError}
                    onCreatePix={() => void pay(order.order_id, 'pix')}
                    onCard={() => void pay(order.order_id, 'card')}
                  />
                  {!pix && !paid && <button onClick={cancel} className="btn-ghost btn-sm self-start">Cancelar reserva</button>}
                  {pix && !paid && <Link href={`/pedido/${order.order_id}`} className="link-arrow">Acompanhar pedido</Link>}
                </>
              )}
            </div>
          )}
        </div>

        <aside>
          <div className="card sticky top-24 overflow-hidden">
            <div className="border-b border-line p-6">
              <p className="eyebrow">{d.full} · {event.start_time}</p>
              <p className="mt-2 font-display text-[20px] font-extrabold uppercase leading-tight tracking-tight">{event.name}</p>
              <p className="mt-1 text-[12px] text-mute">{event.venue.name} · {event.city ?? event.venue.city}</p>
            </div>
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.batch_id} className="flex items-center justify-between gap-4 px-6 py-4 text-[13px]">
                  <span>{l.quantity}× {TICKET_TYPE_LABEL[l.batch!.ticket_type]} · {l.batch!.name}</span>
                  <span className="font-semibold">{brlCents(l.quantity * (l.batch!.price ?? 0))}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-6 py-5">
              <span className="eyebrow">Total</span>
              <span className="font-display text-[26px] font-extrabold text-red-bright">{brlCents(order ? Number(order.total) : subtotal)}</span>
            </div>
            {order && options.environment === 'sandbox' && (
              <p className="border-t border-line px-6 py-3 text-[11px] text-mute">Ambiente de teste: nenhuma cobrança real é feita.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
