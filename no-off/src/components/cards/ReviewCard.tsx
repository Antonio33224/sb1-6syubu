'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { PreLaunchTag } from '@/components/ui/States';
import { LikeButton, ReportButton } from '@/components/actions/Actions';
import { formatDate, timeAgo } from '@/lib/format';
import { CRITERIA, type ReviewWithMeta } from '@/types';

export function ReviewCard({ item, showVenue = true }: { item: ReviewWithMeta; showVenue?: boolean }) {
  const { review, author, venue } = item;
  const [expanded, setExpanded] = useState(false);
  const long = review.comment.length > 220;
  const edited = review.updated_at !== review.created_at;

  return (
    <article className="card flex flex-col overflow-hidden sm:flex-row">
      {showVenue && (
        <Link href={`/boates/${venue.slug}`} className="group relative block h-40 shrink-0 overflow-hidden sm:h-auto sm:w-[210px]">
          <Photo src={venue.cover_image} alt={venue.name} />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4">
            <p className="font-display text-[15px] font-bold uppercase leading-tight tracking-tight transition-colors group-hover:text-red-bright">{venue.name}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-nav text-bone/70">{venue.city}</p>
          </div>
        </Link>
      )}
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <Link href={`/u/${author.username}`} className="group flex min-w-0 items-center gap-3">
            <Avatar profile={author} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold transition-colors group-hover:text-red-bright">{author.full_name || author.username}</p>
              <p className="text-[11px] text-mute">
                @{author.username} · <time dateTime={review.created_at} title={formatDate(review.created_at)}>{timeAgo(review.created_at)}</time>
                {edited && ' · editada'}
              </p>
            </div>
          </Link>
          <Score value={review.overall_rating} size="sm" />
        </div>

        {review.comment && (
          <p className="mt-4 text-[14px] leading-relaxed text-bone/85">
            {long && !expanded ? `${review.comment.slice(0, 220).trimEnd()}…` : review.comment}
            {long && (
              <button onClick={() => setExpanded((v) => !v)} className="ml-2 text-[12px] font-semibold text-red-bright">
                {expanded ? 'menos' : 'ler mais'}
              </button>
            )}
          </p>
        )}

        {expanded && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {CRITERIA.map((c) => (
              <div key={c.key} className="flex justify-between text-[11px]">
                <dt className="text-mute">{c.label}</dt>
                <dd className="font-semibold text-bone">{review[c.key].toFixed(0)}</dd>
              </div>
            ))}
          </dl>
        )}

        {review.photos.length > 0 && (
          <div className="mt-4 flex gap-2">
            {review.photos.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="block h-16 w-20 overflow-hidden rounded-[3px] border border-line">
                <Photo src={src} alt={`Foto enviada por ${author.username}`} />
              </a>
            ))}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-5 pt-5">
          <LikeButton reviewId={review.id} likes={item.likes} liked={item.likedByMe} authorId={author.id} />
          <ReportButton reviewId={review.id} authorId={author.id} />
          {!long && (
            <button onClick={() => setExpanded((v) => !v)} className="text-[11px] font-semibold text-mute hover:text-bone">
              {expanded ? 'Ocultar notas' : 'Ver notas'}
            </button>
          )}
          {review.experience_date && <span className="text-[11px] text-mute">Experiência em {formatDate(review.experience_date)}</span>}
          {review.status === 'flagged' && <span className="text-[10px] font-semibold uppercase tracking-nav text-mute">Em análise</span>}
          {review.source === 'pre_launch' && <PreLaunchTag className="ml-auto" />}
        </div>
      </div>
    </article>
  );
}
