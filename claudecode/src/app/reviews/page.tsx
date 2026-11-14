'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { PageIntro, EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { FilterSelect, Tabs } from '@/components/ui/Controls';
import { ReviewCard } from '@/components/cards/ReviewCard';
import { useAsync } from '@/hooks/useAsync';
import type { ReviewSort, VenueCategory } from '@/types';

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'recent', label: 'Recentes' },
  { value: 'best', label: 'Melhores avaliações' },
  { value: 'liked', label: 'Mais curtidas' },
  { value: 'useful', label: 'Mais úteis' },
];

const PAGE = 12;

export default function ReviewsPage() {
  const { data, version } = useApp();
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [city, setCity] = useState('');
  const [venueId, setVenueId] = useState('');
  const [minRating, setMinRating] = useState('0');
  const [category, setCategory] = useState('');
  const [since, setSince] = useState('0');
  const [limit, setLimit] = useState(PAGE);

  const { data: options } = useAsync(async () => {
    const [cities, venues] = await Promise.all([data.listCities(), data.listVenues()]);
    return { cities, venues };
  }, [data]);

  const { data: reviews, loading, error, reload } = useAsync(
    () =>
      data.listReviews({
        sort,
        city: city || undefined,
        venueId: venueId || undefined,
        minRating: Number(minRating) || undefined,
        category: (category || undefined) as VenueCategory | undefined,
        sinceDays: Number(since) || undefined,
      }),
    [data, version, sort, city, venueId, minRating, category, since],
  );

  const venuesForCity = (options?.venues ?? []).filter((v) => !city || v.city === city);

  return (
    <>
      <PageIntro
        eyebrow="Comunidade"
        title="Reviews."
        subtitle="Experiências relatadas por quem esteve na pista. Uma avaliação ativa por pessoa e por casa — sempre com nome e perfil."
        image="/images/crowd-faces.jpg"
      >
        <Link href="/avaliar" className="btn-primary group mt-9">
          Avaliar uma experiência <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </PageIntro>

      <section className="container-site py-10 sm:py-14">
        <Tabs value={sort} onChange={(v) => { setSort(v); setLimit(PAGE); }} items={SORTS} />

        <div className="mt-8 grid gap-4 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-5">
          <FilterSelect label="Cidade" value={city} onChange={(v) => { setCity(v); setVenueId(''); }}
            options={[{ value: '', label: 'Todas' }, ...(options?.cities ?? []).map((c) => ({ value: c.city, label: c.city }))]} />
          <FilterSelect label="Boate / festa" value={venueId} onChange={setVenueId}
            options={[{ value: '', label: 'Todas' }, ...venuesForCity.map((v) => ({ value: v.id, label: v.name }))]} />
          <FilterSelect label="Nota" value={minRating} onChange={setMinRating}
            options={[{ value: '0', label: 'Qualquer' }, { value: '6', label: '6.0+' }, { value: '8', label: '8.0+' }, { value: '9', label: '9.0+' }]} />
          <FilterSelect label="Categoria" value={category} onChange={setCategory}
            options={[{ value: '', label: 'Todas' }, { value: 'boate', label: 'Boates' }, { value: 'festa', label: 'Festas' }, { value: 'festival', label: 'Festivais' }, { value: 'experiencia', label: 'Experiências' }]} />
          <FilterSelect label="Data" value={since} onChange={setSince}
            options={[{ value: '0', label: 'Qualquer data' }, { value: '7', label: 'Últimos 7 dias' }, { value: '30', label: 'Últimos 30 dias' }, { value: '90', label: 'Últimos 90 dias' }]} />
        </div>

        <div className="mt-8">
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading && !reviews ? (
            <div className="grid gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[200px]" />)}</div>
          ) : reviews && reviews.length ? (
            <>
              <p className="mb-5 text-[12px] text-mute">{reviews.length.toLocaleString('pt-BR')} avaliações encontradas</p>
              <div className="grid gap-4 xl:grid-cols-2">
                {reviews.slice(0, limit).map((r) => (
                  <ReviewCard key={`${r.review.id}-${r.likes}-${r.likedByMe}`} item={r} />
                ))}
              </div>
              {limit < reviews.length && (
                <div className="mt-10 flex justify-center">
                  <button onClick={() => setLimit((l) => l + PAGE)} className="btn-outline">Carregar mais</button>
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Nenhuma avaliação encontrada" text="Ajuste os filtros ou seja a primeira pessoa a avaliar." action={{ href: '/avaliar', label: 'Avaliar uma experiência' }} />
          )}
        </div>
      </section>
    </>
  );
}
