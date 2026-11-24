'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { Photo } from '@/components/ui/Photo';
import { CATEGORY_LABEL, formatEventDate } from '@/lib/format';
import type { EventItem, Venue } from '@/types';

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useApp();
  const [q, setQ] = useState('');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [events, setEvents] = useState<(EventItem & { venue: Venue })[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 30);
    Promise.all([data.listVenues(), data.listEvents({ upcomingOnly: true })]).then(([v, e]) => {
      setVenues(v);
      setEvents(e);
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, data, onClose]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return { venues: venues.slice(0, 5), events: events.slice(0, 3) };
    const match = (s: string) => s.toLowerCase().includes(term);
    return {
      venues: venues.filter((v) => match(`${v.name} ${v.city} ${v.neighborhood} ${v.music_styles.join(' ')}`)).slice(0, 8),
      events: events.filter((e) => match(`${e.name} ${e.dj_names.join(' ')} ${e.venue.name}`)).slice(0, 5),
    };
  }, [term, venues, events]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] animate-fade-in bg-ink/95 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Pesquisar">
      <div className="container-site flex h-full flex-col pt-6 sm:pt-10">
        <div className="flex items-center gap-4 border-b border-line pb-5">
          <Search className="h-6 w-6 shrink-0 text-mute" strokeWidth={1.6} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Boates, festas, festivais, DJs, cidades…"
            className="w-full bg-transparent font-display text-2xl font-bold tracking-tight text-bone placeholder:text-mute/50 focus:outline-none sm:text-4xl"
          />
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-mute hover:text-bone" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-10 overflow-y-auto py-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="eyebrow mb-4">{term ? 'Estabelecimentos' : 'Sugestões'}</p>
            {results.venues.length === 0 && <p className="text-sm text-mute">Nenhum resultado para “{q}”.</p>}
            <ul className="divide-y divide-line">
              {results.venues.map((v) => (
                <li key={v.id}>
                  <Link href={`/boates/${v.slug}`} onClick={onClose} className="group flex items-center gap-4 py-3">
                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-[3px]">
                      <Photo src={v.cover_image} alt={v.name} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-bold uppercase tracking-tight transition-colors group-hover:text-red-bright">{v.name}</p>
                      <p className="text-[11px] uppercase tracking-nav text-mute">
                        {CATEGORY_LABEL[v.category]} · {v.city}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-mute transition-transform group-hover:translate-x-1 group-hover:text-red-bright" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow mb-4">Próximos eventos</p>
            <ul className="divide-y divide-line">
              {results.events.map((e) => {
                const d = formatEventDate(e.event_date);
                return (
                  <li key={e.id}>
                    <Link href={`/eventos/${e.slug}`} onClick={onClose} className="group flex items-center gap-4 py-3">
                      <div className="w-12 shrink-0 text-center">
                        <p className="font-display text-xl font-bold leading-none">{d.day}</p>
                        <p className="text-[10px] font-semibold tracking-nav text-red-bright">{d.month}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold transition-colors group-hover:text-red-bright">{e.name}</p>
                        <p className="truncate text-[11px] text-mute">{e.venue.name} · {e.venue.city}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
