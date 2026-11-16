'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/providers/AppProviders';
import { ErrorState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { localIso } from '@/lib/week';
import type { EventItem, RankingRow, ReviewWithMeta, Venue, VenueStats } from '@/types';
import { HomeHero } from './HomeHero';
import { FeaturedEvents } from './FeaturedEvents';
import { TopVenues } from './TopVenues';
import { WeekAttractions } from './WeekAttractions';
import { RankingsBoard } from './RankingsBoard';
import { CategoryGrid } from './CategoryGrid';
import { CommunityReviews } from './CommunityReviews';
import { CommunityCTA } from './CommunityCTA';
import { Newsletter } from './Newsletter';
import { IndicatedRail } from '@/components/plus/Indicated';
import { AdSlot } from '@/components/plus/AdSlot';

export type HomeEvent = EventItem & { venue: Venue };

export interface HomeData {
  venues: Venue[];
  stats: Record<string, VenueStats>;
  events: HomeEvent[];
  reviews: ReviewWithMeta[];
  cities: { city: string; state: string }[];
}

const CITY_KEY = 'classifydj:home-city';

export function HomeView() {
  const { data, version } = useApp();
  const [city, setCityState] = useState('');

  // Cidade preferida (conveniência local; funciona normalmente sem storage).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CITY_KEY);
      if (saved) setCityState(saved);
    } catch {
      /* storage indisponível */
    }
  }, []);
  const setCity = (c: string) => {
    setCityState(c);
    try {
      if (c) localStorage.setItem(CITY_KEY, c);
      else localStorage.removeItem(CITY_KEY);
    } catch {
      /* ignore */
    }
  };

  const { data: base, error, reload } = useAsync<HomeData>(async () => {
    const [venues, stats, events, reviews, cities] = await Promise.all([
      data.listVenues(),
      data.getAllStats(),
      data.listEvents({ from: localIso(new Date()) }),
      data.listReviews({ sort: 'recent', limit: 60 }),
      data.listCities(),
    ]);
    return { venues, stats, events, reviews, cities };
  }, [data, version]);

  const { data: rankings } = useAsync<RankingRow[]>(() => data.getRankings({ city: city || undefined }), [data, version, city]);

  // Cidade salva que deixou de existir → volta para "todas".
  useEffect(() => {
    if (base && city && !base.cities.some((c) => c.city === city)) setCity('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, city]);

  const scoped = useMemo<HomeData | null>(() => {
    if (!base) return null;
    if (!city) return base;
    return {
      ...base,
      venues: base.venues.filter((v) => v.city === city),
      events: base.events.filter((e) => e.venue.city === city),
      reviews: base.reviews.filter((r) => r.venue.city === city),
    };
  }, [base, city]);

  return (
    <>
      <HomeHero city={city} onCity={setCity} data={base} scoped={scoped} />
      {error ? (
        <div className="container-site py-16">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : (
        <>
          <FeaturedEvents data={scoped} city={city} />
          <TopVenues rows={rankings ?? null} city={city} />
          {scoped && <IndicatedRail venues={scoped.venues} stats={scoped.stats} className="py-14 sm:py-20" />}
          <WeekAttractions data={scoped} city={city} />
          <AdSlot id="home-mid" className="py-6" />
          <RankingsBoard data={scoped} rows={rankings ?? null} city={city} />
          <CategoryGrid data={scoped} />
          <CommunityReviews data={scoped} city={city} />
        </>
      )}
      <CommunityCTA />
      <Newsletter />
    </>
  );
}
