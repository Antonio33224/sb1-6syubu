'use client';
import Link from 'next/link';
import { useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { localIso } from '@/lib/week';
import { ticketService, ticketsAvailable } from '@/services/ticket-service';
import type { EventWithVenue } from '@/types';
import { BuyDisc, LotCountdown } from './BuyDisc';
import { HeroBackdrop } from './HeroBackdrop';
import { CityControl, HeroChapters, type CityControlProps } from './HeroChapters';
import { HeroTitle } from './HeroTitle';
import { HERO_FALLBACK_IMAGE, HERO_TEXT, currentLot, selectHeroEvents, toSlide, type HeroLot, type HeroSlide } from './hero-data';
import { useElementHeight, useHeroCarousel, useMediaQuery } from './useHeroCarousel';

/** Altura total = tela menos o header global (68px / 76px). */
const SECTION = 'relative flex h-[calc(100svh-68px)] min-h-[560px] flex-col overflow-hidden bg-ink sm:h-[calc(100svh-76px)] sm:min-h-[600px]';
const META = 'font-mono text-[10px] uppercase tracking-[0.3em] text-bone sm:text-[11px]';

export interface HomeHeroProps {
  /** Eventos já filtrados pela cidade (null = carregando). */
  events: EventWithVenue[] | null;
  cities: { city: string; state: string }[] | null;
  city: string;
  onCity: (c: string) => void;
  /** Falha ao carregar a home: mostra o estado vazio em vez do skeleton eterno. */
  failed?: boolean;
}

export function HomeHero({ events, cities, city, onCity, failed }: HomeHeroProps) {
  const picked = useMemo(() => (events ? selectHeroEvents(events, localIso(new Date())) : null), [events]);
  const ids = picked?.map((e) => e.id).join(',') ?? '';

  // Lote atual de cada festa (public_event_batches já mascara preço e estoque).
  const { data: lotsRes } = useAsync<{ ids: string; map: Record<string, HeroLot | null> }>(async () => {
    if (!picked?.length || !ticketsAvailable()) return { ids, map: {} };
    const entries = await Promise.all(
      picked.map(async (e): Promise<[string, HeroLot | null]> => {
        if (!e.has_tickets) return [e.id, null];
        try {
          return [e.id, currentLot(await ticketService.batches(e.id))];
        } catch {
          return [e.id, null];
        }
      }),
    );
    return { ids, map: Object.fromEntries(entries) };
  }, [ids, picked === null]);

  // Espera os lotes da seleção atual para não "pular" preço/lote depois de pintar.
  const lots = lotsRes && lotsRes.ids === ids ? lotsRes.map : null;
  const slides = useMemo(() => (picked && lots ? picked.map((e) => toSlide(e, lots[e.id] ?? null)) : null), [picked, lots]);
  const cityControl: CityControlProps = { city, cities, onCity };

  if (failed && !slides) return <HeroEmpty cityControl={cityControl} />;
  if (!slides) return <HeroSkeleton />;
  if (slides.length === 0) return <HeroEmpty cityControl={cityControl} />;
  return <HeroCarousel key={ids} slides={slides} cityControl={cityControl} />;
}

function HeroCarousel({ slides, cityControl }: { slides: HeroSlide[]; cityControl: CityControlProps }) {
  const n = slides.length;
  const c = useHeroCarousel(n);
  const slide = slides[c.index]!;
  const stageRef = useRef<HTMLDivElement>(null);
  const stageH = useElementHeight(stageRef);
  const mobile = useMediaQuery('(max-width: 767px)');
  const images = useMemo(() => slides.map((s) => ({ id: s.id, src: s.image })), [slides]);

  return (
    <section aria-roledescription="carousel" aria-label="Festas em cartaz" className={SECTION} {...c.bind}>
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <HeroBackdrop images={images} index={c.index} kenBurns={!c.reduced} running={c.playing || n === 1} />

        <div aria-live={c.playing ? 'off' : 'polite'} className="absolute inset-0">
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${c.index + 1} de ${n}`}
            className="hero-text-in container-site relative flex h-full flex-col"
          >
            <div className={`flex items-start justify-between gap-4 pt-5 sm:pt-7 ${META}`}>
              <p className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-bone shadow-[0_0_12px_3px_var(--bone)]" />
                <span>
                  <span className="hidden sm:inline">Em cartaz · </span>
                  {slide.when}
                </span>
              </p>
              <p className="min-w-0 text-right">
                <span className="block truncate">{slide.place}</span>
                {slide.placeSub && <span className="mt-1.5 block text-bone/75">{slide.placeSub}</span>}
              </p>
            </div>

            <div className="mt-auto">
              <div className="mb-4 flex flex-col items-end md:hidden">
                <BuyDisc slide={slide} size="sm" />
                <LotCountdown endsAt={slide.endsAt} className="mt-2 w-[120px]" />
              </div>
              {slide.subtitle && (
                <p className="mb-2 truncate font-display text-[12px] font-extrabold uppercase tracking-[0.32em] text-bone/85 sm:mb-3 sm:text-[16px] lg:text-[22px]">{slide.subtitle}</p>
              )}
              <HeroTitle text={slide.title} mobile={mobile} animate={!c.reduced} maxPx={stageH * (mobile ? 0.2 : 0.32)} />
            </div>

            <div className="absolute right-8 top-[42%] hidden -translate-y-1/2 flex-col items-center md:flex lg:right-14">
              <BuyDisc slide={slide} size="lg" />
              <LotCountdown endsAt={slide.endsAt} className="mt-4" />
            </div>
          </div>
        </div>
      </div>

      <HeroChapters
        slides={slides}
        index={c.index}
        playing={c.playing}
        reduced={c.reduced}
        onGo={c.go}
        onPrev={c.prev}
        onNext={c.next}
        cityControl={cityControl}
      />
    </section>
  );
}

/** Sem festas com venda aberta: imagem padrão + "NOVAS NOITES EM BREVE" + agenda. */
function HeroEmpty({ cityControl }: { cityControl: CityControlProps }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stageH = useElementHeight(stageRef);
  const mobile = useMediaQuery('(max-width: 767px)');
  const images = useMemo(() => [{ id: 'empty', src: HERO_FALLBACK_IMAGE }], []);

  return (
    <section aria-label="Festas em cartaz" className={SECTION}>
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        <HeroBackdrop images={images} index={0} kenBurns={false} running={false} />
        <div className="hero-text-in container-site relative flex h-full flex-col">
          <p className={`flex items-center gap-3 pt-5 sm:pt-7 ${META}`}>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bone shadow-[0_0_12px_3px_var(--bone)]" />
            Em breve{cityControl.city ? ` · ${cityControl.city}` : ''}
          </p>
          <div className="mt-auto">
            <Link href="/eventos" className="btn-primary mb-5 h-12 w-fit px-7 sm:mb-7">
              Ver agenda <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <HeroTitle text={HERO_TEXT.empty} mobile={mobile} animate={false} maxPx={stageH * (mobile ? 0.2 : 0.32)} />
          </div>
        </div>
      </div>
      <div className="relative z-10 border-t border-line bg-ink">
        <div className="container-site flex min-h-[88px] flex-wrap items-center gap-x-8 gap-y-2 py-3 md:h-[120px]">
          <CityControl {...cityControl} />
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/80">
            Nenhuma festa com venda aberta{cityControl.city ? ` em ${cityControl.city}` : ''} agora.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Carregando: mesmas dimensões do hero, sem pulo de layout. */
function HeroSkeleton() {
  return (
    <section aria-label="Festas em cartaz" aria-busy="true" className={SECTION}>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-ink-2">
        <div className="container-site flex h-full animate-pulse flex-col">
          <div className="flex justify-between pt-5 sm:pt-7">
            <span className="h-3 w-48 rounded bg-panel sm:w-72" />
            <span className="h-3 w-28 rounded bg-panel sm:w-40" />
          </div>
          <span className="absolute right-8 top-[42%] hidden size-[184px] -translate-y-1/2 rounded-full bg-panel md:block lg:right-14" />
          <div className="mt-auto pb-2">
            <span className="mb-4 ml-auto block size-[120px] rounded-full bg-panel md:hidden" />
            <span className="block h-4 w-40 rounded bg-panel sm:w-64" />
            <span className="mt-4 block h-[18vw] max-h-[200px] w-full rounded bg-panel md:h-[12vw]" />
          </div>
        </div>
      </div>
      <div className="border-t border-line bg-ink">
        <div className="container-site flex h-[112px] animate-pulse items-center gap-6 md:h-[120px]">
          <span className="h-11 w-40 shrink-0 rounded-full bg-panel" />
          <span className="hidden h-12 flex-1 rounded bg-panel md:block" />
          <span className="hidden h-12 flex-1 rounded bg-panel md:block" />
          <span className="hidden h-12 flex-1 rounded bg-panel lg:block" />
        </div>
      </div>
    </section>
  );
}
