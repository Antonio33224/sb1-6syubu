'use client';
import Link from 'next/link';
import { clsx } from 'clsx';
import { useApp } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { showThirdPartyAds } from '@/lib/plus/subscription';

/**
 * Espaço para BANNERS PUBLICITÁRIOS DE TERCEIROS.
 *  - Assinantes Classify+ nunca veem este espaço.
 *  - Nenhuma rede de anúncios está integrada: em produção o espaço só é
 *    renderizado quando NEXT_PUBLIC_ADS_ENABLED=true (contêiner pronto para o
 *    script do provedor). No modo demonstração aparece um marcador identificado.
 *  - NÃO é usado para cards "INDICADO" (curadoria), que aparecem para todos.
 */
export function AdSlot({ id, className }: { id: string; className?: string }) {
  const { data } = useApp();
  const { ready, isPremium } = usePlus();
  const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED === 'true';
  if (!ready || !showThirdPartyAds({ isPremium, adsEnabled, demoMode: data.mode === 'demo' })) return null;

  return (
    <aside aria-label="Publicidade" className={clsx('container-site', className)}>
      <div data-ad-slot={id} className="relative flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line bg-ink-2 px-5 py-6 text-center">
        <span className="absolute left-3 top-2 text-[8px] font-bold uppercase tracking-wide2 text-mute/70">Publicidade</span>
        {!adsEnabled && (
          <>
            <p className="text-[12px] text-mute">Espaço para banner de terceiros — demonstração, nenhum anúncio real é carregado.</p>
            <Link href="/classify-plus" className="text-[10px] font-bold uppercase tracking-nav text-blue hover:text-bone">
              Assinantes Classify+ não veem banners
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
