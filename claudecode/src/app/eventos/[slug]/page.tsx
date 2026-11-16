'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Calendar, Clock, MapPin, Ticket } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { Photo } from '@/components/ui/Photo';
import { Score, ReviewCount } from '@/components/ui/Score';
import { Avatar } from '@/components/ui/Avatar';
import { FavoriteButton, ShareButton } from '@/components/actions/Actions';
import { FollowArtistButton } from '@/components/plus/FollowArtistButton';
import { DemoTag, EmptyState, Skeleton } from '@/components/ui/States';
import { FieldError } from '@/components/ui/Controls';
import { useAsync } from '@/hooks/useAsync';
import { formatBRL, formatEventDate, timeAgo } from '@/lib/format';
import { round1 } from '@/lib/rating';

export default function EventPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, version, user } = useApp();

  const { data: payload, loading, reload } = useAsync(async () => {
    const event = await data.getEvent(slug);
    if (!event) return null;
    const [reviews, venueStats] = await Promise.all([data.listEventReviews(event.id), data.getVenueStats(event.venue_id)]);
    return { event, reviews, venueStats };
  }, [data, slug, version]);

  if (loading && !payload) return <div className="container-site py-10"><Skeleton className="h-[60vh]" /></div>;
  if (!payload)
    return (
      <div className="container-site py-24">
        <EmptyState title="Evento não encontrado" action={{ href: '/descobrir', label: 'Ver eventos' }} />
      </div>
    );

  const { event, reviews, venueStats } = payload;
  const d = formatEventDate(event.event_date);
  const isPast = event.event_date < new Date().toISOString().slice(0, 10);
  const avg = reviews.length ? round1(reviews.reduce((s, r) => s + r.review.rating, 0) / reviews.length) : null;
  const mine = reviews.find((r) => r.author.id === user?.id)?.review;

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-line">
        <div className="absolute inset-0 -z-10">
          <Photo src={event.cover_image} alt={event.name} zoom={false} priority />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/25" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/10 to-ink/30" />
        </div>
        <div className="container-site flex min-h-[520px] flex-col justify-end py-12 sm:py-16">
          <div className="flex items-center gap-3">
            <span className="eyebrow text-bone/80">{isPast ? 'Edição encerrada' : 'Próximo evento'}</span>
            {event.is_demo && <DemoTag />}
          </div>
          <h1 className="mt-5 max-w-4xl font-display text-[44px] font-extrabold uppercase leading-[0.92] tracking-tight sm:text-[72px] lg:text-[88px]">{event.name}</h1>
          <div className="mt-7 flex flex-wrap gap-x-8 gap-y-3 text-[12px] font-semibold uppercase tracking-nav text-bone/80">
            <span className="flex items-center gap-2"><Calendar className="h-4 w-4 text-blue" /> {d.full}</span>
            <span className="flex items-center gap-2"><Clock className="h-4 w-4 text-blue" /> {event.start_time}</span>
            <Link href={`/boates/${event.venue.slug}`} className="flex items-center gap-2 hover:text-blue"><MapPin className="h-4 w-4 text-blue" /> {event.venue.name} · {event.venue.city}</Link>
          </div>
          <div className="mt-9 flex flex-wrap gap-3">
            {!isPast && event.ticket_url && (
              <a href={event.ticket_url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                <Ticket className="h-4 w-4" /> Ingressos · {formatBRL(event.ticket_price)}
              </a>
            )}
            <FavoriteButton eventId={event.id} />
            <ShareButton title={event.name} />
          </div>
        </div>
      </section>

      <section className="container-site grid gap-12 py-14 lg:grid-cols-[1.4fr_1fr] lg:gap-20 lg:py-20">
        <div>
          <h2 className="section-title">Sobre o evento</h2>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-bone/80">{event.description}</p>
          <p className="eyebrow mt-10">Line-up</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {event.dj_names.map((dj) => (
              <li key={dj} className="flex items-center justify-between gap-4 py-4">
                <span className="font-display text-[20px] font-bold uppercase tracking-tight sm:text-[26px]">{dj}</span>
                <FollowArtistButton name={dj} kind="dj" />
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            {event.music_styles.map((s) => <span key={s} className="chip">{s}</span>)}
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="card p-6">
            <p className="eyebrow">Nota desta edição</p>
            <Score value={avg} size="lg" className="mt-3" />
            <ReviewCount n={reviews.length} className="mt-2 block" />
            <p className="mt-4 text-[12px] leading-relaxed text-mute">
              Avaliação específica desta edição. Ela não altera a nota permanente do local.
            </p>
          </div>
          <Link href={`/boates/${event.venue.slug}`} className="card group flex items-center justify-between gap-4 p-6 transition-colors hover:border-bone/40">
            <div>
              <p className="eyebrow">Nota do local</p>
              <p className="mt-2 font-display text-[15px] font-bold uppercase tracking-tight group-hover:text-blue">{event.venue.name}</p>
            </div>
            <Score value={venueStats?.review_count ? venueStats.avg_rating : null} size="md" />
          </Link>
          <div className="card grid grid-cols-2 divide-x divide-line">
            <div className="p-5"><p className="eyebrow">Preço</p><p className="mt-2 font-display text-lg font-bold text-blue">{formatBRL(event.ticket_price)}</p></div>
            <div className="p-5"><p className="eyebrow">Início</p><p className="mt-2 font-display text-lg font-bold">{event.start_time}</p></div>
          </div>
        </aside>
      </section>

      <section className="border-t border-line">
        <div className="container-site py-14 lg:py-20">
          <h2 className="section-title mb-10">Comentários da edição</h2>
          <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-16">
            <div className="flex flex-col gap-4">
              {reviews.length === 0 ? (
                <p className="text-sm text-mute">{isPast ? 'Ninguém comentou esta edição ainda.' : 'Os comentários abrem depois que o evento acontecer.'}</p>
              ) : (
                reviews.map(({ review, author }) => (
                  <article key={review.id} className="card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <Link href={`/u/${author.username}`} className="flex items-center gap-3">
                        <Avatar profile={author} size={36} />
                        <div>
                          <p className="text-sm font-semibold">{author.full_name || author.username}</p>
                          <p className="text-[11px] text-mute">@{author.username} · {timeAgo(review.created_at)}</p>
                        </div>
                      </Link>
                      <Score value={review.rating} size="sm" />
                    </div>
                    {review.comment && <p className="mt-4 text-[14px] leading-relaxed text-bone/85">{review.comment}</p>}
                    {review.is_demo && <DemoTag className="mt-3" />}
                  </article>
                ))
              )}
            </div>
            <div>{isPast ? <EventReviewForm eventId={event.id} initialRating={mine?.rating} initialComment={mine?.comment} onSaved={reload} /> : (
              <div className="card p-6">
                <p className="eyebrow">Vai estar lá?</p>
                <p className="mt-3 text-sm text-mute">Favorite o evento para lembrar e volte depois para avaliar a edição.</p>
                <Link href={`/boates/${event.venue.slug}`} className="link-arrow mt-5">Ver o local <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
            )}</div>
          </div>
        </div>
      </section>
    </>
  );
}

function EventReviewForm({ eventId, initialRating, initialComment, onSaved }: { eventId: string; initialRating?: number; initialComment?: string; onSaved: () => void }) {
  const { data, user } = useApp();
  const toast = useToast();
  const [rating, setRating] = useState(initialRating ?? 8);
  const [comment, setComment] = useState(initialComment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user)
    return (
      <div className="card p-6">
        <p className="eyebrow">Esteve nesta edição?</p>
        <p className="mt-3 text-sm text-mute">Entre na sua conta para avaliar.</p>
        <Link href={`/entrar?next=${encodeURIComponent(typeof location !== 'undefined' ? location.pathname : '/')}`} className="btn-outline btn-sm mt-5">Entrar</Link>
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await data.upsertEventReview(eventId, rating, comment);
      toast(initialRating !== undefined ? 'Avaliação da edição atualizada.' : 'Avaliação da edição publicada.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-6">
      <p className="eyebrow">{initialRating !== undefined ? 'Sua avaliação da edição' : 'Avaliar esta edição'}</p>
      <div className="flex items-center gap-5">
        <input type="range" min={0} max={10} step={0.5} value={rating} onChange={(e) => setRating(Number(e.target.value))} className="flex-1 accent-[#83A9F5]" aria-label="Nota" />
        <Score value={rating} size="md" />
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} placeholder="Como foi esta edição?" className="field h-auto resize-none py-3" />
      <FieldError message={error} />
      <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Salvando…' : 'Publicar'}</button>
    </form>
  );
}
