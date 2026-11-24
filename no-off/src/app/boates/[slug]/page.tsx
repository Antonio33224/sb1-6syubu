'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ExternalLink, Globe, Instagram, MapPin, Star } from 'lucide-react';
import { PricePanel } from '@/components/venue/PriceDisplay';
import { WeeklyLineup } from '@/components/venue/WeeklyLineup';
import { brl, hasAvgPrice } from '@/lib/pricing';
import { localIso, weekWindow } from '@/lib/week';
import { useApp } from '@/components/providers/AppProviders';
import { Photo } from '@/components/ui/Photo';
import { Score, ReviewCount } from '@/components/ui/Score';
import { ApprovedBadge } from '@/components/brand/ApprovedSeal';
import { FavoriteButton, ShareButton } from '@/components/actions/Actions';
import { ReviewCard } from '@/components/cards/ReviewCard';
import { EventCard } from '@/components/cards/EventCard';
import { DemoTag, EmptyState, Skeleton } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Controls';
import { useAsync } from '@/hooks/useAsync';
import { CATEGORY_LABEL, formatBRL, formatEventDate, priceLabel } from '@/lib/format';
import { eventPriceText } from '@/lib/public-events';
import { DISTRIBUTION_LABELS } from '@/lib/rating';
import { CRITERIA, type ReviewSort } from '@/types';

const VenueMap = dynamic(() => import('@/components/map/VenueMap').then((m) => m.VenueMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[360px]" />,
});

export default function VenuePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, version, user } = useApp();
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [showAll, setShowAll] = useState(false);

  const { data: payload, loading } = useAsync(async () => {
    const venue = await data.getVenue(slug);
    if (!venue) return null;
    const [stats, upcoming, past, mine] = await Promise.all([
      data.getVenueStats(venue.id),
      // data local (não UTC) para não perder as atrações de hoje à noite
      data.listEvents({ venueId: venue.id, from: localIso(new Date()) }),
      data.listEvents({ venueId: venue.id, pastOnly: true }),
      user ? data.getMyReview(venue.id) : Promise.resolve(null),
    ]);
    return { venue, stats, upcoming, past, mine };
  }, [data, slug, version, user]);

  const { data: reviews } = useAsync(
    async () => (payload?.venue ? data.listReviews({ venueId: payload.venue.id, sort }) : []),
    [data, payload?.venue?.id, sort, version],
  );

  // O conteúdo carrega de forma assíncrona: aplica a âncora (#avaliacoes, #mapa) após o carregamento.
  const loaded = Boolean(payload && reviews);
  useEffect(() => {
    if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [loaded]);

  if (loading && !payload)
    return (
      <div className="container-site py-10">
        <Skeleton className="h-[62vh]" />
      </div>
    );

  if (!payload)
    return (
      <div className="container-site py-24">
        <EmptyState title="Estabelecimento não encontrado" text="O link pode estar incorreto ou o registro foi removido." action={{ href: '/descobrir', label: 'Descobrir lugares' }} />
      </div>
    );

  const { venue, stats, upcoming, past, mine } = payload;
  const count = stats?.review_count ?? 0;
  const maxBucket = Math.max(1, ...(stats?.distribution ?? [0]));
  const communityPhotos = (reviews ?? []).flatMap((r) => r.review.photos.map((src) => ({ src, by: r.author.username })));
  const gallery = [
    ...[venue.cover_image, ...venue.gallery].map((src) => ({ src, by: null as string | null })),
    ...communityPhotos.filter((p) => !venue.gallery.includes(p.src) && p.src !== venue.cover_image),
  ];
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.address}, ${venue.city} - ${venue.state}`)}`;

  return (
    <>
      {/* HERO */}
      <section className="relative isolate overflow-hidden border-b border-line">
        <div className="absolute inset-0 -z-10">
          <Photo src={venue.cover_image} alt={venue.name} zoom={false} priority />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-ink/40" />
        </div>
        <div className="container-site flex min-h-[520px] flex-col justify-end py-12 sm:min-h-[600px] sm:py-16">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow text-bone/80">{CATEGORY_LABEL[venue.category]}</span>
            {venue.approved && <ApprovedBadge />}
            {venue.is_demo && <DemoTag />}
          </div>
          <h1 className="mt-5 max-w-4xl animate-fade-up font-display text-[48px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[80px] lg:text-[104px]">
            {venue.name}
          </h1>
          <p className="mt-5 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-nav text-bone/75">
            <MapPin className="h-3.5 w-3.5" /> {venue.neighborhood} · {venue.city} — {venue.state}
          </p>
          <div className="mt-8 flex flex-wrap items-end gap-x-10 gap-y-6">
            <div>
              <Score value={count ? stats!.avg_rating : null} size="xl" />
              <ReviewCount n={count} className="mt-2 block" />
            </div>
            <a href="#precos" className="group block border-l border-red/50 pl-6 sm:pl-8" aria-label="Ver média de preços">
              <p className="text-[9px] font-extrabold uppercase tracking-wide2 text-red-bright">Média de preços</p>
              {hasAvgPrice(venue) ? (
                <>
                  <p className="mt-2 font-display text-[44px] font-extrabold leading-none tracking-tight text-red-bright sm:text-[56px]">{brl(venue.avg_price)}</p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-nav text-bone/70">Por pessoa{venue.is_demo ? ' · exemplo' : ''}</p>
                </>
              ) : (
                <>
                  <p className="mt-2 font-display text-[32px] font-extrabold leading-none tracking-tight text-bone/85">{priceLabel(venue.price_range)}</p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-nav text-mute">Média não informada</p>
                </>
              )}
            </a>
            <div className="flex flex-wrap gap-3">
              <Link href={`/avaliar?local=${venue.slug}`} className="btn-primary">
                <Star className="h-4 w-4" /> {mine ? 'Atualizar avaliação' : 'Avaliar'}
              </Link>
              <FavoriteButton venueId={venue.id} />
              <ShareButton title={venue.name} />
              <a href="#atracoes" className="btn-ghost">
                <CalendarDays className="h-4 w-4" /> Atrações
              </a>
              <a href="#mapa" className="btn-ghost">
                <MapPin className="h-4 w-4" /> Ver no mapa
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* INFORMAÇÕES */}
      <section className="container-site grid gap-12 py-14 lg:grid-cols-[1.4fr_1fr] lg:gap-20 lg:py-20">
        <div>
          <h2 className="section-title">Sobre</h2>
          <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-bone/80">{venue.description}</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {venue.music_styles.map((s) => (
              <Link key={s} href={`/descobrir?estilo=${encodeURIComponent(s)}`} className="chip">{s}</Link>
            ))}
          </div>
        </div>
        <div id="precos" className="flex scroll-mt-24 flex-col gap-6">
        <PricePanel venue={venue} />
        <dl className="card divide-y divide-line">
          <InfoRow label="Endereço" value={venue.address || '—'} />
          <InfoRow label="Funcionamento" value={venue.opening_days.join(', ') || '—'} />
          <InfoRow label="Faixa de preço" value={priceLabel(venue.price_range)} />
          <InfoRow label="Estilos" value={venue.music_styles.join(', ') || '—'} />
          <div className="flex flex-wrap gap-3 px-5 py-4">
            {venue.instagram_url && (
              <a href={venue.instagram_url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm"><Instagram className="h-3.5 w-3.5" /> Instagram</a>
            )}
            {venue.website_url && (
              <a href={venue.website_url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm"><Globe className="h-3.5 w-3.5" /> Site</a>
            )}
          </div>
        </dl>
        </div>
      </section>

      {/* ATRAÇÕES DA SEMANA */}
      <WeeklyLineup venue={venue} events={upcoming} nextLater={upcoming.find((e) => e.event_date > weekWindow().to) ?? null} />

      {/* AVALIAÇÕES */}
      <section id="avaliacoes" className="scroll-mt-24 border-t border-line">
        <div className="container-site py-14 lg:py-20">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <h2 className="section-title">Avaliações</h2>
            <Link href={`/avaliar?local=${venue.slug}`} className="link-arrow">{mine ? 'Atualizar minha avaliação' : 'Avaliar este local'} <ArrowRight className="h-3.5 w-3.5" /></Link>
          </div>

          <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-16">
            <aside className="flex min-w-0 flex-col gap-8">
              <div className="card p-6">
                <p className="eyebrow">Nota geral</p>
                <Score value={count ? stats!.avg_rating : null} size="lg" className="mt-3" />
                <ReviewCount n={count} className="mt-2 block" />
                <div className="mt-6 flex flex-col gap-2">
                  {DISTRIBUTION_LABELS.map((label, i) => (
                    <div key={label} className="grid grid-cols-[60px_1fr_28px] items-center gap-3 text-[11px]">
                      <span className="text-mute">{label}</span>
                      <span className="h-[3px] overflow-hidden rounded-full bg-line">
                        <span className="block h-full bg-red" style={{ width: `${((stats?.distribution[i] ?? 0) / maxBucket) * 100}%` }} />
                      </span>
                      <span className="text-right text-mute">{stats?.distribution[i] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-6">
                <p className="eyebrow mb-5">Notas por categoria</p>
                <ul className="flex flex-col gap-4">
                  {CRITERIA.map((c) => {
                    const v = stats?.criteria[c.key] ?? 0;
                    return (
                      <li key={c.key}>
                        <div className="flex justify-between text-[12px]">
                          <span className="text-bone/85">{c.label}</span>
                          <span className="font-display font-bold text-red-bright">{count ? v.toFixed(1) : '—'}</span>
                        </div>
                        <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-line">
                          <span className="block h-full bg-bone/80" style={{ width: `${count ? v * 10 : 0}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </aside>

            <div className="min-w-0">
              <Tabs value={sort} onChange={setSort} items={[
                { value: 'recent', label: 'Recentes' },
                { value: 'useful', label: 'Mais úteis' },
                { value: 'best', label: 'Maiores notas' },
                { value: 'liked', label: 'Mais curtidas' },
              ]} />
              <div className="mt-6 flex flex-col gap-4">
                {!reviews ? (
                  <Skeleton className="h-48" />
                ) : reviews.length === 0 ? (
                  <EmptyState title="Ainda sem avaliações" text="Seja a primeira pessoa a avaliar este local." action={{ href: `/avaliar?local=${venue.slug}`, label: 'Avaliar' }} />
                ) : (
                  <>
                    {reviews.slice(0, showAll ? undefined : 6).map((r) => (
                      <ReviewCard key={`${r.review.id}-${r.likes}`} item={r} showVenue={false} />
                    ))}
                    {!showAll && reviews.length > 6 && (
                      <button onClick={() => setShowAll(true)} className="btn-outline self-center">Ver todas as {reviews.length} avaliações</button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GALERIA */}
      <section className="border-t border-line">
        <div className="container-site py-14 lg:py-20">
          <h2 className="section-title mb-10">Galeria</h2>
          <div className="grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[220px] md:grid-cols-4">
            {gallery.slice(0, 10).map((g, i) => (
              <a key={`${g.src}-${i}`} href={g.src} target="_blank" rel="noreferrer" className={`group relative overflow-hidden rounded-card border border-line ${i === 0 ? 'col-span-2 row-span-2' : ''}`}>
                <Photo src={g.src} alt={g.by ? `Foto de @${g.by}` : `${venue.name} — foto oficial`} />
                <span className="absolute bottom-3 left-3 rounded-sm bg-ink/75 px-2 py-1 text-[9px] font-semibold uppercase tracking-nav text-bone/80">
                  {g.by ? `@${g.by}` : 'Oficial'}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* EVENTOS */}
      <section className="border-t border-line">
        <div className="container-site py-14 lg:py-20">
          <h2 className="section-title mb-10">Próximos eventos</h2>
          {upcoming.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((e) => <EventCard key={e.id} event={e} />)}
            </div>
          ) : (
            <p className="text-sm text-mute">Nenhum evento futuro cadastrado.</p>
          )}
          {past.length > 0 && (
            <div className="mt-12">
              <p className="eyebrow mb-4">Edições anteriores</p>
              <ul className="divide-y divide-line border-y border-line">
                {past.map((e) => {
                  const d = formatEventDate(e.event_date);
                  return (
                    <li key={e.id}>
                      <Link href={`/eventos/${e.slug}`} className="group flex items-center justify-between gap-4 py-4">
                        <span className="text-[12px] text-mute">{d.full}</span>
                        <span className="flex-1 truncate text-sm font-semibold group-hover:text-red-bright">{e.name}</span>
                        <span className="text-[12px] text-mute">{eventPriceText(e, formatBRL)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* MAPA */}
      <section id="mapa" className="scroll-mt-24 border-t border-line">
        <div className="container-site py-14 lg:py-20">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <h2 className="section-title">Localização</h2>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="link-arrow">Abrir no Google Maps <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <VenueMap venues={[venue]} stats={stats ? { [venue.id]: stats } : undefined} className="h-[360px] w-full rounded-card border border-line" zoom={15} />
          <p className="mt-4 text-[12px] text-mute">{venue.address} — {venue.city}/{venue.state}</p>
        </div>
      </section>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 px-5 py-4">
      <dt className="text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</dt>
      <dd className="text-[13px] text-bone/90">{value}</dd>
    </div>
  );
}
