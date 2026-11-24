'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useApp } from '@/components/providers/AppProviders';
import { EmptyState, Skeleton } from '@/components/ui/States';

/**
 * Libera o painel para admin_festa / super_admin (não suspensos).
 * É só conveniência de interface: a RLS e as funções do banco conferem de novo.
 */
export function ProducerGate({ children, next = '/produtor' }: { children: ReactNode; next?: string }) {
  const { user, authReady } = useApp();
  if (!authReady) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!user)
    return (
      <section className="container-site flex min-h-[60vh] flex-col items-start justify-center py-20">
        <p className="eyebrow">Painel do produtor</p>
        <h1 className="mt-4 font-display text-[44px] font-extrabold uppercase leading-[0.95] tracking-tight">Venda ingressos<br />das suas festas.</h1>
        <p className="mt-5 max-w-md text-mute">Entre com seu celular (código por SMS) ou com sua conta Google.</p>
        <Link href={`/entrar?next=${encodeURIComponent(next)}`} className="btn-primary mt-8">Entrar</Link>
      </section>
    );
  if (user.suspended_at)
    return (
      <section className="container-site py-24">
        <EmptyState title="Conta de produtor suspensa" text="Fale com a equipe NO OFF pelo contato do rodapé para mais informações." action={{ href: '/contato', label: 'Fale conosco' }} />
      </section>
    );
  if (user.role !== 'admin_festa' && user.role !== 'super_admin')
    return (
      <section className="container-site flex min-h-[60vh] flex-col items-start justify-center py-20">
        <p className="eyebrow">Painel do produtor</p>
        <h1 className="mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight">Quer vender<br />na NO OFF?</h1>
        <p className="mt-5 max-w-md text-mute">Sua conta ainda não é de produtor. Fale com a equipe e informe o @ da sua conta (<strong className="text-bone">@{user.username}</strong>) para liberarmos o acesso.</p>
        <Link href="/contato" className="btn-primary mt-8">Fale conosco</Link>
      </section>
    );
  return <>{children}</>;
}
