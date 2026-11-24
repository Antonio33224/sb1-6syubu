/**
 * Leituras públicas feitas no servidor (Server Components): 404 real para
 * festas ocultas, metadados/Open Graph e sitemap. Usa a anon key e a VIEW
 * public_events — exatamente o que um visitante anônimo pode ver.
 */
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_EVENT_COLUMNS } from '@/lib/public-events';

export function anonServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Festa pública pela slug pública (ou id quando o nome está oculto). null = não existe/oculta. */
export async function findPublicEvent(slug: string): Promise<Record<string, unknown> | null> {
  const db = anonServerClient();
  if (!db) throw new Error('Supabase não configurado (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  if (!/^[a-z0-9-]{1,140}$/i.test(slug)) return null;
  const { data, error } = await db.from('public_events').select(PUBLIC_EVENT_COLUMNS).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`public_events: ${error.message}`);
  return (data as unknown as Record<string, unknown>) ?? null;
}

export async function listPublicSitemap(): Promise<{ events: { slug: string; created_at: string }[]; venues: { slug: string; created_at: string }[] }> {
  const db = anonServerClient();
  if (!db) return { events: [], venues: [] };
  const [ev, ve] = await Promise.all([
    db.from('public_events').select('slug, created_at').order('event_date', { ascending: false }).limit(5000),
    db.from('venues').select('slug, created_at').limit(5000),
  ]);
  return {
    events: ((ev.data ?? []) as { slug: string; created_at: string }[]),
    venues: ((ve.data ?? []) as { slug: string; created_at: string }[]),
  };
}
