import { clsx } from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-card bg-panel', className)} />;
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: { href: string; label: string } }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-display text-lg font-bold uppercase tracking-tight">{title}</p>
      {text && <p className="mt-2 max-w-md text-sm text-mute">{text}</p>}
      {action && (
        <Link href={action.href} className="btn-outline btn-sm mt-6">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card px-6 py-10 text-center">
      <p className="text-sm text-bone">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost btn-sm mt-4">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

/** Avaliação/perfil real coletado antes do lançamento e importado pela equipe. */
export function PreLaunchTag({ className }: { className?: string }) {
  return (
    <span
      title="Avaliação real coletada antes do lançamento do app e publicada com autorização do autor"
      className={clsx('inline-flex items-center rounded-sm border border-line px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-nav text-mute', className)}
    >
      Coletada no pré-lançamento
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      title="Conteúdo demonstrativo — dado fictício"
      className={clsx('inline-flex items-center rounded-sm border border-line px-1.5 py-[1px] text-[8px] font-bold uppercase tracking-nav text-mute', className)}
    >
      Demo
    </span>
  );
}

export function PageIntro({ eyebrow, title, subtitle, children, image }: { eyebrow?: string; title: ReactNode; subtitle?: string; children?: ReactNode; image?: string }) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      {image && (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" className="photo h-full w-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-transparent" />
        </div>
      )}
      <div className="container-site relative py-16 sm:py-24">
        {eyebrow && <p className="eyebrow mb-5 animate-fade-up">{eyebrow}</p>}
        <h1 className="max-w-4xl animate-fade-up font-display text-[42px] font-extrabold uppercase leading-[0.92] tracking-tight text-balance sm:text-[64px] lg:text-[80px]">
          {title}
        </h1>
        {subtitle && <p className="mt-6 max-w-xl animate-fade-up text-[15px] leading-relaxed text-mute [animation-delay:120ms]">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}
