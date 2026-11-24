'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useState } from 'react';
import { clsx } from 'clsx';
import { HERO_FALLBACK_IMAGE, SLIDE_MS } from './hero-data';

/**
 * Fotografia em tela cheia com o tratamento "trailer": P&B contrastado,
 * vermelho em multiply, brilho em screen, degradês, vinheta e granulação.
 * As fotos fazem crossfade; a ativa tem Ken Burns (1.04 → 1.0) no tempo do slide.
 * Só montamos a foto atual, a próxima (pré-carregamento) e as já vistas.
 */
export function HeroBackdrop({
  images,
  index,
  kenBurns,
  running,
}: {
  images: { id: string; src: string }[];
  index: number;
  kenBurns: boolean;
  running: boolean;
}) {
  const n = images.length;
  const [mounted, setMounted] = useState(() => new Set([0, n > 1 ? 1 : 0]));
  const grain = `hero-grain-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    if (n === 0) return;
    const next = (index + 1) % n;
    setMounted((prev) => {
      if (prev.has(index) && prev.has(next)) return prev;
      const s = new Set(prev);
      s.add(index);
      s.add(next);
      return s;
    });
  }, [index, n]);

  return (
    <div aria-hidden className="absolute inset-0 isolate overflow-hidden bg-ink">
      {images.map((img, i) => {
        const active = i === index;
        return (
          <div key={img.id} className={clsx('hero-xfade absolute inset-0 transition-opacity duration-1000 ease-out', active ? 'opacity-100' : 'opacity-0')}>
            {mounted.has(i) && (
              <img
                src={img.src || HERO_FALLBACK_IMAGE}
                alt=""
                fetchPriority={i === 0 ? 'high' : 'auto'}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                draggable={false}
                className={clsx('hero-photo h-full w-full object-cover', active && kenBurns && 'hero-kenburns')}
                style={active && kenBurns ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: running ? 'running' : 'paused' } : undefined}
              />
            )}
          </div>
        );
      })}
      <div className="hero-tint absolute inset-0" />
      <div className="hero-glow absolute inset-0" />
      <div className="hero-fade absolute inset-0" />
      <div className="hero-vignette absolute inset-0" />
      <svg className="hero-grain pointer-events-none absolute inset-0 h-full w-full">
        <filter id={grain}>
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}
