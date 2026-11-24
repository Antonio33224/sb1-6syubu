'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { Minus, Plus, ShieldCheck, Ticket } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatDate } from '@/lib/format';
import { HIDDEN_TEXT } from '@/lib/public-events';
import { ticketService } from '@/services/ticket-service';
import { BATCH_STATE_LABEL, TICKET_TYPE_LABEL, type EventWithVenue, type PublicBatch, type TicketType } from '@/types';

const TYPE_ORDER: TicketType[] = ['pista', 'meia', 'vip', 'camarote', 'outro'];
const MAX_PER_ORDER = 10;

/** Escolha de lote e quantidade. Preços/estoque vêm do banco (mascarados se ocultos). */
export function TicketSelector({ event }: { event: EventWithVenue }) {
  const { user } = useApp();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const { data: batches, error } = useAsync(() => ticketService.batches(event.id), [event.id]);

  const groups = useMemo(() => {
    const by = new Map<TicketType, PublicBatch[]>();
    for (const b of batches ?? []) by.set(b.ticket_type, [...(by.get(b.ticket_type) ?? []), b]);
    return TYPE_ORDER.filter((t) => by.has(t)).map((t) => ({ type: t, batches: by.get(t)! }));
  }, [batches]);

  const total = (batches ?? []).reduce((s, b) => s + (qty[b.batch_id] ?? 0) * (b.price ?? 0), 0);
  const count = Object.values(qty).reduce((s, n) => s + n, 0);
  const locked = (batches ?? []).some((b) => b.sales_locked);

  const change = (b: PublicBatch, delta: number) => {
    setQty((q) => {
      const cur = q[b.batch_id] ?? 0;
      const others = count - cur;
      const limit = Math.min(b.max_per_order, b.available ?? b.max_per_order, MAX_PER_ORDER - others);
      const next = Math.max(0, Math.min(limit, cur + delta));
      return { ...q, [b.batch_id]: next };
    });
  };

  const proceed = () => {
    const items = Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).join(',');
    const target = `/checkout?evento=${encodeURIComponent(event.slug)}&itens=${encodeURIComponent(items)}`;
    router.push(user ? target : `/entrar?next=${encodeURIComponent(target)}`);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
      <div>
        <p className="eyebrow text-red-bright">Ingressos</p>
        <h2 className="section-title mt-3">Escolha seu lote</h2>
        {error ? (
          <p className="mt-6 text-sm text-mute">Não foi possível carregar os lotes agora.</p>
        ) : !batches ? (
          <div className="mt-8 flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : groups.length === 0 ? (
          <p className="mt-6 text-sm text-mute">Nenhum lote disponível no momento.</p>
        ) : (
          <div className="mt-8 flex flex-col gap-8">
            {locked && event.hidden?.price && (
              <p className="rounded-card border border-red/40 bg-red-soft px-4 py-3 text-[13px]">Preços revelados em breve — as vendas abrem quando os valores forem divulgados.</p>
            )}
            {groups.map((g) => (
              <div key={g.type}>
                <p className="mb-3 text-[10px] font-extrabold uppercase tracking-wide2 text-mute">{TICKET_TYPE_LABEL[g.type]}</p>
                <ul className="flex flex-col gap-3">
                  {g.batches.map((b) => {
                    const onSale = b.state === 'on_sale' && !b.sales_locked;
                    const n = qty[b.batch_id] ?? 0;
                    return (
                      <li key={b.batch_id} className={clsx('card flex flex-wrap items-center justify-between gap-4 p-5', !onSale && 'opacity-60')}>
                        <div className="min-w-0">
                          <p className="font-display text-[16px] font-bold uppercase tracking-tight">{b.name}</p>
                          <p className="mt-1 text-[12px] text-mute">
                            {onSale ? (
                              <>
                                {b.available !== null && b.available <= 20 ? <span className="text-red-bright">Últimos {b.available}</span> : 'À venda'}
                                {b.sales_end && <> · até {formatDate(b.sales_end)} {new Date(b.sales_end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
                              </>
                            ) : b.state === 'upcoming' && b.sales_start ? (
                              <>Vendas a partir de {formatDate(b.sales_start)} {new Date(b.sales_start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                            ) : (
                              BATCH_STATE_LABEL[b.state]
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-5">
                          <p className="font-display text-[20px] font-extrabold text-red-bright">{b.price === null ? HIDDEN_TEXT.price : brlCents(b.price)}</p>
                          {onSale && (
                            <div className="flex items-center gap-2" role="group" aria-label={`Quantidade — ${b.name}`}>
                              <button type="button" onClick={() => change(b, -1)} disabled={!n} className="flex h-9 w-9 items-center justify-center rounded-full border border-line hover:border-bone disabled:opacity-30" aria-label="Diminuir"><Minus className="h-3.5 w-3.5" /></button>
                              <span className="w-6 text-center font-display text-lg font-bold" aria-live="polite">{n}</span>
                              <button type="button" onClick={() => change(b, 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-line hover:border-bone" aria-label="Aumentar"><Plus className="h-3.5 w-3.5" /></button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="lg:pt-14">
        <div className="accent-frame sticky top-24 p-6 sm:p-7">
          <p className="eyebrow">Resumo</p>
          <p className="mt-4 font-display text-[40px] font-extrabold leading-none">{brlCents(total)}</p>
          <p className="mt-2 text-[12px] text-mute">{count ? `${count} ${count === 1 ? 'ingresso' : 'ingressos'}` : 'Selecione ao menos um ingresso'} · máx. {MAX_PER_ORDER} por pedido</p>
          <button onClick={proceed} disabled={!count} className="btn-primary mt-6 w-full"><Ticket className="h-4 w-4" /> Continuar</button>
          <ul className="mt-6 flex flex-col gap-2 text-[11px] text-mute">
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-bright" /> Pagamento pelo Mercado Pago: Pix, cartão de crédito (parcelado) ou boleto.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-bright" /> Seus ingressos ficam reservados por 10 minutos durante o pagamento.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-bright" /> QR Code único, enviado por e-mail e em Meus ingressos.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
