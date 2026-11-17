'use client';
import Link from 'next/link';
import { clsx } from 'clsx';
import { CalendarDays, Star } from 'lucide-react';
import type { VoiceCard } from '@/lib/voice/shared';
import { formatEventDate } from '@/lib/format';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0 });

/** Cartões clicáveis dos registros do banco citados pelo concierge. */
export function VoiceCards({ cards, compact = false, onNavigate }: { cards: VoiceCard[]; compact?: boolean; onNavigate?: () => void }) {
  if (!cards.length) return null;
  return (
    <ul className={clsx('flex gap-2', compact ? 'flex-col items-end' : 'snap-x overflow-x-auto pb-1')} aria-label="Resultados do Classify DJ">
      {cards.map((c) => (
        <li key={`${c.tipo}:${c.id}`} className={clsx('shrink-0 snap-start', compact ? 'w-[240px]' : 'w-[200px]')}>
          <Link
            href={c.url}
            onClick={onNavigate}
            className="block animate-fade-up rounded-card border border-line bg-panel/95 px-3.5 py-3 backdrop-blur transition-colors hover:border-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue"
          >
            <span className="block text-[9px] font-bold uppercase tracking-nav text-blue">
              {c.tipo === 'casa' ? 'Casa' : 'Evento'}
              {c.demo && <span className="ml-2 text-mute">· Exemplo</span>}
            </span>
            <span className="mt-1 block truncate font-display text-[14px] font-bold text-bone">{c.nome}</span>
            {c.subtitulo && <span className="block truncate text-[11px] text-mute">{c.subtitulo}</span>}
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-bone/80">
              {c.nota !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3 text-blue" aria-hidden />
                  {c.nota.toFixed(1)}
                  {c.num_reviews ? <span className="text-mute">({c.num_reviews})</span> : null}
                </span>
              )}
              {c.data && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3 text-blue" aria-hidden />
                  {formatEventDate(c.data).full}
                </span>
              )}
              <span>{c.preco !== null ? `a partir de ${brl(c.preco)}` : 'preço não informado'}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
