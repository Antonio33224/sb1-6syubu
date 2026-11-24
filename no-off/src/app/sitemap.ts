import type { MetadataRoute } from 'next';
import { listPublicSitemap } from '@/lib/server/public-data';

export const revalidate = 3600;

/** Sitemap: só festas da view pública (ocultas, suspensas e rascunhos nunca entram). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const fixed = ['', '/eventos', '/rankings', '/reviews', '/descobrir', '/editorial', '/approved', '/sobre', '/contato', '/termos', '/privacidade'];
  const { events, venues } = await listPublicSitemap().catch(() => ({ events: [], venues: [] }));
  return [
    ...fixed.map((p) => ({ url: `${site}${p}`, changeFrequency: 'daily' as const, priority: p === '' ? 1 : 0.7 })),
    // Festas com nome oculto têm slug = id (não indexar URLs provisórias).
    ...events.filter((e) => !/^[0-9a-f-]{36}$/.test(e.slug)).map((e) => ({ url: `${site}/eventos/${e.slug}`, lastModified: e.created_at, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...venues.map((v) => ({ url: `${site}/boates/${v.slug}`, lastModified: v.created_at, changeFrequency: 'weekly' as const, priority: 0.6 })),
  ];
}
