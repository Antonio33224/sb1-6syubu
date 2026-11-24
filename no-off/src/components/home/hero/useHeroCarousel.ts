'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type RefObject, type TouchEvent } from 'react';
import { SLIDE_MS } from './hero-data';

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Altura atual de um elemento (ResizeObserver), medida antes da pintura. */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [h, setH] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setH(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

/**
 * Estado do carrossel do hero: troca a cada SLIDE_MS, pausa com o mouse em
 * cima, com foco de teclado dentro e com a aba oculta (retomando do ponto em
 * que parou), sem autoplay com prefers-reduced-motion. Setas ← → e swipe.
 */
export function useHeroCarousel(count: number) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const reduced = usePrefersReducedMotion();
  const playing = count > 1 && !hovered && !focused && !tabHidden && !reduced;
  const remaining = useRef(SLIDE_MS);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);

  useEffect(() => {
    const on = () => setTabHidden(document.visibilityState === 'hidden');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Slide novo → tempo cheio. (Roda antes do efeito do timer no mesmo commit.)
  useEffect(() => {
    remaining.current = SLIDE_MS;
  }, [index]);

  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const t = window.setTimeout(next, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (performance.now() - start));
    };
  }, [playing, index, next]);

  const bind = {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') setHovered(true);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') setHovered(false);
    },
    // Só o foco de teclado pausa (um clique num capítulo não deve travar o autoplay).
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).matches?.(':focus-visible')) setFocused(true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (count < 2 || (e.target as HTMLElement).closest('select,input,textarea')) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    },
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const t = e.touches[0];
      touch.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const start = touch.current;
      touch.current = null;
      const t = e.changedTouches[0];
      if (!start || !t || count < 2) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      if (dx < 0) next();
      else prev();
    },
  };

  return { index, playing, reduced, go, next, prev, bind };
}
