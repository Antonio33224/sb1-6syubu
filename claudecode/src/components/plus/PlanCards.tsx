'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { useAsync } from '@/hooks/useAsync';
import { annualMonthlyEquivalentCents, annualSavingsRatio, formatCents, PLANS } from '@/lib/plus/subscription';
import type { PlanId } from '@/types';

const COMMON = ['Meu Ranking personalizado', 'Filtros avançados completos', 'Alertas de DJs, artistas e casas', 'Pulso da Noite', 'Retrospectiva completa', 'Benefícios em casas parceiras', 'Sem banners de terceiros'];

export function PlanCards() {
  const { user } = useApp();
  const { plus, access, isPremium, refresh } = usePlus();
  const toast = useToast();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const { data: billing } = useAsync(() => plus.billingStatus(), [plus]);
  const savings = Math.round(annualSavingsRatio() * 100);

  const subscribe = async (plan: PlanId) => {
    setBusy(plan);
    try {
      const res = await plus.startCheckout(plan);
      if (res.kind === 'redirect') {
        window.location.assign(res.url); // checkout seguro hospedado pelo gateway
        return;
      }
      await refresh();
      toast('Assinatura de demonstração ativada — nenhuma cobrança foi feita.');
      window.location.assign('/assinatura?status=demo');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível iniciar a assinatura.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const cta = (plan: PlanId) => {
    if (!user)
      return (
        <Link href={`/entrar?next=${encodeURIComponent('/classify-plus#planos')}`} className={plan === 'annual' ? 'btn-primary w-full' : 'btn-outline w-full'}>
          Entrar para assinar
        </Link>
      );
    if (isPremium)
      return <Link href="/assinatura" className="btn-ghost w-full">Você já é Classify+ · gerenciar</Link>;
    if (billing && !billing.configured)
      return <p className="rounded-card border border-line px-4 py-3 text-center text-[12px] text-mute">Assinaturas em breve. {billing.message}</p>;
    const trial = plan === 'monthly' && access.trialEligible && PLANS.monthly.trial_days > 0;
    return (
      <button onClick={() => subscribe(plan)} disabled={!!busy || !billing} className={plan === 'annual' ? 'btn-primary w-full' : 'btn-outline w-full'}>
        {busy === plan ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {trial ? 'Começar teste grátis de 7 dias' : 'Quero ser Classify+'}
      </button>
    );
  };

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-2">
        {/* Mensal */}
        <div className="card flex flex-col p-7 sm:p-9">
          <p className="eyebrow">Mensal</p>
          <p className="mt-5 flex items-baseline gap-1 font-display">
            <span className="text-[48px] font-extrabold leading-none tracking-tight">{formatCents(PLANS.monthly.price_cents)}</span>
            <span className="text-[14px] font-semibold text-mute">/mês</span>
          </p>
          <ul className="mt-7 flex flex-1 flex-col gap-3 text-[13px] text-bone/85">
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> Acesso completo às funcionalidades premium</li>
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> Cobrança mensal, cancele quando quiser</li>
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> Teste grátis de {PLANS.monthly.trial_days} dias para usuários elegíveis</li>
          </ul>
          <div className="mt-8">{cta('monthly')}</div>
          {user && !isPremium && !access.trialEligible && <p className="mt-3 text-center text-[11px] text-mute">O teste grátis já foi utilizado nesta conta.</p>}
        </div>

        {/* Anual — destaque */}
        <div className="plus-frame plus-glow relative flex flex-col p-7 sm:p-9">
          <span className="absolute -top-3 left-7 rounded-full bg-blue px-3 py-1 text-[9px] font-extrabold uppercase tracking-wide2 text-ink">Melhor custo-benefício</span>
          <p className="eyebrow text-blue">Anual</p>
          <p className="mt-5 flex items-baseline gap-1 font-display">
            <span className="text-[48px] font-extrabold leading-none tracking-tight">{formatCents(PLANS.annual.price_cents)}</span>
            <span className="text-[14px] font-semibold text-mute">/ano</span>
          </p>
          <p className="mt-2 text-[13px] text-bone">equivale a ~{formatCents(annualMonthlyEquivalentCents())}/mês · economia aproximada de {savings}%</p>
          <ul className="mt-7 flex flex-1 flex-col gap-3 text-[13px] text-bone/85">
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> Acesso completo às funcionalidades premium</li>
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> Pagamento único anual</li>
            <li className="flex gap-3"><Check className="h-4 w-4 shrink-0 text-blue" /> {savings}% mais barato que 12 mensalidades ({formatCents(PLANS.monthly.price_cents * 12)})</li>
          </ul>
          <div className="mt-8">{cta('annual')}</div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 text-center text-[11px] text-mute">
        <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-blue" /> Pagamento processado em ambiente seguro do gateway. O Classify DJ não armazena dados de cartão.</p>
        {billing?.provider === 'demo' && <p className="text-bone/80">{billing.message}</p>}
        <p>Inclui: {COMMON.join(' · ')}.</p>
      </div>
    </div>
  );
}
