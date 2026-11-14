import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { ARTICLES } from '@/data/editorial';
import { Photo } from '@/components/ui/Photo';
import { PageIntro } from '@/components/ui/States';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Editorial' };

export default function EditorialPage() {
  const [lead, ...rest] = ARTICLES;
  return (
    <>
      <PageIntro eyebrow="Editorial" title={<>Notes from<br />the night.</>} subtitle="Cena, cultura, guias e a metodologia por trás dos rankings." />
      <section className="container-site py-14 sm:py-20">
        {lead && (
          <Link href={`/editorial/${lead.slug}`} className="group grid overflow-hidden rounded-card border border-line bg-panel lg:grid-cols-[1.4fr_1fr]">
            <div className="relative aspect-[16/10] overflow-hidden lg:aspect-auto lg:min-h-[440px]">
              <Photo src={lead.cover} alt={lead.title} priority />
            </div>
            <div className="flex flex-col justify-end p-7 sm:p-10">
              <p className="eyebrow text-blue">{lead.kicker}</p>
              <h2 className="mt-4 font-display text-[32px] font-extrabold uppercase leading-[0.95] tracking-tight transition-colors group-hover:text-blue sm:text-[44px]">{lead.title}</h2>
              <p className="mt-5 text-[15px] leading-relaxed text-mute">{lead.excerpt}</p>
              <p className="mt-8 text-[11px] uppercase tracking-nav text-mute">{formatDate(lead.date)} · {lead.readMinutes} min de leitura</p>
            </div>
          </Link>
        )}
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((a) => (
            <Link key={a.slug} href={`/editorial/${a.slug}`} className="group block overflow-hidden rounded-card border border-line bg-panel">
              <div className="aspect-[16/10] overflow-hidden"><Photo src={a.cover} alt={a.title} /></div>
              <div className="p-6">
                <p className="eyebrow">{a.kicker}</p>
                <h3 className="mt-3 font-display text-[20px] font-extrabold uppercase leading-tight tracking-tight transition-colors group-hover:text-blue">{a.title}</h3>
                <p className="mt-3 line-clamp-2 text-[13px] text-mute">{a.excerpt}</p>
                <span className="link-arrow mt-6">Ler <ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-10 text-[11px] text-mute">Textos editoriais de demonstração.</p>
      </section>
    </>
  );
}
