'use client';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Plus } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { ProducerGate } from '@/components/producer/ProducerGate';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { brlCents, formatDate } from '@/lib/format';
import { producerService } from '@/services/ticket-service';

const STATUS_LABEL: Record<string, string> = { draft: 'Rascunho', published: 'Publicada', cancelled: 'Cancelada', suspended: 'Suspensa' };
const VIS_LABEL: Record<string, string> = { hidden: 'Oculta', partial: 'Info. ocultas', visible: 'Visível' };

export default function ProdutorPage() {
  return (
    <ProducerGate>
      <Overview />
    </ProducerGate>
  );
}

function Overview() {
  const { version } = useApp();
  const { data, error, reload } = useAsync(() => producerService.overview(), [version]);
  const totals = (data ?? []).reduce((a, e) => ({ sold: a.sold + e.sold, gross: a.gross + e.gross }), { sold: 0, gross: 0 });

  return (
    <section className="container-site py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Painel do produtor</p>
          <h1 className="mt-3 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[48px]">Minhas festas.</h1>
        </div>
        <Link href="/produtor/festas/nova" className="btn-primary"><Plus className="h-4 w-4" /> Nova festa</Link>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
        <Stat label="Festas" value={data ? String(data.length) : '—'} />
        <Stat label="Ingressos vendidos" value={data ? String(totals.sold) : '—'} />
        <Stat label="Faturamento bruto" value={data ? brlCents(totals.gross) : '—'} />
      </div>

      <div className="mt-10">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton className="h-64" />
        ) : data.length === 0 ? (
          <EmptyState title="Nenhuma festa ainda" text="Crie sua primeira festa, configure os lotes e publique." action={{ href: '/produtor/festas/nova', label: 'Criar festa' }} />
        ) : (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-line text-[10px] uppercase tracking-nav text-mute">
                <tr><th className="p-4">Data</th><th className="p-4">Festa</th><th className="p-4">Status</th><th className="p-4">Vendidos</th><th className="p-4">Ocupação</th><th className="p-4">Bruto</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((e) => (
                  <tr key={e.event_id} className="hover:bg-panel">
                    <td className="p-4 text-mute">{formatDate(e.event_date)}</td>
                    <td className="p-4"><Link href={`/produtor/festas/${e.event_id}`} className="font-semibold hover:text-red-bright">{e.name}</Link></td>
                    <td className="p-4">
                      <span className={clsx('text-[10px] font-bold uppercase tracking-nav', e.status === 'published' ? 'text-red-bright' : 'text-mute')}>{STATUS_LABEL[e.status] ?? e.status}</span>
                      {e.visibility !== 'visible' && <span className="ml-2 text-[10px] uppercase tracking-nav text-mute">· {VIS_LABEL[e.visibility]}</span>}
                    </td>
                    <td className="p-4">{e.sold}</td>
                    <td className="p-4 text-mute">{e.capacity ? `${Math.round((e.sold / e.capacity) * 100)}%` : '—'}</td>
                    <td className="p-4 font-semibold">{brlCents(e.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink p-6">
      <p className="font-display text-[30px] font-extrabold leading-none sm:text-[38px]">{value}</p>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
    </div>
  );
}
