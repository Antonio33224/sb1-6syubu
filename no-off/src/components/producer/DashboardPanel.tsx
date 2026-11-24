'use client';
import { useEffect } from 'react';
import { clsx } from 'clsx';
import { RefreshCw } from 'lucide-react';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents } from '@/lib/format';
import { producerService } from '@/services/ticket-service';
import { BATCH_STATE_LABEL, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, TICKET_TYPE_LABEL } from '@/types';

/** Vendas em tempo real: atualiza a cada pedido (Realtime) e a cada 20 s (fallback). */
export function DashboardPanel({ eventId }: { eventId: string }) {
  const { data, error, reload, loading } = useAsync(() => producerService.dashboard(eventId), [eventId]);

  useEffect(() => {
    const unsub = producerService.subscribeOrders(eventId, () => void reload());
    const t = setInterval(() => void reload(), 20_000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [eventId, reload]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-96" />;

  const occupancy = data.capacity ? Math.min(100, Math.round((data.tickets_sold / data.capacity) * 100)) : null;
  const net = data.gross - data.fees;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-nav text-mute">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red" /></span>
          Ao vivo
        </p>
        <button onClick={() => void reload()} className="btn-ghost btn-sm"><RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} /> Atualizar</button>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
        <Kpi label="Ingressos vendidos" value={String(data.tickets_sold)} hint={data.tickets_reserved ? `+${data.tickets_reserved} em checkout` : undefined} />
        <Kpi label="Faturamento bruto" value={brlCents(data.gross)} hint={`${data.orders_paid} pedidos pagos`} />
        <Kpi label="Líquido (após taxas)" value={brlCents(net)} hint={`Taxas ${brlCents(data.fees)}`} />
        <Kpi label="Ocupação" value={occupancy === null ? '—' : `${occupancy}%`} hint={data.capacity ? `${data.tickets_sold}/${data.capacity}` : 'Defina a capacidade nos dados da festa'} />
      </div>
      {occupancy !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={occupancy} aria-valuemin={0} aria-valuemax={100} aria-label="Ocupação">
          <div className="h-full bg-red transition-all duration-700" style={{ width: `${occupancy}%` }} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
        <Kpi label="Check-ins (ingressos)" value={String(data.checked_in)} small />
        <Kpi label="Lista VIP aprovada" value={String(data.vip_total)} small />
        <Kpi label="VIP presentes" value={String(data.vip_present)} small />
        <Kpi label="VIP aguardando aprovação" value={String(data.vip_pending)} small />
      </div>

      <div>
        <p className="eyebrow mb-4">Por lote</p>
        <div className="flex flex-col gap-3">
          {data.batches.map((b) => {
            const pct = Math.round(((b.sold + b.reserved) / b.quantity) * 100);
            return (
              <div key={b.batch_id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold">{TICKET_TYPE_LABEL[b.ticket_type]} · {b.name} <span className="ml-2 text-mute">{brlCents(Number(b.price))}</span></span>
                  <span className={clsx('text-[10px] font-bold uppercase tracking-nav', b.state === 'on_sale' ? 'text-red-bright' : 'text-mute')}>{BATCH_STATE_LABEL[b.state]}</span>
                </div>
                <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="bg-red" style={{ width: `${(b.sold / b.quantity) * 100}%` }} />
                  <div className="bg-red/40" style={{ width: `${(b.reserved / b.quantity) * 100}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-mute">{b.sold} vendidos{b.reserved ? ` · ${b.reserved} reservados` : ''} · {b.available} disponíveis · {pct}%</p>
              </div>
            );
          })}
          {!data.batches.length && <p className="text-sm text-mute">Nenhum lote criado.</p>}
        </div>
      </div>

      <div>
        <p className="eyebrow mb-4">Últimos pedidos</p>
        {data.recent_orders.length === 0 ? (
          <p className="text-sm text-mute">Nenhum pedido ainda.</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line">
            {data.recent_orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-[13px]">
                <span>{o.buyer_name} <span className="ml-2 text-[11px] text-mute">{new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></span>
                <span className="flex items-center gap-4">
                  <span className="text-[11px] text-mute">{o.payment_method ? PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method : ''}</span>
                  <span className={clsx('text-[10px] font-bold uppercase tracking-nav', o.status === 'paid' ? 'text-red-bright' : 'text-mute')}>{ORDER_STATUS_LABEL[o.status]}</span>
                  <span className="font-semibold">{brlCents(Number(o.total))}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, small }: { label: string; value: string; hint?: string; small?: boolean }) {
  return (
    <div className="bg-ink p-5 sm:p-6">
      <p className={clsx('font-display font-extrabold leading-none', small ? 'text-[24px]' : 'text-[28px] sm:text-[34px]')}>{value}</p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
      {hint && <p className="mt-1 text-[11px] text-mute">{hint}</p>}
    </div>
  );
}
