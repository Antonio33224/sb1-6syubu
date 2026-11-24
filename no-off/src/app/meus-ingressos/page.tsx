'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import QRCode from 'qrcode';
import { Maximize2, Ticket } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { Modal, Tabs } from '@/components/ui/Controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatEventDate } from '@/lib/format';
import { ticketService, ticketsAvailable, type MyTicket } from '@/services/ticket-service';
import { ORDER_STATUS_LABEL, TICKET_TYPE_LABEL } from '@/types';

const today = () => new Date().toISOString().slice(0, 10);

export default function MeusIngressosPage() {
  const { user, authReady } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<'proximos' | 'passados' | 'pedidos'>('proximos');
  const [open, setOpen] = useState<MyTicket | null>(null);

  useEffect(() => {
    if (authReady && !user) router.replace('/entrar?next=/meus-ingressos');
  }, [authReady, user, router]);

  const enabled = ticketsAvailable();
  const { data, error, reload } = useAsync(async () => {
    if (!user || !enabled) return null;
    const [tickets, orders] = await Promise.all([ticketService.myTickets(), ticketService.myOrders()]);
    return { tickets, orders };
  }, [user?.id, enabled]);

  const list = useMemo(() => {
    if (!data) return [];
    const t = today();
    return data.tickets.filter((x) => (tab === 'passados' ? (x.event?.event_date ?? '') < t : (x.event?.event_date ?? t) >= t));
  }, [data, tab]);

  if (!enabled)
    return <div className="container-site py-24"><EmptyState title="Indisponível no modo demonstração" text="Os ingressos exigem o Supabase configurado." action={{ href: '/eventos', label: 'Ver a agenda' }} /></div>;
  if (!authReady || !user) return <div className="container-site py-16"><Skeleton className="h-80" /></div>;

  return (
    <section className="container-site py-12 sm:py-16">
      <p className="eyebrow">Sua conta</p>
      <h1 className="mt-3 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[52px]">Meus ingressos</h1>
      <Tabs className="mt-8" value={tab} onChange={setTab} items={[{ value: 'proximos', label: 'Próximos' }, { value: 'passados', label: 'Passados' }, { value: 'pedidos', label: 'Pedidos' }]} />
      <div className="mt-8">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <div className="grid gap-5 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : tab === 'pedidos' ? (
          data.orders.length === 0 ? (
            <EmptyState title="Nenhum pedido" text="Seus pedidos aparecem aqui." action={{ href: '/eventos', label: 'Ver a agenda' }} />
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line">
              {data.orders.filter((o) => o.status !== 'cancelled' || o.mp_payment_id).map((o) => (
                <li key={o.id}>
                  <Link href={`/pedido/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-panel">
                    <div>
                      <p className="font-semibold">{o.event?.name ?? 'Evento'}</p>
                      <p className="text-[12px] text-mute">{new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {o.items.reduce((s, i) => s + i.quantity, 0)} ingresso(s)</p>
                    </div>
                    <div className="text-right">
                      <p className={clsx('text-[10px] font-bold uppercase tracking-nav', o.status === 'paid' ? 'text-red-bright' : 'text-mute')}>{ORDER_STATUS_LABEL[o.status]}</p>
                      <p className="font-display font-bold">{brlCents(o.total)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : list.length === 0 ? (
          <EmptyState title={tab === 'passados' ? 'Nenhum ingresso passado' : 'Nenhum ingresso por aqui'} text="Quando você comprar, os ingressos aparecem aqui com o QR Code." action={{ href: '/eventos', label: 'Comprar ingressos' }} />
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {list.map((t) => <TicketCard key={t.id} t={t} onOpen={() => setOpen(t)} />)}
          </div>
        )}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Apresente na portaria">
        {open && (
          <div className="flex flex-col items-center gap-4 text-center">
            <QrImage code={open.code} size={300} />
            <p className="font-display text-lg font-bold uppercase">{open.holder_name}</p>
            <p className="font-mono text-[12px] text-mute">{open.code}</p>
            <p className="text-[12px] text-mute">Aumente o brilho da tela. Cada QR vale uma entrada.</p>
          </div>
        )}
      </Modal>
    </section>
  );
}

function TicketCard({ t, onOpen }: { t: MyTicket; onOpen: () => void }) {
  const d = t.event ? formatEventDate(t.event.event_date) : null;
  const usable = t.status === 'valid';
  return (
    <article className={clsx('card flex gap-5 p-5', !usable && 'opacity-60')}>
      <button onClick={onOpen} disabled={!usable} className="relative shrink-0 rounded-card bg-white p-2" aria-label="Ampliar QR Code">
        <QrImage code={t.code} size={120} />
        {usable && <Maximize2 className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red p-1 text-bone" />}
      </button>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-nav text-red-bright">{t.batch ? `${TICKET_TYPE_LABEL[t.batch.ticket_type]} · ${t.batch.name}` : 'Ingresso'}</p>
        {t.event ? (
          <Link href={`/eventos/${t.event.slug}`} className="mt-2 block font-display text-[17px] font-bold uppercase leading-tight tracking-tight hover:text-red-bright">{t.event.name}</Link>
        ) : (
          <p className="mt-2 font-display text-[17px] font-bold uppercase">Evento</p>
        )}
        {d && t.event && <p className="mt-1 text-[12px] text-mute">{d.full} · {t.event.start_time}</p>}
        {t.event && <p className="text-[12px] text-mute">{t.event.venue.name} · {t.event.city ?? t.event.venue.city}</p>}
        <p className="mt-3 text-[12px]">{t.holder_name}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-nav text-mute">
          <Ticket className="mr-1 inline h-3 w-3" />
          {t.status === 'valid' ? 'Válido' : t.status === 'used' ? `Utilizado ${t.used_at ? new Date(t.used_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}` : 'Cancelado'}
        </p>
      </div>
    </article>
  );
}

function QrImage({ code, size }: { code: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc(null));
  }, [code, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={`QR Code ${code}`} width={size} height={size} /> : <div style={{ width: size, height: size }} className="animate-pulse bg-line" />;
}
