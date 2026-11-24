'use client';
import { useApp } from '@/components/providers/AppProviders';
import { RankingCard } from '@/components/cards/RankingCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';

export function RankingsSection() {
  const { data, version } = useApp();
  const { data: rows, loading, error, reload } = useAsync(() => data.getRankings({ limit: 3 }), [data, version]);

  return (
    <section className="container-site py-16 sm:py-20">
      <SectionHeader title="Rankings" href="/rankings" linkLabel="Ver todos" />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !rows ? (
        <div className="grid gap-5 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[4/3.1]" />
          ))}
        </div>
      ) : rows && rows.length ? (
        <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 no-scrollbar sm:mx-0 sm:px-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible">
          {rows.map((row, i) => (
            <div key={row.venue.id} className="w-[84%] shrink-0 snap-start animate-fade-up md:w-auto" style={{ animationDelay: `${i * 90}ms` }}>
              <RankingCard row={row} priority={i === 0} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Ranking em formação" text="Assim que houver avaliações, as melhores experiências aparecem aqui." />
      )}
    </section>
  );
}
