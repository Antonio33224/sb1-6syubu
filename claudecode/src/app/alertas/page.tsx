'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Bell, BellOff, CheckCheck, Mail, Music2, Plus, Smartphone, Trash2, X } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { usePlus } from '@/components/providers/PlusProvider';
import { PremiumGate } from '@/components/plus/PremiumGate';
import { PlusBadge } from '@/components/plus/PlusBadge';
import { Tabs } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { timeAgo } from '@/lib/format';
import type { AlertSettings, ArtistKind } from '@/types';

type Tab = 'notificacoes' | 'favoritos' | 'preferencias';

export default function AlertasPage() {
  return (
    <section className="container-site py-12 sm:py-16">
      <div className="flex items-center gap-3"><PlusBadge size="md" /><p className="eyebrow">Central de alertas</p></div>
      <h1 className="mt-5 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[56px]">Seus favoritos.<br />Seus alertas.</h1>
      <p className="mt-4 max-w-xl text-[14px] text-mute">Siga DJs, artistas, casas, festas e eventos. Quando uma nova data ou atração envolver seus favoritos, avisamos aqui.</p>
      <div className="mt-10">
        <PremiumGate feature="alertas" preview={<PreviewList />} description="Seja avisado quando seu DJ favorito for escalado, quando sua boate favorita anunciar uma festa e às vésperas dos eventos que você salvou.">
          <AlertCenter />
        </PremiumGate>
      </div>
    </section>
  );
}

function PreviewList() {
  return (
    <ul className="divide-y divide-line">
      {['Seu DJ favorito vai tocar neste sábado!', 'Nova festa anunciada na sua boate favorita.', 'Uma nova atração foi adicionada à programação desta semana.'].map((t) => (
        <li key={t} className="flex items-center gap-4 p-6"><Bell className="h-4 w-4 text-blue" /><span className="text-[14px]">{t}</span></li>
      ))}
    </ul>
  );
}

function AlertCenter() {
  const [tab, setTab] = useState<Tab>('notificacoes');
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'notificacoes', label: 'Notificações' },
        { value: 'favoritos', label: 'Seguindo' },
        { value: 'preferencias', label: 'Preferências' },
      ]} />
      <div className="mt-8">
        {tab === 'notificacoes' && <Notifications />}
        {tab === 'favoritos' && <Following />}
        {tab === 'preferencias' && <Preferences />}
      </div>
    </>
  );
}

function Notifications() {
  const { plus, refreshNotifications } = usePlus();
  const toast = useToast();
  const [filter, setFilter] = useState<'todas' | 'nao-lidas'>('todas');
  const { data: list, reload } = useAsync(async () => {
    await plus.syncNotifications();
    return plus.listNotifications();
  }, [plus]);

  const markAll = async () => {
    await plus.markNotificationsRead();
    reload();
    void refreshNotifications();
  };
  const open = async (id: string) => {
    await plus.markNotificationsRead([id]);
    void refreshNotifications();
  };
  const remove = async (id: string) => {
    try {
      await plus.deleteNotification(id);
      reload();
      void refreshNotifications();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao remover.', 'error');
    }
  };

  if (!list) return <Skeleton className="h-64" />;
  const shown = filter === 'nao-lidas' ? list.filter((n) => !n.read_at) : list;
  const unread = list.filter((n) => !n.read_at).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button onClick={() => setFilter('todas')} className={clsx('chip h-8', filter === 'todas' && 'chip-active')}>Histórico ({list.length})</button>
          <button onClick={() => setFilter('nao-lidas')} className={clsx('chip h-8', filter === 'nao-lidas' && 'chip-active')}>Não lidas ({unread})</button>
        </div>
        {unread > 0 && <button onClick={markAll} className="btn-ghost btn-sm"><CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas</button>}
      </div>
      {shown.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {shown.map((n) => (
            <li key={n.id} className={clsx('flex items-start gap-4 p-5 transition-colors', !n.read_at && 'bg-blue-soft')}>
              <span className={clsx('mt-1 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-line' : 'bg-blue')} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{n.title}</p>
                <p className="mt-1 text-[13px] text-mute">{n.body}</p>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-mute">
                  <span>{timeAgo(n.created_at)}</span>
                  {n.link && <Link href={n.link} onClick={() => open(n.id)} className="font-semibold text-blue hover:text-bone">Ver evento</Link>}
                  {n.email_status === 'not_configured' && <span title="Preferência registrada; envio por e-mail ainda não integrado">E-mail: não integrado</span>}
                </div>
              </div>
              <button onClick={() => remove(n.id)} aria-label="Remover notificação" className="text-mute hover:text-bone"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={filter === 'nao-lidas' ? 'Tudo lido' : 'Nenhum alerta ainda'} text="Siga DJs e favorite casas e eventos. Quando houver novidades nas próximas datas cadastradas, elas aparecem aqui." />
      )}
    </div>
  );
}

function Following() {
  const { data, favorites, user } = useApp();
  const { plus, refreshNotifications } = usePlus();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ArtistKind>('dj');
  const { data: artists, reload } = useAsync(() => plus.listArtistFavorites(), [plus]);
  const { data: base } = useAsync(async () => {
    const [venues, events] = await Promise.all([data.listVenues(), data.listEvents({ upcomingOnly: true })]);
    return { venues, events };
  }, [data]);
  // Sugestões de DJs a partir do line-up cadastrado (dados reais).
  const suggestions = [...new Set((base?.events ?? []).flatMap((e) => e.dj_names))].filter((d) => !/a anunciar/i.test(d)).sort();

  const toggle = async (n: string, k: ArtistKind) => {
    try {
      const now = await plus.toggleArtistFavorite(n, k);
      reload();
      setName('');
      toast(now ? `Seguindo ${n}.` : `Você deixou de seguir ${n}.`);
      if (now) void refreshNotifications();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  const favVenues = (base?.venues ?? []).filter((v) => favorites.some((f) => f.venue_id === v.id));
  const favEvents = (base?.events ?? []).filter((e) => favorites.some((f) => f.event_id === e.id));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="card p-6 sm:p-7">
        <p className="eyebrow flex items-center gap-2"><Music2 className="h-3.5 w-3.5" /> DJs e artistas</p>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void toggle(name, kind); }} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input value={name} onChange={(e) => setName(e.target.value)} list="dj-suggestions" placeholder="Nome do DJ ou artista" maxLength={80} className="field h-11 flex-1" />
          <datalist id="dj-suggestions">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          <select value={kind} onChange={(e) => setKind(e.target.value as ArtistKind)} className="field h-11 sm:w-32" aria-label="Tipo">
            <option value="dj" className="bg-ink">DJ</option>
            <option value="artist" className="bg-ink">Artista</option>
          </select>
          <button className="btn-primary btn-sm h-11"><Plus className="h-3.5 w-3.5" /> Seguir</button>
        </form>
        {!artists ? <Skeleton className="mt-5 h-20" /> : artists.length ? (
          <ul className="mt-5 flex flex-wrap gap-2">
            {artists.map((a) => (
              <li key={a.id} className="chip chip-active gap-2 pr-2">
                {a.name} <span className="text-mute">· {a.kind === 'dj' ? 'DJ' : 'Artista'}</span>
                <button onClick={() => toggle(a.name, a.kind)} aria-label={`Deixar de seguir ${a.name}`} className="ml-1 text-mute hover:text-bone"><X className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-5 text-[13px] text-mute">Você ainda não segue nenhum DJ ou artista. Também é possível seguir pelo line-up de qualquer evento.</p>}
      </div>

      <div className="card p-6 sm:p-7">
        <p className="eyebrow">Casas, festas e eventos</p>
        <p className="mt-2 text-[12px] text-mute">Use o marcador nas páginas de casas e eventos. Seus favoritos geram alertas de novas datas e lembretes.</p>
        {!user || !base ? <Skeleton className="mt-5 h-20" /> : (
          <ul className="mt-5 flex flex-col divide-y divide-line">
            {favVenues.map((v) => (
              <li key={v.id} className="flex justify-between py-3 text-[13px]"><Link href={`/boates/${v.slug}`} className="hover:text-blue">{v.name}</Link><span className="text-mute">{v.category === 'festa' ? 'Festa' : 'Casa'}</span></li>
            ))}
            {favEvents.map((e) => (
              <li key={e.id} className="flex justify-between py-3 text-[13px]"><Link href={`/eventos/${e.slug}`} className="hover:text-blue">{e.name}</Link><span className="text-mute">Evento</span></li>
            ))}
            {!favVenues.length && !favEvents.length && <li className="py-3 text-[13px] text-mute">Nenhum favorito ainda. <Link href="/descobrir" className="text-blue">Descobrir</Link></li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function Preferences() {
  const { plus } = usePlus();
  const toast = useToast();
  const [alerts, setAlerts] = useState<AlertSettings | null>(null);
  useEffect(() => {
    plus.getPreferences().then((p) => setAlerts(p.alerts)).catch(() => {});
  }, [plus]);
  if (!alerts) return <Skeleton className="h-64" />;

  const update = async (patch: Partial<AlertSettings>) => {
    const next = { ...alerts, ...patch };
    setAlerts(next);
    try {
      await plus.savePreferences({ alerts: next });
    } catch (err) {
      setAlerts(alerts);
      toast(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card divide-y divide-line">
        <Toggle icon={alerts.enabled ? Bell : BellOff} label="Alertas ativados" desc="Desative para pausar todas as notificações." checked={alerts.enabled} onChange={(v) => update({ enabled: v })} />
        <Toggle label="DJs e artistas que sigo" desc="Quando forem escalados em um evento futuro." checked={alerts.artists} disabled={!alerts.enabled} onChange={(v) => update({ artists: v })} />
        <Toggle label="Casas e festas favoritas" desc="Novas datas e atrações anunciadas." checked={alerts.venues} disabled={!alerts.enabled} onChange={(v) => update({ venues: v })} />
        <Toggle label="Eventos salvos" desc="Lembrete nos 3 dias anteriores." checked={alerts.events} disabled={!alerts.enabled} onChange={(v) => update({ events: v })} />
      </div>
      <div className="card divide-y divide-line">
        <Toggle icon={Mail} label="Receber por e-mail" desc="Preferência salva. O envio por e-mail ainda não está integrado — por enquanto os alertas ficam nesta central." checked={alerts.email} disabled={!alerts.enabled} onChange={(v) => update({ email: v })} />
        <Toggle icon={Smartphone} label="Receber notificações push" desc="Preferência salva. O push ainda não está integrado; nenhuma permissão do navegador é solicitada." checked={alerts.push} disabled={!alerts.enabled} onChange={(v) => update({ push: v })} />
        <div className="p-5 text-[12px] text-mute"><Trash2 className="mr-2 inline h-3.5 w-3.5" />Você pode remover notificações individualmente no histórico.</div>
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange, disabled, icon: Icon }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon?: typeof Bell }) {
  return (
    <label className={clsx('flex cursor-pointer items-start justify-between gap-6 p-5', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        <span className="flex items-center gap-2 text-[14px] font-semibold">{Icon && <Icon className="h-4 w-4 text-blue" />}{label}</span>
        <span className="mt-1 block text-[12px] text-mute">{desc}</span>
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={clsx('relative mt-1 h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-blue bg-blue' : 'border-line bg-panel')}>
        <span className={clsx('absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all', checked ? 'left-[22px] bg-ink' : 'left-0.5 bg-mute')} />
      </span>
    </label>
  );
}
