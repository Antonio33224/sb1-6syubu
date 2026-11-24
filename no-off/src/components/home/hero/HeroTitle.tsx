'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { fitFontSize, splitBalanced } from './hero-data';
import { useIsoLayoutEffect } from './useHeroCarousel';

const BASE_PX = 100;
/** No celular, abaixo deste tamanho em 1 linha o nome passa para 2 linhas. */
const MOBILE_ONE_LINE_MIN = 56;
const TITLE_CLASS = 'font-display font-extrabold uppercase leading-[0.86] tracking-[-0.06em]';

/**
 * Nome da festa (h1): mede o texto e escala a fonte para ocupar a largura
 * disponível sem nunca cortar. Desktop: 1 linha. Celular: 2 linhas
 * equilibradas quando 1 linha ficaria pequena demais.
 * As letras sobem uma a uma (stagger de 25ms) — desligado com reduced motion.
 */
export function HeroTitle({ text, maxPx, mobile, animate, as: Tag = 'h1' }: { text: string; maxPx: number; mobile: boolean; animate: boolean; as?: 'h1' | 'p' }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ size: number; lines: string[] } | null>(null);

  const compute = useCallback(() => {
    const wrap = wrapRef.current;
    const m = measureRef.current;
    if (!wrap || !m) return;
    const width = (s: string) => {
      m.textContent = s;
      return m.getBoundingClientRect().width;
    };
    const cw = wrap.clientWidth;
    const cap = maxPx > 0 ? maxPx : Number.POSITIVE_INFINITY;
    let lines = [text];
    let size = fitFontSize(cw, width(text), BASE_PX, cap);
    if (mobile && /\s/.test(text.trim()) && size < MOBILE_ONE_LINE_MIN) {
      lines = splitBalanced(text);
      size = fitFontSize(cw, Math.max(...lines.map(width)), BASE_PX, cap);
    }
    m.textContent = '';
    setFit((prev) => (prev && prev.size === size && prev.lines.join('\n') === lines.join('\n') ? prev : { size, lines }));
  }, [text, maxPx, mobile]);

  useIsoLayoutEffect(() => {
    compute();
  }, [compute]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(wrap);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) compute();
    });
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [compute]);

  let offset = 0;
  return (
    <div ref={wrapRef} className="relative w-full">
      <span ref={measureRef} aria-hidden className={clsx(TITLE_CLASS, 'invisible absolute left-0 top-0 whitespace-nowrap')} style={{ fontSize: BASE_PX }} />
      <Tag className={clsx(TITLE_CLASS, 'text-bone', !fit && 'invisible')} style={fit ? { fontSize: fit.size } : undefined}>
        <span className="sr-only">{text}</span>
        <span aria-hidden className="block">
          {(fit?.lines ?? [text]).map((line, li) => {
            const start = offset;
            offset += line.length;
            return (
              // padding/margem negativos: espaço para acentos sem deslocar a base das letras.
              <span key={li} className="-mt-[0.14em] block overflow-hidden whitespace-nowrap pt-[0.14em]">
                {animate
                  ? Array.from(line).map((ch, i) => (
                      <span key={i} className="hero-letter" style={{ animationDelay: `${(start + i) * 25}ms` }}>
                        {ch === ' ' ? ' ' : ch}
                      </span>
                    ))
                  : line}
              </span>
            );
          })}
        </span>
      </Tag>
    </div>
  );
}
