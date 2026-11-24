'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Executa uma função assíncrona quando as dependências mudam. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const counter = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const id = ++counter.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === counter.current) setData(result);
    } catch (e) {
      if (id === counter.current) setError(e instanceof Error ? e.message : 'Erro inesperado.');
    } finally {
      if (id === counter.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: run, setData };
}
