'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { Check, Clock, Copy, ExternalLink, Lock } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { PaymentBrick } from '@/components/tickets/PaymentBrick';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatEventDate } from '@/lib/format';
import { formatCpf, formatPhone, isFullName, isValidCpf, isValidPhone, onlyDigits } from '@/lib/cpf';
import { ApiError, checkoutApi, type PayResponse, type ReserveResponse } from '@/services/api-client';
import { ticketService, ticketsAvailable } from '@/services/ticket-service';
import { TICKET_TYPE_LABEL, type BuyerInfo } from '@/types';

export default function CheckoutPage() {
  return (
    <Suspense fallback={<div className="container-site py-16"><Skeleton className="h-96" /></div>}>
      <Checkout />
    </Suspense>
  );
}

type Step = 'dados' | 'pagamento' | 'aguardando';

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
  const toast = useToast();
  const { data, user, authReady } = useApp();
  const slug = params.get('evento') ?? '';
  const items = useMemo(() => parseItems(params.get('itens')), [params]);

  const [step, setStep] = useState<Step>('dados');
  const [buyer, setBuyer] = useState<BuyerInfo>({ name: '', cpf: '', email: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<ReserveResponse | null>(null);
  const [pending, setPending] = useState<PayResponse | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (authReady && !user) router.replace(`/entrar?next=${encodeURIComponent(`/checkout?${params.toString()}`)}`);
  }, [authReady, user, router, params]);

  useEffect(() => {
    if (!user || !ticketsAvailable()) return;
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

  // Pix/boleto: acompanha o pedido até o pagamento ser confirmado (webhook ou reconciliação).
  useEffect(() => {
    if (step !== 'aguardando' || !order) return;
    const t = setInterval(async () => {
      try {
        const s = await checkoutApi.status(order.order_id);
        if (s.order.status === 'paid') router.push(`/pedido/${order.order_id}`);
        if (['expired', 'cancelled', 'refunded'].includes(s.order.status)) router.push(`/pedido/${order.order_id}`);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [step, order, router]);

  const { data: base, error: loadError } = useAsync(async () => {
    if (!slug || !ticketsAvailable()) return null;
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

  if (!ticketsAvailable())
    return <div className="container-site py-24"><EmptyState title="Compra indisponível" text="A venda de ingressos exige o Supabase e o Mercado Pago configurados." action={{ href: '/eventos', label: 'Ver a agenda' }} /></div>;
  if (!authReady || !user || (!base && !loadError)) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!base || !lines.length)
    return <div className="container-site py-24"><EmptyState title="Nada para pagar" text="Escolha os ingressos na página do evento." action={{ href: slug ? `/eventos/${slug}` : '/eventos', label: 'Voltar ao evento' }} /></div>;

  const { event } = base;
  const d = formatEventDate(event.event_date);
  const remaining = order ? Math.max(0, new Date(order.expires_at).getTime() - now) : 0;
  const expired = order !== null && remaining === 0 && step !== 'aguardando';

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
      setNow(Date.now());
      setStep('pagamento');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível reservar.');
    } finally {
      setBusy(false);
    }
  };

  const pay = async (formData: Record<string, unknown>) => {
    if (!order) return;
    setError(null);
    try {
      const r = await checkoutApi.pay(order.order_id, formData);
      if (r.order_status === 'paid' || r.status === 'approved') {
        router.push(`/pedido/${order.order_id}`);
        return;
      }
      if (r.status === 'rejected') {
        setError('Pagamento recusado. Confira os dados do cartão ou escolha outro meio de pagamento.');
        throw new Error('rejected');
      }
      if (r.status === 'pending' || r.status === 'in_process') {
        setPending(r);
        setStep('aguardando');
        return;
      }
      setError('Não foi possível concluir o pagamento. Tente novamente.');
      throw new Error(r.status);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      throw err; // o Brick volta ao estado editável
    }
  };

  const cancel = async () => {
    if (order) await checkoutApi.cancel(order.order_id).catch(() => {});
    router.push(`/eventos/${event.slug}`);
  };

  const [first, ...rest] = buyer.name.trim().split(/\s+/);
  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');

  return (
    <section className="container-site py-12 sm:py-16">
      <p className="eyebrow">Checkout</p>
      <h1 className="mt-3 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[48px]">Finalizar compra</h1>
      <ol className="mt-8 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-nav">
        {(['Ingressos', 'Seus dados', 'Pagamento', 'Confirmação'] as const).map((label, i) => {
          const idx = step === 'dados' ? 1 : step === 'pagamento' ? 2 : 3;
          return (
            <li key={label} className={clsx('flex items-center gap-2 rounded-full border px-4 py-2', i < idx ? 'border-line text-mute' : i === idx ? 'border-red-bright text-red-bright' : 'border-line text-mute/60')}>
              {i < idx ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>} {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <div>
          {order && step !== 'aguardando' && (
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
              {expired ? (
                <div className="card p-6">
                  <p className="text-sm text-mute">Volte ao evento e escolha os ingressos novamente.</p>
                  <Link href={`/eventos/${event.slug}`} className="btn-primary mt-5">Escolher de novo</Link>
                </div>
              ) : (
                <>
                  <FieldError message={error} />
                  <PaymentBrick amount={Number(order.total)} payer={{ email: buyer.email.trim(), firstName: first ?? '', lastName: rest.join(' '), cpf: onlyDigits(buyer.cpf) }} onSubmit={pay} />
                  <button onClick={cancel} className="btn-ghost btn-sm self-start">Cancelar reserva</button>
                </>
              )}
            </div>
          )}

          {step === 'aguardando' && pending && order && (
            <div className="card flex flex-col gap-5 p-6 sm:p-8">
              <p className="eyebrow text-red-bright">Aguardando pagamento</p>
              {pending.pix ? (
                <>
                  <p className="text-sm text-bone/85">Pague com Pix pelo app do seu banco. A confirmação é automática e seus ingressos aparecem em seguida.</p>
                  {pending.pix.qr_code_base64 && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:image/png;base64,${pending.pix.qr_code_base64}`} alt="QR Code Pix" className="h-56 w-56 self-center rounded-card bg-white p-3" />
                  )}
                  <label><span className="field-label">Pix copia e cola</span><textarea readOnly className="field h-auto py-3 font-mono text-[11px]" rows={3} value={pending.pix.qr_code} /></label>
                  <button onClick={() => navigator.clipboard.writeText(pending.pix!.qr_code).then(() => toast('Código Pix copiado.'))} className="btn-outline self-start"><Copy className="h-4 w-4" /> Copiar código</button>
                  {pending.pix.expires_at && <p className="text-[12px] text-mute">Válido até {new Date(pending.pix.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>}
                </>
              ) : pending.boleto_url ? (
                <>
                  <p className="text-sm text-bone/85">Seu boleto foi gerado. Os ingressos ficam reservados até o vencimento e são emitidos quando o banco confirmar o pagamento (até 3 dias úteis).</p>
                  <a href={pending.boleto_url} target="_blank" rel="noopener noreferrer" className="btn-primary self-start"><ExternalLink className="h-4 w-4" /> Abrir boleto</a>
                </>
              ) : (
                <p className="text-sm text-bone/85">O pagamento está em análise pelo Mercado Pago. Você receberá os ingressos por e-mail assim que ele for aprovado.</p>
              )}
              <Link href={`/pedido/${order.order_id}`} className="link-arrow">Acompanhar pedido</Link>
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
            {process.env.NEXT_PUBLIC_MP_ENV !== 'production' && (
              <p className="border-t border-line px-6 py-3 text-[11px] text-mute">Ambiente de teste do Mercado Pago (sandbox): use os cartões de teste — nenhuma cobrança real é feita.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
