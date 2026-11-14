import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      {/* Fotografia panorâmica à direita com transição escura para a esquerda */}
      <div className="absolute inset-y-0 right-0 -z-10 w-full lg:w-[74%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/hero-crowd.jpg"
          alt="Multidão em festa eletrônica sob luzes de palco"
          className="photo h-full w-full animate-fade-in object-cover object-[60%_42%]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/70 to-ink/0 lg:via-ink/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/10 to-ink/30" />
      </div>
      <div className="absolute inset-0 -z-10 bg-ink/40 lg:hidden" />

      <div className="container-site relative flex min-h-[calc(100svh-68px)] items-center py-20 sm:min-h-[640px] lg:min-h-[min(86vh,820px)]">
        <div className="max-w-[920px]">
          <div className="animate-fade-up">
            <Logo href={null} size="xl" />
          </div>
          <h1
            className="mt-7 animate-fade-up font-display text-[clamp(44px,14vw,64px)] font-extrabold uppercase leading-[0.88] tracking-[-0.035em] [animation-delay:90ms] sm:text-[92px] lg:text-[112px] xl:text-[128px]"
          >
            We rate
            <br />
            the night.
          </h1>
          <p className="mt-8 max-w-[380px] animate-fade-up text-[15px] leading-relaxed text-bone/70 [animation-delay:180ms] sm:text-base">
            Descubra, avalie e classifique as melhores festas, eventos e experiências noturnas.
          </p>
          <div className="mt-10 animate-fade-up [animation-delay:260ms]">
            <Link href="/rankings" className="btn-primary group h-[52px] px-8">
              Ver rankings
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.2} />
            </Link>
          </div>
        </div>

        {/* Texto vertical lateral */}
        <p className="vertical-text absolute right-5 top-1/2 hidden -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide2 text-bone/55 sm:right-8 md:block lg:right-14">
          We rate the night.
        </p>
      </div>
    </section>
  );
}
