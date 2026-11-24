import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findPublicEvent } from '@/lib/server/public-data';
import { HIDDEN_TEXT } from '@/lib/public-events';
import { EventView } from './EventView';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

/**
 * Festa "Oculta" (ou suspensa/rascunho) não existe na view pública → 404 real.
 * No modo demonstração (sem Supabase) a página é resolvida no navegador.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await findPublicEvent(slug).catch(() => null);
  if (!found || found.mode === 'demo' || !found.row) return { title: 'Evento' };
  const r = found.row;
  const name = r.name_hidden || !r.name ? HIDDEN_TEXT.name : String(r.name);
  const where = r.location_hidden ? String(r.city ?? '') : [r.location_name, r.city].filter(Boolean).join(' · ');
  return {
    title: name,
    description: `${name} — ${where}. Ingressos na NO OFF.`.slice(0, 160),
    openGraph: { title: name, description: `Ingressos na NO OFF · ${where}`, images: r.cover_image ? [{ url: String(r.cover_image) }] : undefined },
    robots: r.name_hidden ? { index: false } : undefined,
  };
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const found = await findPublicEvent(slug);
  if (found.mode === 'supabase' && !found.row) notFound();
  return <EventView slug={slug} />;
}
