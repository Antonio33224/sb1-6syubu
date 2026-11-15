'use client';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { DISCOVER_CATEGORIES } from '@/lib/categories';
import { HomeSectionTitle } from './HomeSectionTitle';
import type { HomeData } from './HomeView';

export function CategoryGrid({ data }: { data: HomeData | null }) {
  return (
    <section className="border-t border-line py-16 sm:py-24">
      <div className="container-site">
        <HomeSectionTitle index="05" eyebrow="Explore" title="Descubra por categoria" text="Escolha o clima da noite e veja as casas e eventos relacionados." />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:grid-rows-[260px_260px]">
          {DISCOVER_CATEGORIES.map((c, i) => {
            const venueIds = data ? new Set(data.venues.filter(c.match).map((v) => v.id)) : null;
            const venues = venueIds?.size ?? null;
            const events = data && venueIds ? data.events.filter((e) => venueIds.has(e.venue_id)).length : null;
            const wide = i === 0 || i === 5;
            return (
              <Link
                key={c.slug}
                href={`/descobrir?categoria=${c.slug}`}
                className={clsx(
                  'group relative block overflow-hidden rounded-card border border-line bg-panel transition-colors duration-500 hover:border-blue/60',
                  wide ? 'col-span-2 aspect-[16/9] lg:col-span-1 lg:aspect-auto' : 'aspect-[3/4] lg:aspect-auto',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt="" loading="lazy" decoding="async" className="photo img-zoom absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10 transition-colors duration-500" />
                <div className="absolute inset-0 bg-blue/0 mix-blend-color transition-colors duration-700 group-hover:bg-blue/25" />
                <ArrowUpRight className="absolute right-4 top-4 h-5 w-5 text-bone/60 transition-all duration-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-blue" />
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <h3 className={clsx('font-display font-extrabold uppercase leading-[0.92] tracking-tight', wide ? 'text-[28px] sm:text-[40px] lg:text-[26px]' : 'text-[20px] sm:text-[26px]')}>{c.label}</h3>
                  <p className={clsx('mt-2 text-[12px] leading-snug text-bone/70', !wide && 'hidden sm:block')}>{c.blurb}</p>
                  <p className="mt-3 text-[9px] font-bold uppercase tracking-nav text-blue">
                    {venues === null ? ' ' : venues === 0 ? 'Em breve' : `${venues} ${venues === 1 ? 'lugar' : 'lugares'}${events ? ` · ${events} ${events === 1 ? 'evento' : 'eventos'}` : ''}`}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
