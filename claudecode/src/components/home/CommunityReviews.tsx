'use client';
import Link from 'next/link';
import { ArrowRight, Quote } from 'lucide-react';
import { ClassifyMark } from '@/components/brand/ApprovedSeal';
import { Avatar } from '@/components/ui/Avatar';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { DemoTag, EmptyState, Skeleton } from '@/components/ui/States';
import { formatDate } from '@/lib/format';
import type { ReviewWithMeta } from '@/types';
import { HomeSectionTitle } from './HomeSectionTitle';
import type { HomeData } from './HomeView';

export function CommunityReviews({ data, city }: { data: HomeData | null; city: string }) {
  // Uma avaliação por casa, priorizando as que têm comentário.
  const items = (() => {
    if (!data) return null;
    const seen = new Set<string>();
    const out: ReviewWithMeta[] = [];
    for (const r of data.reviews) {
      if (!r.review.comment.trim() || seen.has(r.venue.id)) continue;
      seen.add(r.venue.id);
      out.push(r);
      if (out.length === 4) break; // destaque + 3 + selo = grade completa
    }
    return out;
  })();

  return (
    <section className="border-t border-line bg-ink-2 py-16 sm:py-24">
      <div className="container-site">
        <HomeSectionTitle
          index="06"
          eyebrow={city ? `Comunidade · ${city}` : 'Comunidade'}
          title={<>Experiências<br className="hidden sm:block" /> recentes</>}
          text="O que quem saiu de verdade está dizendo sobre a noite."
          href="/reviews"
          linkLabel="Todas as avaliações"
        />
        {!items ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[300px]" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState title="Nenhuma avaliação ainda" text="Seja a primeira pessoa a contar como foi a noite." action={{ href: '/avaliar', label: 'Avaliar' }} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((r, i) => <ReviewTile key={r.review.id} item={r} featured={i === 0} />)}
            <ApprovedTile />
          </div>
        )}
      </div>
    </section>
  );
}

function ReviewTile({ item, featured }: { item: ReviewWithMeta; featured: boolean }) {
  const { review, author, venue } = item;
  const photo = review.photos[0];
  return (
    <article className={`group flex flex-col overflow-hidden rounded-card border border-line bg-panel transition-colors duration-500 hover:border-blue/40 ${featured ? 'md:col-span-2 md:flex-row lg:row-span-2 lg:col-span-1 lg:flex-col' : ''}`}>
      <Link href={`/boates/${venue.slug}#avaliacoes`} className={`relative block shrink-0 overflow-hidden ${featured ? 'aspect-[16/10] md:aspect-auto md:w-1/2 lg:aspect-[4/3.4] lg:w-auto' : 'aspect-[16/8]'}`}>
        <Photo src={photo ?? venue.cover_image} alt={photo ? `Foto da experiência por @${author.username}` : venue.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-panel via-transparent to-transparent" />
        {photo && <span className="absolute left-3 top-3 rounded-sm bg-ink/80 px-2 py-1 text-[8px] font-bold uppercase tracking-nav text-bone/80">Foto da comunidade</span>}
        <div className="absolute bottom-3 right-4">
          <Score value={review.overall_rating} size={featured ? 'lg' : 'md'} />
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <Link href={`/boates/${venue.slug}`} className="font-display text-[18px] font-extrabold uppercase leading-tight tracking-tight transition-colors hover:text-blue">
          {venue.name}
        </Link>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-nav text-mute">{venue.neighborhood} · {venue.city}</p>
        <p className={`relative mt-4 text-[14px] leading-relaxed text-bone/85 ${featured ? 'line-clamp-6' : 'line-clamp-3'}`}>
          <Quote className="mb-1 mr-1 inline h-3.5 w-3.5 -scale-x-100 text-blue" />
          {review.comment}
        </p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <Link href={`/u/${author.username}`} className="flex min-w-0 items-center gap-2.5 hover:text-blue">
            <Avatar profile={author} size={28} />
            <span className="truncate text-[12px] font-semibold">@{author.username}</span>
          </Link>
          <span className="flex shrink-0 items-center gap-2 text-[11px] text-mute">
            <time dateTime={review.created_at}>{formatDate(review.created_at)}</time>
            {review.is_demo && <DemoTag />}
          </span>
        </div>
      </div>
    </article>
  );
}

function ApprovedTile() {
  return (
    <Link href="/approved" className="group flex flex-col items-center justify-center rounded-card border border-line bg-gradient-to-br from-blue/[0.12] via-panel to-panel px-7 py-10 text-center transition-colors hover:border-blue/50">
      <ClassifyMark className="h-[84px] w-[84px] transition-transform duration-700 group-hover:rotate-12" strokeWidth={1.4} />
      <p className="mt-6 font-display text-[19px] font-extrabold uppercase leading-tight tracking-tight">ClassifyDJ<br />Approved</p>
      <p className="mt-3 max-w-[220px] text-[13px] text-mute">O selo das casas com notas altas e consistentes, validadas pela comunidade.</p>
      <span className="link-arrow mt-6">Saiba mais <ArrowRight className="h-3.5 w-3.5" /></span>
    </Link>
  );
}
