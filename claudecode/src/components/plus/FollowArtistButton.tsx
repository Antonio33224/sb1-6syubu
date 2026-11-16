'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { BellPlus, BellRing, Lock } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { normalizeName } from '@/lib/plus/alerts';
import type { ArtistKind } from '@/types';

/** Lista compartilhada dos artistas seguidos (evita uma requisição por botão). */
let cache: { userId: string; keys: Set<string> } | null = null;
let pending: Promise<Set<string>> | null = null;

export function FollowArtistButton({ name, kind = 'dj', className }: { name: string; kind?: ArtistKind; className?: string }) {
  const { user } = useApp();
  const { plus, isPremium, ready, refreshNotifications } = usePlus();
  const toast = useToast();
  const key = normalizeName(name);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !isPremium) return;
    let active = true;
    const load = async () => {
      if (cache?.userId === user.id) return cache.keys;
      pending ??= plus.listArtistFavorites().then((l) => {
        cache = { userId: user.id, keys: new Set(l.map((a) => a.name_key)) };
        pending = null;
        return cache.keys;
      });
      return pending;
    };
    load().then((keys) => active && setFollowing(keys.has(key))).catch(() => {});
    return () => {
      active = false;
    };
  }, [user, isPremium, plus, key]);

  if (!ready) return null;
  if (!isPremium)
    return (
      <Link href="/classify-plus" className={clsx('inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-nav text-mute transition-colors hover:text-blue', className)} title="Alertas de DJs são exclusivos do Classify+">
        <Lock className="h-3 w-3" /> Seguir · Classify+
      </Link>
    );

  const toggle = async () => {
    setBusy(true);
    try {
      const now = await plus.toggleArtistFavorite(name, kind);
      setFollowing(now);
      if (cache && user && cache.userId === user.id) now ? cache.keys.add(key) : cache.keys.delete(key);
      toast(now ? `Você vai receber alertas de ${name}.` : `Você deixou de seguir ${name}.`);
      if (now) void refreshNotifications();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao seguir.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold uppercase tracking-nav transition-colors', following ? 'border-blue bg-blue text-ink' : 'border-line text-bone hover:border-blue hover:text-blue', className)}
    >
      {following ? <BellRing className="h-3.5 w-3.5" /> : <BellPlus className="h-3.5 w-3.5" />}
      {following ? 'Seguindo' : 'Seguir'}
    </button>
  );
}
