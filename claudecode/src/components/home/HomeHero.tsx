'use client';
import Link from 'next/link';
import { ArrowRight, ChevronDown, MapPin } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { weekWindow } from '@/lib/week';
import type { HomeData } from './HomeView';

export function HomeHero({ city, onCity, data, scoped }: { city: string; onCity: (c: string) => void; data: HomeData | null; scoped: HomeData | null }) {
  const week = weekWindow();
  const weekEvents = scoped ? scoped.events.filter((e) => e.event_date <= week.to).length : null;
  const reviewCount = scoped ? scoped.venues.reduce((n, v) => n + (scoped.stats[v.id]?.review_count ?? 0), 0) : null;
  const cityLabel = city ? `${city}${data?.cities.find((c) => c.city === city) ? ` — ${data.cities.find((c) => c.city === city)!.state}` : ''}` : 'Todas as cidades';

  return (
    <section className="relative isolate overflow-hidden border-b border-line">
      {/* Fotografia de fundo + camadas de luz */}
      <div className="absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/hero-crowd.jpg"
          alt="Multidão em festa eletrônica sob lasers e luzes de palco"
          fetchPriority="high"
          className="photo h-full w-full object-cover object-[60%_40%] motion-safe:animate-[hero-zoom_22s_ease-out_both]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/5 to-ink/50" />
        <div className="absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-blue/20 mix-blend-screen blur-[120px]" />
        <div className="absolute right-[8%] top-[12%] hidden h-[340px] w-[340px] rounded-full bg-blue/10 blur-[100px] lg:block" />
        {/* feixes de laser sutis */}
        <div className="absolute inset-0 opacity-40 [background:repeating-linear-gradient(115deg,transparent_0_120px,rgba(131,169,245,0.06)_120px_121px)]" />
      </div>

      <div className="container-site flex min-h-[calc(100svh-68px)] flex-col justify-center py-16 sm:min-h-[720px] lg:min-h-[min(90vh,880px)]">
        {/* Cidade selecionada */}
        <div className="animate-fade-up">
          <label className="group relative inline-flex h-10 items-center gap-2 rounded-full border border-blue/40 bg-ink/60 pl-4 pr-10 backdrop-blur-md transition-colors hover:border-blue">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue" />
            </span>
            <MapPin className="h-3.5 w-3.5 text-blue" />
            <span className="text-[10px] font-bold uppercase tracking-nav text-bone">{cityLabel}</span>
            <ChevronDown className="pointer-events-none absolute right-3.5 h-3.5 w-3.5 text-mute" />
            <select
              aria-label="Selecionar cidade"
              value={city}
              onChange={(e) => onCity(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="" className="bg-ink">Todas as cidades</option>
              {(data?.cities ?? []).map((c) => (
                <option key={c.city} value={c.city} className="bg-ink">{c.city} — {c.state}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-10 animate-fade-up [animation-delay:60ms]">
          <Logo href={null} size="xl" />
        </div>

        <h1 className="mt-6 max-w-[1100px] animate-fade-up font-display text-[clamp(46px,13.5vw,72px)] font-extrabold uppercase leading-[0.86] tracking-[-0.04em] [animation-delay:120ms] sm:text-[104px] lg:text-[128px] xl:text-[148px]">
          Your night.
          <br />
          Your <span className="bg-gradient-to-r from-blue to-bone bg-clip-text text-transparent">ranking.</span>
        </h1>

        <p className="mt-8 max-w-[440px] animate-fade-up text-[16px] leading-relaxed text-bone/75 [animation-delay:200ms] sm:text-[18px]">
          Descubra as melhores experiências da vida noturna.
        </p>

        <div className="mt-10 flex animate-fade-up flex-wrap gap-3 [animation-delay:280ms]">
          <Link href="/descobrir" className="btn-primary group h-[54px] px-8">
            Explorar boates
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.2} />
          </Link>
          <Link href="/rankings" className="btn-outline h-[54px] bg-ink/30 px-8 backdrop-blur-sm">
            Ver rankings
          </Link>
        </div>

        {/* Números reais da plataforma (calculados dos dados) */}
        <dl className="mt-14 grid max-w-[640px] animate-fade-up grid-cols-3 border-t border-bone/15 pt-6 [animation-delay:360ms]">
          <HeroStat label="Lugares avaliados" value={scoped ? scoped.venues.length : null} />
          <HeroStat label="Avaliações" value={reviewCount} />
          <HeroStat label="Eventos nesta semana" value={weekEvents} />
        </dl>
      </div>

      <p className="vertical-text absolute right-5 top-1/2 hidden -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wide2 text-bone/50 sm:right-8 md:block lg:right-14">
        We rate the night.
      </p>
      <a href="#eventos-destaque" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[9px] font-bold uppercase tracking-wide2 text-bone/50 transition-colors hover:text-blue md:flex">
        Role
        <span className="h-10 w-px overflow-hidden bg-bone/20">
          <span className="block h-1/2 w-full animate-[scroll-cue_1.8s_ease-in-out_infinite] bg-blue" />
        </span>
      </a>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col-reverse pr-4">
      <dt className="mt-2 text-[9px] font-semibold uppercase tracking-nav text-mute sm:text-[10px]">{label}</dt>
      <dd className="font-display text-[28px] font-extrabold leading-none tracking-tight text-bone sm:text-[36px]">
        {value === null ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-panel" /> : value.toLocaleString('pt-BR')}
      </dd>
    </div>
  );
}
