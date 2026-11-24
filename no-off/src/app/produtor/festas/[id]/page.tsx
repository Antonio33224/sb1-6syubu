'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { ProducerGate } from '@/components/producer/ProducerGate';
import { EventForm } from '@/components/producer/EventForm';
import { BatchesPanel } from '@/components/producer/BatchesPanel';
import { VipPanel } from '@/components/producer/VipPanel';
import { CheckinPanel } from '@/components/producer/CheckinPanel';
import { DashboardPanel } from '@/components/producer/DashboardPanel';
import { ReportPanel } from '@/components/producer/ReportPanel';
import { Tabs } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { producerService } from '@/services/ticket-service';

type Tab = 'vendas' | 'dados' | 'lotes' | 'vip' | 'checkin' | 'relatorio';
const TABS: { value: Tab; label: string }[] = [
  { value: 'vendas', label: 'Vendas' },
  { value: 'dados', label: 'Dados da festa' },
  { value: 'lotes', label: 'Lotes' },
  { value: 'vip', label: 'Lista VIP' },
  { value: 'checkin', label: 'Check-in' },
  { value: 'relatorio', label: 'Relatório' },
];

export default function ProducerEventPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ProducerGate next={`/produtor/festas/${id}`}>
      {id === 'nova' ? <NewEvent /> : <ManageEvent id={id} />}
    </ProducerGate>
  );
}

function NewEvent() {
  return (
    <section className="container-site py-12 sm:py-16">
      <Link href="/produtor" className="link-arrow"><ArrowLeft className="h-3.5 w-3.5" /> Minhas festas</Link>
      <h1 className="mt-6 font-display text-[36px] font-extrabold uppercase leading-none tracking-tight sm:text-[48px]">Nova festa.</h1>
      <p className="mt-4 max-w-xl text-[13px] text-mute">Salve como rascunho, crie os lotes e publique quando estiver tudo pronto.</p>
      <div className="mt-10"><EventForm /></div>
    </section>
  );
}

function ManageEvent({ id }: { id: string }) {
  const params = useSearchParams();
  const { version } = useApp();
  const initial = (params.get('tab') as Tab) || 'vendas';
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.value === initial) ? initial : 'vendas');
  const { data: event, loading, reload } = useAsync(() => producerService.getEvent(id), [id, version]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', url.toString());
  }, [tab]);

  if (loading && !event) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!event) return <div className="container-site py-24"><EmptyState title="Festa não encontrada" text="Ela não existe ou não pertence à sua conta." action={{ href: '/produtor', label: 'Minhas festas' }} /></div>;

  return (
    <section className="container-site py-12 sm:py-16">
      <Link href="/produtor" className="link-arrow"><ArrowLeft className="h-3.5 w-3.5" /> Minhas festas</Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{formatDate(event.event_date)} · {event.start_time} · {event.status === 'published' ? 'Publicada' : event.status === 'draft' ? 'Rascunho' : event.status === 'suspended' ? 'Suspensa pela NO OFF' : 'Cancelada'}</p>
          <h1 className="mt-3 font-display text-[32px] font-extrabold uppercase leading-none tracking-tight sm:text-[44px]">{event.name}</h1>
          {event.visibility !== 'visible' && (
            <p className="mt-3 text-[12px] text-mute">
              Visibilidade definida pela NO OFF: <strong className="text-bone">{event.visibility === 'hidden' ? 'Oculta' : 'Visível com informações ocultas'}</strong>
            </p>
          )}
        </div>
        {event.status === 'published' && (
          <Link href={`/eventos/${event.hide_name && event.visibility === 'partial' ? event.id : event.slug}`} target="_blank" className="btn-ghost btn-sm"><ExternalLink className="h-3.5 w-3.5" /> Ver página pública</Link>
        )}
      </div>
      <Tabs className="mt-8" value={tab} onChange={setTab} items={TABS} />
      <div className="mt-8">
        {tab === 'vendas' && <DashboardPanel eventId={id} />}
        {tab === 'dados' && <EventForm initial={event} onSaved={reload} />}
        {tab === 'lotes' && <BatchesPanel eventId={id} />}
        {tab === 'vip' && <VipPanel event={event} />}
        {tab === 'checkin' && <CheckinPanel eventId={id} />}
        {tab === 'relatorio' && <ReportPanel eventId={id} />}
      </div>
    </section>
  );
}
