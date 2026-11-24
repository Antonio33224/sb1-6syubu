'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { BrandMark } from '@/components/brand/ApprovedSeal';
import { useAsync } from '@/hooks/useAsync';
import type { ReviewWithMeta, VenueStats } from '@/types';

export function LatestReviewsSection() {
  const { data, version } = useApp();
  const { data: payload, loading, error, reload } = useAsync(async () => {
    const [reviews, stats] = await Promise.all([data.listReviews({ sort: 'recent', limit: 40 }), data.getAllStats()]);
    // Uma entrada por estabelecimento: as 4 casas avaliadas mais recentemente.
    const seen = new Set<string>();
    const unique: ReviewWithMeta[] = [];
    for (const r of reviews) {
      if (seen.has(r.venue.id)) continue;
      seen.add(r.venue.id);
      unique.push(r);
      if (unique.length === 4) break;
    }
    return { unique, stats };
  }, [data, version]);

  return (
    <section className="container-site pb-16 sm:pb-24">
      <SectionHeader title="Últimas avaliações" href="/reviews" linkLabel="Ver todas" />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !payload ? (
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr_0.82fr]">
          <Skeleton className="aspect-[4/3.2]" />
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
      ) : payload && payload.unique.length ? (
        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr_0.82fr] lg:gap-6">
          <FeaturedReview item={payload.unique[0]!} stats={payload.stats[payload.unique[0]!.venue.id]} />
          <div className="flex flex-col">
            {payload.unique.slice(1, 4).map((r, i) => (
              <ReviewListRow key={r.review.id} item={r} stats={payload.stats[r.venue.id]} index={i} />
            ))}
          </div>
          <ApprovedPromo />
        </div>
      ) : (
        <EmptyState title="Nenhuma avaliação ainda" text="Seja a primeira pessoa a avaliar uma experiência." action={{ href: '/avaliar', label: 'Avaliar' }} />
      )}
    </section>
  );
}

function FeaturedReview({ item, stats }: { item: ReviewWithMeta; stats?: VenueStats }) {
  return (
    <Link href={`/boates/${item.venue.slug}`} className="group relative block aspect-[4/3.4] overflow-hidden rounded-card border border-line bg-panel lg:aspect-auto lg:min-h-[340px]">
      <Photo src={item.venue.cover_image} alt={item.venue.name} />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-ink/20" />
      <span className="absolute left-5 top-5 rounded-sm bg-red px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-nav text-bone sm:left-6 sm:top-6">
        Review
      </span>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-7">
        <div className="min-w-0">
          <h3 className="font-display text-[26px] font-extrabold uppercase leading-none tracking-tight sm:text-[32px]">{item.venue.name}</h3>
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-nav text-bone/70">{item.venue.city}</p>
        </div>
        <Score value={stats?.avg_rating ?? item.review.overall_rating} size="lg" />
      </div>
    </Link>
  );
}

function ReviewListRow({ item, stats, index }: { item: ReviewWithMeta; stats?: VenueStats; index: number }) {
  return (
    <Link
      href={`/boates/${item.venue.slug}`}
      className="group flex flex-1 items-center gap-4 border-b border-line py-4 first:pt-0 last:border-b-0 sm:gap-5 lg:first:pt-1"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="h-[72px] w-[100px] shrink-0 overflow-hidden rounded-[4px] sm:h-[84px] sm:w-[118px]">
        <Photo src={item.venue.cover_image} alt={item.venue.name} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-bold uppercase tracking-tight transition-colors group-hover:text-red-bright sm:text-[16px]">
          {item.venue.name}
        </p>
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-nav text-mute">{item.venue.city}</p>
      </div>
      <Score value={stats?.avg_rating ?? item.review.overall_rating} size="sm" showMax={false} />
    </Link>
  );
}

function ApprovedPromo() {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-line bg-panel px-7 py-10 text-center">
      <BrandMark className="h-[92px] w-[92px]" strokeWidth={1.4} />
      <p className="mt-7 font-display text-[19px] font-extrabold uppercase leading-tight tracking-tight">


        <br />
        Approved
      </p>
      <p className="mt-3 text-[13px] text-mute">O selo das melhores festas.</p>
      <Link href="/approved" className="btn-outline btn-sm group mt-7">
        Saiba mais <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  );
}
