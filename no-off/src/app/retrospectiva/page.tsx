'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { useApp } from '@/components/providers/AppProviders';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';

/** Retrospectiva básica: números reais das avaliações do próprio usuário no ano. */
export default function RetrospectivaPage() {
  const { user, authReady, data, version } = useApp();
  const router = useRouter();
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    if (authReady && !user) router.replace('/entrar?next=/retrospectiva');
  }, [authReady, user, router]);

  const { data: reviews } = useAsync(async () => (user ? data.listReviews({ userId: user.id, sort: 'recent' }) : null), [data, user?.id, version]);

  const years = useMemo(() => {
    if (!reviews) return [];
    return [...new Set(reviews.map((r) => new Date(r.review.experience_date ?? r.review.created_at).getFullYear()))].sort((a, b) => b - a);
  }, [reviews]);
  const current = year ?? years[0] ?? new Date().getFullYear();

  const stats = useMemo(() => {
    if (!reviews) return null;
    const list = reviews.filter((r) => new Date(r.review.experience_date ?? r.review.created_at).getFullYear() === current);
    return {
      reviews: list.length,
      venues: new Set(list.map((r) => r.venue.id)).size,
      photos: list.reduce((n, r) => n + r.review.photos.length, 0),
      cities: new Set(list.map((r) => r.venue.city)).size,
    };
  }, [reviews, current]);

  if (!authReady || !user || !stats) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;

  return (
    <>
      <section className="border-b border-line">
        <div className="container-site py-14 sm:py-20">
          <p className="eyebrow">Minha retrospectiva</p>
          <h1 className="mt-6 font-display text-[48px] font-extrabold uppercase leading-[0.88] tracking-tight sm:text-[96px]">
            Minha noite<br /><span className="text-red-bright">em {current}.</span>
          </h1>
          {years.length > 1 && (
            <div className="mt-8 flex flex-wrap gap-2">
              {years.map((y) => <button key={y} onClick={() => setYear(y)} className={clsx('chip', y === current && 'chip-active')}>{y}</button>)}
            </div>
          )}
        </div>
      </section>
      <section className="container-site py-10 sm:py-14">
        {stats.reviews === 0 ? (
          <EmptyState title={`Nenhuma avaliação em ${current}`} text="Sua retrospectiva é montada só com as suas avaliações reais." action={{ href: '/avaliar', label: 'Avaliar uma experiência' }} />
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
            <Big n={stats.venues} label={stats.venues === 1 ? 'Casa avaliada' : 'Casas avaliadas'} />
            <Big n={stats.reviews} label={stats.reviews === 1 ? 'Avaliação publicada' : 'Avaliações publicadas'} />
            <Big n={stats.photos} label={stats.photos === 1 ? 'Foto enviada' : 'Fotos enviadas'} />
            <Big n={stats.cities} label={stats.cities === 1 ? 'Cidade' : 'Cidades'} />
          </div>
        )}
      </section>
    </>
  );
}

function Big({ n, label }: { n: number; label: string }) {
  return (
    <div className="bg-ink p-6 sm:p-8">
      <p className="font-display text-[44px] font-extrabold leading-none text-red-bright sm:text-[60px]">{n}</p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
    </div>
  );
}
