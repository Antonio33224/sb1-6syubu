import type { ReactNode } from 'react';

export function StaticPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <>
      <section className="border-b border-line">
        <div className="container-site py-16 sm:py-24">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-5 font-display text-[44px] font-extrabold uppercase leading-[0.92] tracking-tight sm:text-[72px]">{title}</h1>
        </div>
      </section>
      <section className="container-site py-14 sm:py-20">
        <div className="max-w-2xl space-y-6 text-[16px] leading-[1.75] text-bone/80 [&_h2]:mt-12 [&_h2]:font-display [&_h2]:text-[20px] [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-tight [&_h2]:text-bone [&_a]:text-blue">
          {children}
        </div>
      </section>
    </>
  );
}
