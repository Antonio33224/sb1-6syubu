import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ARTICLES } from '@/data/editorial';
import { Photo } from '@/components/ui/Photo';
import { formatDate } from '@/lib/format';

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = ARTICLES.find((x) => x.slug === slug);
  return { title: a?.title ?? 'Editorial', description: a?.excerpt };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();
  const more = ARTICLES.filter((a) => a.slug !== slug).slice(0, 3);

  return (
    <article>
      <header className="relative isolate overflow-hidden border-b border-line">
        <div className="absolute inset-0 -z-10">
          <Photo src={article.cover} alt={article.title} zoom={false} priority />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/30" />
        </div>
        <div className="container-site flex min-h-[460px] flex-col justify-end py-14">
          <Link href="/editorial" className="eyebrow hover:text-bone">← Editorial</Link>
          <p className="eyebrow mt-8 text-red-bright">{article.kicker}</p>
          <h1 className="mt-4 max-w-4xl font-display text-[44px] font-extrabold uppercase leading-[0.92] tracking-tight sm:text-[72px]">{article.title}</h1>
          <p className="mt-6 text-[11px] uppercase tracking-nav text-mute">{article.author} · {formatDate(article.date)} · {article.readMinutes} min</p>
        </div>
      </header>
      <div className="container-site py-14 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <p className="font-display text-[22px] font-semibold leading-snug text-bone sm:text-[26px]">{article.excerpt}</p>
          {article.body.map((p, i) => (
            <p key={i} className="mt-7 text-[17px] leading-[1.75] text-bone/80">{p}</p>
          ))}
          <p className="mt-12 border-t border-line pt-6 text-[11px] text-mute">Texto editorial de demonstração.</p>
        </div>
        <div className="mt-20">
          <p className="eyebrow mb-6">Continue lendo</p>
          <div className="grid gap-5 sm:grid-cols-3">
            {more.map((a) => (
              <Link key={a.slug} href={`/editorial/${a.slug}`} className="group block">
                <div className="aspect-[16/10] overflow-hidden rounded-card border border-line"><Photo src={a.cover} alt={a.title} /></div>
                <p className="mt-4 font-display text-[16px] font-bold uppercase tracking-tight group-hover:text-red-bright">{a.title}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
