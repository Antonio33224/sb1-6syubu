import Link from 'next/link';
import { ArrowRight, Star } from 'lucide-react';

export function CommunityCTA() {
  return (
    <section className="border-t border-line py-16 sm:py-24">
      <div className="container-site">
        <div className="group relative isolate overflow-hidden rounded-card border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/confetti-dark.jpg" alt="" loading="lazy" decoding="async" className="photo img-zoom absolute inset-0 -z-10 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/80 to-ink/30" />
          <div className="absolute -bottom-32 -left-20 -z-10 h-80 w-80 rounded-full bg-red/30 blur-[100px]" />
          <div className="flex flex-col gap-10 px-6 py-14 sm:px-12 sm:py-20 lg:flex-row lg:items-end lg:justify-between lg:px-16 lg:py-24">
            <div className="max-w-3xl">
              <p className="flex items-center gap-3 text-[10px] font-extrabold uppercase tracking-wide2 text-red-bright">
                <span className="h-px w-8 bg-red/60" /> Comunidade NO OFF
              </p>
              <h2 className="mt-5 font-display text-[44px] font-extrabold uppercase leading-[0.86] tracking-[-0.04em] sm:text-[80px] lg:text-[104px]">
                Você decide
                <br />
                o <span className="text-red-bright">ranking.</span>
              </h2>
              <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-bone/75 sm:text-[17px]">
                Compartilhe sua experiência, avalie as melhores boates e ajude a definir onde realmente vale a pena sair.
              </p>
            </div>
            <Link href="/avaliar" className="btn-primary group h-[56px] shrink-0 self-start px-9 lg:self-end">
              <Star className="h-4 w-4" /> Fazer minha avaliação
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
