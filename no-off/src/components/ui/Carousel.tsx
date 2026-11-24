'use client';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Carrossel horizontal: rolagem nativa com snap (toque), arrastar com o mouse
 * e botões anterior/próximo. Os filhos definem a própria largura.
 */
export function Carousel({
  children,
  className,
  trackClassName,
  label,
  controls = 'top',
}: {
  children: ReactNode;
  className?: string;
  trackClassName?: string;
  label: string;
  /** 'top' renderiza os botões fora do trilho (use com CarouselControls) ou 'overlay' sobre as bordas. */
  controls?: 'overlay' | 'none' | 'top';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.85, 260), behavior: 'smooth' });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !ref.current) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      el.style.scrollSnapType = 'none';
      el.style.cursor = 'grabbing';
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const el = ref.current;
    const d = drag.current;
    drag.current = null;
    if (!el || !d) return;
    el.style.cursor = '';
    if (d.moved) {
      // Evita que o clique ao soltar abra o link do card arrastado.
      const block = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      el.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', block, { capture: true }), 50);
      requestAnimationFrame(() => (el.style.scrollSnapType = ''));
    }
  };

  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink/80 text-bone backdrop-blur transition-all duration-300 hover:border-red hover:text-red-bright disabled:pointer-events-none disabled:opacity-30';

  return (
    <div className={clsx('relative', className)} role="region" aria-roledescription="carrossel" aria-label={label}>
      {controls === 'top' && (
        <div className="mb-5 hidden justify-end gap-2 sm:flex">
          <button type="button" className={btn} onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className={btn} onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Próximo">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
      <div
        ref={ref}
        onScroll={update}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDragStart={(e) => e.preventDefault()}
        className={clsx(
          '-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 no-scrollbar sm:-mx-8 sm:px-8 lg:-mx-14 lg:scroll-px-14 lg:px-14',
          'cursor-grab select-none',
          trackClassName,
        )}
      >
        {children}
      </div>
      {controls === 'overlay' && (
        <>
          <button type="button" className={clsx(btn, 'absolute left-2 top-1/2 hidden -translate-y-1/2 sm:flex')} onClick={() => scrollBy(-1)} disabled={edges.start} aria-label="Anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className={clsx(btn, 'absolute right-2 top-1/2 hidden -translate-y-1/2 sm:flex')} onClick={() => scrollBy(1)} disabled={edges.end} aria-label="Próximo">
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
