'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ArrowRight, Lock } from 'lucide-react';
import { usePlus } from '@/components/providers/PlusProvider';
import { useApp } from '@/components/providers/AppProviders';
import { Skeleton } from '@/components/ui/States';
import { PLUS_FEATURES } from '@/lib/plus/subscription';
import type { PlusFeature } from '@/types';
import { PlusBadge } from './PlusBadge';

/**
 * Renderiza `children` apenas para assinantes. Para os demais, mostra a prévia
 * (desfocada e não interativa) e o convite para assinar.
 */
export function PremiumGate({
  feature,
  children,
  preview,
  title,
  description,
}: {
  feature: PlusFeature;
  children: ReactNode;
  preview?: ReactNode;
  title?: string;
  description?: string;
}) {
  const { ready, isPremium } = usePlus();
  if (!ready) return <Skeleton className="h-[420px]" />;
  if (isPremium) return <>{children}</>;
  return <Paywall feature={feature} preview={preview} title={title} description={description} />;
}

export function Paywall({ feature, preview, title, description, compact }: { feature: PlusFeature; preview?: ReactNode; title?: string; description?: string; compact?: boolean }) {
  const { user } = useApp();
  const { access } = usePlus();
  const label = PLUS_FEATURES[feature].label;
  const expired = access.label === 'Expirada' || access.label === 'Pagamento recusado';
  return (
    <div className="relative overflow-hidden rounded-card border border-line">
      {preview && (
        <div aria-hidden="true" className="pointer-events-none select-none opacity-60 blur-[3px] saturate-50" inert>
          {preview}
        </div>
      )}
      <div className={clsx('plus-glow flex flex-col items-start justify-center gap-5 p-7 sm:p-10', preview ? 'absolute inset-0 bg-gradient-to-t from-ink via-ink/90 to-ink/40' : 'bg-ink-2', compact && 'p-6 sm:p-7')}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-blue/40 text-blue">
            <Lock className="h-4 w-4" />
          </span>
          <PlusBadge />
        </div>
        <div className="max-w-lg">
          <p className="font-display text-[24px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[32px]">{title ?? `${label} é exclusivo do Classify+`}</p>
          <p className="mt-3 text-[14px] leading-relaxed text-mute">
            {expired
              ? `Sua assinatura está "${access.label.toLowerCase()}". Renove para voltar a usar ${label}.`
              : description ?? 'Assine para personalizar a noite de acordo com o que importa para você. Avaliar, enviar fotos e consultar rankings continuam gratuitos.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/classify-plus#planos" className="btn-primary">
            Quero ser Classify+ <ArrowRight className="h-4 w-4" />
          </Link>
          {!user && (
            <Link href={`/entrar?next=${encodeURIComponent('/classify-plus')}`} className="btn-ghost">
              Já assino — entrar
            </Link>
          )}
          {expired && (
            <Link href="/assinatura" className="btn-ghost">Minha assinatura</Link>
          )}
        </div>
      </div>
    </div>
  );
}
