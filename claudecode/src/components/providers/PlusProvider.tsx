'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPlusService, type PlusService } from '@/services/plus';
import { resolveAccess } from '@/lib/plus/subscription';
import type { AccessState, PremiumGrant, Subscription } from '@/types';
import { useApp } from './AppProviders';

interface PlusContextValue {
  plus: PlusService;
  access: AccessState;
  /** true depois da primeira leitura da assinatura (evita "piscar" o paywall). */
  ready: boolean;
  isPremium: boolean;
  subscriptions: Subscription[];
  unread: number;
  refresh: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const FREE: AccessState = { tier: 'free', label: 'Gratuito', subscription: null, accessUntil: null, trialEligible: true };
const PlusContext = createContext<PlusContextValue | null>(null);

export function usePlus() {
  const ctx = useContext(PlusContext);
  if (!ctx) throw new Error('usePlus fora do PlusProvider');
  return ctx;
}

export function PlusProvider({ children }: { children: ReactNode }) {
  const { user, authReady, version } = useApp();
  const plus = useMemo(() => getPlusService(), []);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [grants, setGrants] = useState<PremiumGrant[]>([]);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  // Reavalia o acesso periodicamente (fim do teste/período durante a sessão).
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setSubscriptions([]);
      setGrants([]);
      setReady(true);
      return;
    }
    try {
      const [subs, gr] = await Promise.all([plus.listMySubscriptions(), plus.listMyGrants().catch(() => [])]);
      setSubscriptions(subs);
      setGrants(gr);
    } catch {
      setSubscriptions([]);
      setGrants([]);
    } finally {
      setReady(true);
    }
  }, [plus, user]);

  useEffect(() => {
    if (!authReady) return;
    void refresh();
  }, [authReady, refresh, version]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const access = useMemo(() => (user ? resolveAccess(subscriptions, Date.now(), grants) : FREE), [user, subscriptions, grants, tick]);

  const refreshNotifications = useCallback(async () => {
    if (!user || access.tier !== 'premium') return setUnread(0);
    try {
      await plus.syncNotifications();
      const list = await plus.listNotifications();
      setUnread(list.filter((n) => !n.read_at).length);
    } catch {
      /* alertas indisponíveis não bloqueiam a navegação */
    }
  }, [plus, user, access.tier]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications, version]);

  const value = useMemo<PlusContextValue>(
    () => ({ plus, access, ready: authReady && ready, isPremium: access.tier === 'premium', subscriptions, unread, refresh, refreshNotifications }),
    [plus, access, authReady, ready, subscriptions, unread, refresh, refreshNotifications],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}
