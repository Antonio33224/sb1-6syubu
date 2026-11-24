import { clsx } from 'clsx';
import { Beer, Ticket, Wallet } from 'lucide-react';
import { brl, hasAvgPrice, priceBreakdown } from '@/lib/pricing';
import { priceLabel } from '@/lib/format';
import type { Venue } from '@/types';

const ROW_ICON = { entry: Ticket, drinks: Beer, spend: Wallet } as const;

/**
 * Selo compacto de média de preço para cards.
 * Sem valor cadastrado, mostra a faixa R$–R$$$$ e "preço não informado" — nunca um número inventado.
 */
export function PriceTag({ venue, className, tone = 'solid' }: { venue: Venue; className?: string; tone?: 'solid' | 'glass' }) {
  const has = hasAvgPrice(venue);
  return (
    <div
      className={clsx(
        'inline-flex flex-col rounded-[4px] border px-3 py-2 leading-none',
        tone === 'glass' ? 'border-red/35 bg-ink/70 backdrop-blur-md' : 'border-red/30 bg-red-soft',
        className,
      )}
      title={has ? `Média estimada por pessoa${venue.is_demo ? ' (valor demonstrativo)' : ''}` : 'Média de preço ainda não informada'}
    >
      <span className="text-[8px] font-bold uppercase tracking-nav text-red-bright/90">Média</span>
      {has ? (
        <span className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-[19px] font-extrabold tracking-tight text-red-bright">{brl(venue.avg_price)}</span>
          <span className="text-[9px] font-semibold uppercase tracking-nav text-bone/60">/pessoa</span>
        </span>
      ) : (
        <span className="mt-1 flex items-baseline gap-1.5">
          <span className="font-display text-[15px] font-bold tracking-tight text-bone/80">{priceLabel(venue.price_range)}</span>
          <span className="text-[9px] font-semibold uppercase tracking-nav text-mute">não informado</span>
        </span>
      )}
    </div>
  );
}

/** Painel de destaque para a página da boate: valor principal grande + faixas. */
export function PricePanel({ venue, className }: { venue: Venue; className?: string }) {
  const has = hasAvgPrice(venue);
  const rows = priceBreakdown(venue);
  return (
    <section
      aria-label="Média de preços"
      className={clsx('relative overflow-hidden rounded-card border border-red/30 bg-gradient-to-br from-red/[0.14] via-panel to-panel', className)}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-red/20 blur-3xl" />
      <div className="relative p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wide2 text-red-bright">Média de preços</p>
          {venue.is_demo && (has || rows.length > 0) && (
            <span className="rounded-sm border border-line px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-nav text-mute" title="Valores fictícios de demonstração">
              Valor demonstrativo
            </span>
          )}
        </div>

        {has ? (
          <div className="mt-4">
            <p className="font-display text-[56px] font-extrabold leading-[0.9] tracking-[-0.03em] text-red-bright sm:text-[68px]">{brl(venue.avg_price)}</p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-nav text-bone/70">Por pessoa · estimativa</p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="font-display text-[34px] font-extrabold leading-none tracking-tight text-bone/85">{priceLabel(venue.price_range)}</p>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-mute">
              A média de preços desta casa ainda não foi informada. Exibimos apenas a faixa de preço geral.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <dl className="mt-7 divide-y divide-line border-t border-line">
            {rows.map((r) => {
              const Icon = ROW_ICON[r.key];
              return (
                <div key={r.key} className="flex items-center justify-between gap-4 py-3.5">
                  <dt className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-nav text-mute">
                    <Icon className="h-3.5 w-3.5 text-red-bright/80" strokeWidth={2} /> {r.label}
                  </dt>
                  <dd className="font-display text-[15px] font-bold tracking-tight text-bone">{r.value}</dd>
                </div>
              );
            })}
          </dl>
        )}
        <p className="mt-5 text-[10px] leading-relaxed text-mute/80">
          Valores de referência informados pela curadoria NO OFF. Podem variar por data, evento e lote.
        </p>
      </div>
    </section>
  );
}
