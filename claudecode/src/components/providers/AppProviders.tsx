'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDataService, type DataService } from '@/services';
import type { Favorite, Profile } from '@/types';

// ---------------------------------------------------------------- auth / data
interface AppContextValue {
  data: DataService;
  user: Profile | null;
  authReady: boolean;
  favorites: Favorite[];
  refreshFavorites: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Incrementa quando dados mudam (avaliação criada, curtida...) para recarregar listas. */
  version: number;
  bump: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp fora do AppProviders');
  return ctx;
}

// ---------------------------------------------------------------- toasts
interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
}
const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function AppProviders({ children }: { children: ReactNode }) {
  const data = useMemo(() => getDataService(), []);
  const [user, setUser] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshUser = useCallback(async () => {
    setUser(await data.getCurrentUser());
  }, [data]);

  useEffect(() => {
    let active = true;
    data
      .getCurrentUser()
      .then((u) => active && setUser(u))
      .catch(() => active && setUser(null))
      .finally(() => active && setAuthReady(true));
    const off = data.onAuthChange((p) => {
      setUser(p);
      setVersion((v) => v + 1);
    });
    return () => {
      active = false;
      off();
    };
  }, [data]);

  const refreshFavorites = useCallback(async () => {
    if (!user) return setFavorites([]);
    setFavorites(await data.listFavorites(user.id));
  }, [data, user]);

  useEffect(() => {
    void refreshFavorites();
  }, [refreshFavorites]);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({ data, user, authReady, favorites, refreshFavorites, refreshUser, version, bump: () => setVersion((v) => v + 1) }),
    [data, user, authReady, favorites, refreshFavorites, refreshUser, version],
  );

  return (
    <AppContext.Provider value={value}>
      <ToastContext.Provider value={toast}>
        {children}
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`animate-fade-up rounded-card border px-5 py-4 text-sm backdrop-blur ${
                t.tone === 'error' ? 'border-bone/30 bg-ink/95 text-bone' : 'border-blue/40 bg-ink/95 text-bone'
              }`}
            >
              <span className={`mr-2 text-[10px] font-bold uppercase tracking-nav ${t.tone === 'error' ? 'text-mute' : 'text-blue'}`}>
                {t.tone === 'error' ? 'Atenção' : 'Classify'}
              </span>
              {t.message}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </AppContext.Provider>
  );
}
