'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Ticket, XCircle } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { PixPayment } from '@/components/tickets/PixPayment';
import { brlCents, formatEventDate } from '@/lib/format';
import { ApiError, checkoutApi, type OrderStatusResponse } from '@/services/api-client';
import { ticketService, type MyOrder } from '@/services/ticket-service';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from '@/types';

/** Intervalo do acompanhamento do status (o servidor também reconcilia com o PurinCash). */
const POLL_MS = 4000;

export default function PedidoPage() {
  return (
    <Suspense fallback={<div className="container-site py-16"><Skeleton className="h-80" /></div>}>
      <Pedido />
    </Suspense>
  );
}

/** Confirmação do pedido: acompanha o status até o pagamento ser confirmado (webhook ou reconciliação). */
function Pedido() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { user, authReady } = useApp();
  const router = useRouter();
  const [order, setOrder] = useState<MyOrder | null | undefined>(undefined);
  const [tickets, setTickets] = useState(0);
  const [payment, setPayment] = useState<OrderStatusResponse['payment']>(null);
  const [payBusy, setPayBusy] = useState<'pix' | 'card' | null>(null);
  const [payError, setPayError] = useState<string | null>(search.get('cartao') === 'cancelado' ? 'O pagamento com cartão não foi concluído. Tente de novo ou pague com Pix.' : null);

  useEffect(() => {
    if (authReady && !user) router.replace(`/entrar?next=/pedido/${id}`);
  }, [authReady, user, router, id]);

  useEffect(() => {
    if (!user) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await checkoutApi.status(id); // também reconcilia com o PurinCash
        const full = await ticketService.getOrder(id);
        if (stop) return;
        setOrder(full);
        setTickets(s.tickets);
        setPayment(s.payment);
        if (s.order.status === 'pending') timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!stop) setOrder(null);
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [user, id]);

  const pay = async (method: 'pix' | 'card') => {
    setPayError(null);
    setPayBusy(method);
    try {
      const r = await checkoutApi.pay(id, method);
      if (method === 'card' && r.checkout_url) {
        window.location.assign(r.checkout_url);
        return;
      }
      if (r.pix) setPayment((p) => ({ environment: r.environment, card_available: r.card_available, ...(p ?? {}), pix: r.pix }));
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Não foi possível gerar o pagamento.');
    }
    setPayBusy(null);
  };

  if (order === undefined) return <div className="container-site py-16"><Skeleton className="h-80" /></div>;
  if (order === null) return <div className="container-site py-24"><EmptyState title="Pedido não encontrado" action={{ href: '/meus-ingressos', label: 'Meus ingressos' }} /></div>;

  const paid = order.status === 'paid';
  const pending = order.status === 'pending';
  const reservationOpen = pending && new Date(order.expires_at).getTime() > Date.now();
  const d = order.event ? formatEventDate(order.event.event_date) : null;

  return (
    <section className="container-site max-w-3xl py-14 sm:py-20">
      <div className="flex items-center gap-3">
        {paid ? <CheckCircle2 className="h-7 w-7 text-red-bright" /> : pending ? <Clock className="h-7 w-7 text-mute" /> : <XCircle className="h-7 w-7 text-mute" />}
        <p className="eyebrow">{ORDER_STATUS_LABEL[order.status]}</p>
      </div>
      <h1 className="mt-5 font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[52px]">
        {paid ? 'Compra confirmada.' : pending ? 'Aguardando o pagamento.' : 'Pedido não concluído.'}
      </h1>
      <p className="mt-5 max-w-xl text-[15px] text-mute">
        {paid
          ? `Emitimos ${tickets} ${tickets === 1 ? 'ingresso' : 'ingressos'} com QR Code único. Enviamos por e-mail para ${order.buyer_email} e eles já estão em Meus ingressos.`
          : pending
            ? 'Assim que o pagamento for confirmado, seus ingressos são emitidos automaticamente. Esta página atualiza sozinha.'
            : order.status === 'expired'
              ? 'A reserva expirou antes da confirmação do pagamento e os ingressos foram liberados.'
              : order.status === 'refunded' || order.status === 'charged_back'
                ? 'O pagamento foi estornado e os ingressos deste pedido foram cancelados.'
                : 'Este pedido foi cancelado. Nenhuma cobrança foi confirmada.'}
      </p>

      {reservationOpen && payment && (
        <div className="mt-10">
          <PixPayment
            pix={payment.pix}
            paid={false}
            cardAvailable={payment.card_available}
            sandbox={payment.environment === 'sandbox'}
            busy={payBusy}
            error={payError}
            onCreatePix={() => void pay('pix')}
            onCard={() => void pay('card')}
          />
        </div>
      )}

      <div className="card mt-10 divide-y divide-line">
        {order.event && d && (
          <div className="p-6">
            <p className="eyebrow">{d.full} · {order.event.start_time}</p>
            <p className="mt-2 font-display text-[20px] font-extrabold uppercase tracking-tight">{order.event.name}</p>
            <p className="mt-1 text-[12px] text-mute">{order.event.venue.name} · {order.event.city ?? order.event.venue.city}</p>
          </div>
        )}
        <ul className="p-6 text-[13px]">
          {order.items.map((it, i) => (
            <li key={i} className="flex justify-between py-1"><span>{it.quantity}× {it.batch?.name ?? 'Ingresso'}</span><span>{brlCents(it.quantity * Number(it.unit_price))}</span></li>
          ))}
        </ul>
        <div className="flex items-center justify-between p-6">
          <span className="text-[12px] text-mute">{order.payment_method ? PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method : 'Pagamento'}{order.installments && order.installments > 1 ? ` · ${order.installments}x` : ''}</span>
          <span className="font-display text-[22px] font-extrabold text-red-bright">{brlCents(order.total)}</span>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {paid && <Link href="/meus-ingressos" className="btn-primary"><Ticket className="h-4 w-4" /> Ver meus ingressos</Link>}
        {!paid && !reservationOpen && order.event && <Link href={`/eventos/${order.event.slug}`} className="btn-primary">Tentar de novo</Link>}
        <Link href="/eventos" className="btn-ghost">Agenda</Link>
      </div>
      <p className="mt-8 text-[11px] text-mute">Pedido {order.id}</p>
    </section>
  );
}
