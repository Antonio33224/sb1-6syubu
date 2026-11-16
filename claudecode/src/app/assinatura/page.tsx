'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { PlanCards } from '@/components/plus/PlanCards';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { Modal } from '@/components/ui/Controls';
import { Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { formatCents, PLANS } from '@/lib/plus/subscription';

export default function AssinaturaPage() {
  return (
    <Suspense fallback={<div className="container-site py-16"><Skeleton className="h-80" /></div>}>
      <MySubscription />
    </Suspense>
  );
}

function MySubscription() {
  const { user, authReady } = useApp();
  const { plus, access, ready, refresh, isPremium } = usePlus();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const checkout = params.get('checkout');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(checkout === 'success');
  const { data: payments, reload: reloadPayments } = useAsync(() => plus.listMyPayments(), [plus, user?.id, access.subscription?.updated_at]);

  useEffect(() => {
    if (authReady && !user) router.replace('/entrar?next=/assinatura');
  }, [authReady, user, router]);

  // Retorno do checkout: o acesso só é liberado quando o webhook confirmar o pagamento.
  useEffect(() => {
    if (!waiting) return;
    if (isPremium) {
      setWaiting(false);
      toast('Assinatura confirmada. Bem-vindo ao Classify+!');
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      void refresh();
      if (n >= 20) {
        clearInterval(id);
        setWaiting(false);
      }
    }, 3000);
    return () => clearInterval(id);
  }, [waiting, isPremium, refresh, toast]);

  if (!authReady || !user || !ready) return <div className="container-site py-16"><Skeleton className="h-80" /></div>;

  const sub = access.subscription;
  const plan = sub ? PLANS[sub.plan_id] : null;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      reloadPayments();
      toast(ok);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível concluir.', 'error');
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const url = await plus.billingPortalUrl();
      if (url) window.location.assign(url);
      else toast('Portal de cobrança indisponível neste ambiente.', 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao abrir o portal.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="container-site py-12 sm:py-16">
      <div className="flex flex-wrap items-center gap-3">
        <PlusBadge size="md" />
        <p className="eyebrow">Minha assinatura</p>
      </div>
      <h1 className="mt-5 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[56px]">
        {isPremium ? 'Você é Classify+.' : 'Plano gratuito.'}
      </h1>

      {checkout === 'canceled' && (
        <p className="mt-6 rounded-card border border-line px-5 py-4 text-[13px] text-mute">Checkout cancelado. Nenhuma cobrança foi feita.</p>
      )}
      {waiting && (
        <p className="mt-6 flex items-center gap-3 rounded-card border border-blue/40 bg-blue-soft px-5 py-4 text-[13px]">
          <Loader2 className="h-4 w-4 animate-spin text-blue" /> Aguardando a confirmação do pagamento pelo gateway. O acesso é liberado assim que a confirmação chegar.
        </p>
      )}
      {checkout === 'success' && !waiting && !isPremium && (
        <p className="mt-6 rounded-card border border-line px-5 py-4 text-[13px] text-mute">
          Ainda não recebemos a confirmação do pagamento. Isso pode levar alguns minutos — atualize a página mais tarde. Se o pagamento for recusado, nenhuma assinatura é ativada.
        </p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="plus-frame p-7 sm:p-9">
          <div className="grid gap-6 sm:grid-cols-2">
            <Info label="Status" value={access.label} highlight={isPremium} />
            <Info label="Plano" value={plan ? `${plan.name} · ${formatCents(plan.price_cents)}/${plan.interval === 'month' ? 'mês' : 'ano'}` : 'Gratuito'} />
            {sub?.status === 'trialing' && sub.trial_end && <Info label="Teste grátis até" value={formatDate(sub.trial_end)} />}
            {sub && isPremium && (
              <Info
                label={sub.cancel_at_period_end || sub.status === 'canceled' ? 'Acesso até' : sub.status === 'trialing' ? 'Primeira cobrança' : 'Próxima renovação'}
                value={formatDate(access.accessUntil)}
              />
            )}
            {sub && !isPremium && sub.current_period_end && <Info label="Encerrada em" value={formatDate(sub.ended_at ?? sub.current_period_end)} />}
            <Info label="Cobrança" value={sub ? (sub.provider === 'demo' ? 'Demonstração — sem cobrança' : sub.provider === 'stripe' ? 'Cartão via Stripe' : sub.provider) : '—'} />
          </div>

          {sub?.status === 'past_due' && (
            <p className="mt-6 flex gap-3 rounded-card border border-bone/30 px-4 py-3 text-[13px]">
              <AlertTriangle className="h-4 w-4 shrink-0" /> O último pagamento foi recusado. Atualize a forma de pagamento para reativar o acesso.
            </p>
          )}
          {sub?.status === 'trialing' && !sub.cancel_at_period_end && (
            <p className="mt-6 text-[12px] text-mute">Cancele antes de {formatDate(sub.trial_end)} para não ser cobrado.</p>
          )}

          <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6">
            {isPremium && sub?.status !== 'canceled' && (
              <button onClick={() => setConfirmCancel(true)} disabled={busy} className="btn-ghost btn-sm">Cancelar assinatura</button>
            )}
            {isPremium && sub?.status === 'canceled' && (
              <button onClick={() => run(() => plus.resumeSubscription(), 'Renovação reativada.')} disabled={busy} className="btn-primary btn-sm">Manter assinatura</button>
            )}
            {sub?.provider === 'stripe' && (
              <button onClick={openPortal} disabled={busy} className="btn-outline btn-sm"><CreditCard className="h-3.5 w-3.5" /> Gerenciar pagamento <ExternalLink className="h-3 w-3" /></button>
            )}
            {plus.demoExpireNow && isPremium && (
              <button onClick={() => run(() => plus.demoExpireNow!(), 'Período encerrado (simulação de demonstração).')} disabled={busy} className="btn-ghost btn-sm" title="Somente no modo demonstração">
                Demo: encerrar período agora
              </button>
            )}
          </div>
        </div>

        <div className="card p-7">
          <p className="eyebrow">Pagamentos confirmados</p>
          {!payments ? (
            <Skeleton className="mt-4 h-24" />
          ) : payments.length ? (
            <ul className="mt-4 divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3 text-[13px]">
                  <span>{formatDate(p.paid_at ?? p.created_at)}</span>
                  <span className={p.status === 'paid' ? 'text-bone' : 'text-mute'}>
                    {formatCents(p.amount_cents)} · {p.status === 'paid' ? 'pago' : p.status === 'failed' ? 'recusado' : 'estornado'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[13px] text-mute">
              {sub?.provider === 'demo' ? 'O modo demonstração não gera cobranças.' : 'Nenhum pagamento registrado. Faturas aparecem aqui após a confirmação do gateway.'}
            </p>
          )}
          <p className="mt-6 text-[11px] text-mute">Nenhum dado de cartão é armazenado pelo Classify DJ.</p>
        </div>
      </div>

      {!isPremium && (
        <div className="mt-16">
          <p className="eyebrow mb-6">Assine o Classify+</p>
          <PlanCards />
        </div>
      )}

      {isPremium && (
        <div className="mt-12 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[['/meu-ranking', 'Meu Ranking'], ['/descobrir', 'Filtros avançados'], ['/alertas', 'Alertas'], ['/pulso', 'Pulso da Noite'], ['/retrospectiva', 'Retrospectiva'], ['/beneficios', 'Benefícios']].map(([href, label]) => (
            <Link key={href} href={href} className="card p-4 text-center text-[11px] font-bold uppercase tracking-nav transition-colors hover:border-blue hover:text-blue">{label}</Link>
          ))}
        </div>
      )}

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancelar assinatura">
        <p className="text-sm text-mute">
          A renovação será interrompida. Você mantém o acesso Classify+ até <strong className="text-bone">{formatDate(access.accessUntil)}</strong>
          {sub?.status === 'trialing' ? ' e não será cobrado.' : ', o fim do período já pago.'}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setConfirmCancel(false)} className="btn-ghost btn-sm">Voltar</button>
          <button onClick={() => run(() => plus.cancelSubscription(), 'Assinatura cancelada. O acesso continua até o fim do período.')} disabled={busy} className="btn-primary btn-sm">Confirmar cancelamento</button>
        </div>
      </Modal>
    </section>
  );
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-nav text-mute">{label}</p>
      <p className={highlight ? 'mt-1.5 font-display text-[20px] font-bold text-blue' : 'mt-1.5 text-[15px] text-bone'}>{value}</p>
    </div>
  );
}
