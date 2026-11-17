'use client';
import Link from 'next/link';
import { useApp } from '@/components/providers/AppProviders';

/** Indicador permanente de modo demonstração (dados fictícios). */
export function DemoBadge() {
  const { data } = useApp();
  if (data.mode !== 'demo') return null;
  return (
    <Link
      href="/sobre#demonstracao"
      className="fixed bottom-4 left-4 z-40 hidden items-center gap-2 rounded-full border border-line bg-ink/90 px-3.5 py-2 text-[9px] font-bold uppercase tracking-nav text-mute backdrop-blur transition-colors hover:border-blue hover:text-bone sm:inline-flex"
      title="Sem Supabase configurado: dados fictícios salvos apenas neste navegador"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-blue" />
      Modo demonstração · dados fictícios
    </Link>
  );
}
