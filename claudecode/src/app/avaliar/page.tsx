'use client';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { Photo } from '@/components/ui/Photo';
import { Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { CATEGORY_LABEL } from '@/lib/format';

export default function AvaliarPage() {
  return (
    <Suspense fallback={<div className="container-site py-20"><Skeleton className="h-96" /></div>}>
      <AvaliarFlow />
    </Suspense>
  );
}

function AvaliarFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const slug = params.get('local') ?? '';
  const { data, user, authReady } = useApp();
  const [q, setQ] = useState('');

  const { data: venues } = useAsync(() => data.listVenues(), [data]);
  const venue = useMemo(() => venues?.find((v) => v.slug === slug) ?? null, [venues, slug]);
  const { data: existing, loading: loadingExisting } = useAsync(
    async () => (venue && user ? data.getMyReview(venue.id) : null),
    [data, venue, user],
  );

  if (!authReady) return <div className="container-site py-20"><Skeleton className="h-96" /></div>;

  if (!user)
    return (
      <section className="container-site flex min-h-[60vh] flex-col items-start justify-center py-20">
        <p className="eyebrow">Avaliar</p>
        <h1 className="mt-4 font-display text-[44px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[64px]">Entre para<br />avaliar a noite.</h1>
        <p className="mt-5 max-w-md text-mute">Avaliações exigem uma conta. Não publicamos avaliações anônimas — é isso que dá credibilidade ao ranking.</p>
        <div className="mt-8 flex gap-3">
          <Link href={`/entrar?next=${encodeURIComponent(`/avaliar${slug ? `?local=${slug}` : ''}`)}`} className="btn-primary">Entrar</Link>
          <Link href={`/entrar?modo=cadastro&next=${encodeURIComponent(`/avaliar${slug ? `?local=${slug}` : ''}`)}`} className="btn-outline">Criar conta</Link>
        </div>
      </section>
    );

  if (!venue) {
    const term = q.trim().toLowerCase();
    const list = (venues ?? []).filter((v) => !term || `${v.name} ${v.city} ${v.neighborhood}`.toLowerCase().includes(term));
    return (
      <section className="container-site py-14 sm:py-20">
        <p className="eyebrow">Passo 1 de 2</p>
        <h1 className="mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[60px]">Onde foi<br />a sua noite?</h1>
        <div className="relative mt-8 max-w-xl">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar boate, festa ou festival" className="field pl-11" autoFocus />
        </div>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((v) => (
            <li key={v.id}>
              <button onClick={() => router.push(`/avaliar?local=${v.slug}`)} className="group flex w-full items-center gap-4 rounded-card border border-line bg-panel p-3 text-left transition-colors hover:border-bone/40">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-[3px]"><Photo src={v.cover_image} alt={v.name} /></div>
                <div className="min-w-0">
                  <p className="truncate font-display text-[15px] font-bold uppercase tracking-tight group-hover:text-blue">{v.name}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-nav text-mute">{CATEGORY_LABEL[v.category]} · {v.city}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="container-site py-14 sm:py-20">
      <Link href="/avaliar" className="text-[11px] font-semibold uppercase tracking-nav text-mute hover:text-bone">← Trocar local</Link>
      <p className="eyebrow mt-8">{existing ? 'Atualizar avaliação' : 'Passo 2 de 2'}</p>
      <h1 className="mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[60px]">{venue.name}</h1>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-nav text-mute">{venue.neighborhood} · {venue.city}</p>
      {existing && <p className="mt-5 max-w-xl text-sm text-mute">Você já avaliou este local. Cada pessoa mantém uma avaliação ativa por estabelecimento — ao salvar, a versão anterior fica no seu histórico.</p>}
      <div className="mt-10">
        {loadingExisting ? (
          <Skeleton className="h-96" />
        ) : (
          <ReviewForm key={existing?.id ?? 'new'} venue={venue} existing={existing ?? null} onSaved={() => router.push(`/boates/${venue.slug}#avaliacoes`)} />
        )}
      </div>
    </section>
  );
}
