'use client';
import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, ChevronDown, MapPin } from 'lucide-react';
import { SLIDE_MS, type HeroSlide } from './hero-data';

const pad = (n: number) => String(n).padStart(2, '0');

export interface CityControlProps {
  city: string;
  cities: { city: string; state: string }[] | null;
  onCity: (c: string) => void;
}

/** Seletor compacto de cidade (filtra a home inteira — lógica do HomeView). */
export function CityControl({ city, cities, onCity }: CityControlProps) {
  return (
    <label className="relative inline-flex h-11 min-w-0 shrink-0 items-center gap-2 rounded-full border border-bone/30 pl-4 pr-9 font-mono text-[10px] uppercase tracking-[0.25em] text-bone transition-colors focus-within:border-red-bright hover:border-red-bright">
      <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0 text-red-bright" />
      <span className="max-w-[150px] truncate">{city || 'Todas as cidades'}</span>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 h-3.5 w-3.5 text-bone/70" />
      <select aria-label="Selecionar cidade" value={city} onChange={(e) => onCity(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        <option value="" className="bg-ink">Todas as cidades</option>
        {(cities ?? []).map((c) => (
          <option key={c.city} value={c.city} className="bg-ink">
            {c.city} — {c.state}
          </option>
        ))}
      </select>
    </label>
  );
}

function Progress({ active, animated, playing, index }: { active: boolean; animated: boolean; playing: boolean; index: number }) {
  if (!active) return null;
  return (
    <span
      key={index}
      className={clsx('block h-full w-full bg-red', animated && 'hero-progress')}
      style={animated ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: playing ? 'running' : 'paused' } : undefined}
    />
  );
}

/**
 * Rodapé do hero: os "capítulos" (até 5 festas). A atual tem número vermelho e
 * barra enchendo no tempo do slide; as seguintes perdem opacidade.
 * No celular viram traços com o nome só da festa atual.
 */
export function HeroChapters({
  slides,
  index,
  playing,
  reduced,
  onGo,
  onPrev,
  onNext,
  cityControl,
}: {
  slides: HeroSlide[];
  index: number;
  playing: boolean;
  reduced: boolean;
  onGo: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  cityControl: CityControlProps;
}) {
  const n = slides.length;
  const animated = !reduced && n > 1;
  const current = slides[index];

  return (
    <div className="relative z-10 border-t border-line bg-ink">
      {/* Desktop */}
      <div className="container-site hidden h-[120px] items-center gap-8 md:flex lg:gap-12">
        <CityControl {...cityControl} />
        <ol className="grid min-w-0 flex-1 gap-4 lg:gap-6" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {slides.map((s, i) => {
            const active = i === index;
            const dist = (i - index + n) % n;
            return (
              <li key={s.id} className="min-w-0 transition-opacity duration-500" style={{ opacity: active ? 1 : Math.max(0.55, 1 - dist * 0.12) }}>
                <button
                  type="button"
                  onClick={() => onGo(i)}
                  aria-label={`Ir para a festa ${i + 1} de ${n}: ${s.title}, ${s.chapterDay}`}
                  aria-current={active ? 'true' : undefined}
                  className="group block min-h-11 w-full py-2 text-left"
                >
                  <span aria-hidden className="block h-px w-full overflow-hidden bg-bone/20">
                    <Progress active={active} animated={animated} playing={playing} index={index} />
                  </span>
                  <span aria-hidden className="mt-3 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.25em] text-bone">
                    <span className={active ? 'text-red-bright' : undefined}>{pad(i + 1)}</span>
                    <span>{s.chapterDay}</span>
                  </span>
                  <span aria-hidden className="mt-1.5 block truncate font-display text-[13px] font-extrabold uppercase tracking-tight text-bone transition-colors group-hover:text-red-bright">
                    {s.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {n > 1 && (
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Festa anterior"
              className="flex size-11 items-center justify-center rounded-full border border-bone/60 text-bone transition-colors hover:border-red-bright hover:text-red-bright"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Próxima festa"
              className="flex size-11 items-center justify-center rounded-full bg-red text-bone shadow-[0_0_24px_-6px_var(--red)] transition-colors hover:bg-red-bright active:bg-red-deep"
            >
              <ArrowRight aria-hidden className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Celular */}
      <div className="container-site py-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <CityControl {...cityControl} />
          {n > 1 && (
            <p aria-hidden className="shrink-0 font-mono text-[10px] uppercase tracking-[0.25em] text-bone">
              <span className="text-red-bright">{pad(index + 1)}</span> / {pad(n)}
            </p>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p aria-hidden className="min-w-0 truncate font-display text-[12px] font-extrabold uppercase tracking-tight text-bone">
            {current?.title} <span className="font-mono text-[10px] font-normal tracking-[0.2em] text-bone/80">· {current?.chapterDay}</span>
          </p>
          {n > 1 && (
            <div className="flex shrink-0 items-center">
              {slides.map((s, i) => {
                const active = i === index;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onGo(i)}
                    aria-label={`Ir para a festa ${i + 1} de ${n}: ${s.title}`}
                    aria-current={active ? 'true' : undefined}
                    className="flex h-11 w-9 items-center justify-center"
                  >
                    <span aria-hidden className={clsx('block h-[3px] overflow-hidden rounded-full bg-bone/30 transition-all duration-500', active ? 'w-7' : 'w-3.5')}>
                      <Progress active={active} animated={animated} playing={playing} index={index} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
