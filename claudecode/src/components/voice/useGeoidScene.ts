'use client';
import { useEffect, useRef, useState } from 'react';
import type { GeoidScene, OrbMode, OrbVisualState } from './particles/GeoidScene';

/**
 * Carrega a cena 3D sob demanda (import dinâmico, fora do bundle inicial) e
 * move o MESMO <canvas> para o host atual (orbe pequeno ou painel).
 * O render pausa com a aba oculta ou com o host fora do viewport.
 */
export function useGeoidScene(host: HTMLElement | null, mode: OrbMode, visual: OrbVisualState, level: () => number) {
  const sceneRef = useRef<GeoidScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    const load = () => {
      import('./particles/GeoidScene')
        .then(({ GeoidScene }) => {
          if (cancelled) return;
          const scene = GeoidScene.create({ mobile, reducedMotion });
          if (!scene) return setFailed(true);
          sceneRef.current = scene;
          setReady(true);
        })
        .catch(() => !cancelled && setFailed(true));
    };
    // Não disputa o carregamento inicial da página.
    const idle = 'requestIdleCallback' in window ? window.requestIdleCallback(load, { timeout: 2500 }) : null;
    const timer = idle === null ? setTimeout(load, 800) : null;
    return () => {
      cancelled = true;
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer) clearTimeout(timer);
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setLevelSource(level);
  }, [ready, level]);

  useEffect(() => {
    sceneRef.current?.setState(visual);
  }, [ready, visual]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !host) return;
    host.appendChild(scene.canvas);
    scene.setMode(mode);
    const rect = host.getBoundingClientRect();
    scene.setSize(rect.width, rect.height);

    const ro = new ResizeObserver(([e]) => scene.setSize(e.contentRect.width, e.contentRect.height));
    ro.observe(host);

    let inView = true;
    const update = () => (inView && !document.hidden ? scene.start() : scene.stop());
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      update();
    });
    io.observe(host);
    document.addEventListener('visibilitychange', update);
    update();

    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
      scene.stop();
    };
  }, [ready, host, mode]);

  return { ready, failed };
}
