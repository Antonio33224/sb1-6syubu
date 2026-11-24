'use client';
import Link from 'next/link';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Camera, Lock, LogOut, MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { Avatar } from '@/components/ui/Avatar';
import { ReviewCard } from '@/components/cards/ReviewCard';
import { VenueCard } from '@/components/cards/VenueCard';
import { EventCard } from '@/components/cards/EventCard';
import { BrandMark } from '@/components/brand/ApprovedSeal';
import { Tabs, FieldError } from '@/components/ui/Controls';
import { EmptyState, PreLaunchTag, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { achievementsFor, levelFor, nextLevel } from '@/lib/levels';
import { formatDate } from '@/lib/format';
import type { Profile } from '@/types';

type Tab = 'avaliacoes' | 'favoritos' | 'conquistas' | 'configuracoes';

export function ProfileView({ profile, own, initialTab = 'avaliacoes' }: { profile: Profile; own: boolean; initialTab?: Tab }) {
  const { data, version, favorites } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: payload } = useAsync(async () => {
    const [stats, reviews, venues, events, allStats] = await Promise.all([
      data.getUserStats(profile.id),
      data.listReviews({ userId: profile.id, sort: 'recent', includeHidden: own }),
      own ? data.listVenues() : Promise.resolve([]),
      own ? data.listEvents() : Promise.resolve([]),
      data.getAllStats(),
    ]);
    return { stats, reviews, venues, events, allStats };
  }, [data, profile.id, version, own]);

  const reviewCount = payload?.stats.review_count ?? 0;
  const level = levelFor(reviewCount);
  const upcoming = nextLevel(reviewCount);
  const favVenues = (payload?.venues ?? []).filter((v) => favorites.some((f) => f.venue_id === v.id));
  const favEvents = (payload?.events ?? []).filter((e) => favorites.some((f) => f.event_id === e.id));
  const cities = new Set((payload?.reviews ?? []).map((r) => r.venue.city)).size;
  const achievements = achievementsFor({ review_count: reviewCount, likes_received: payload?.stats.likes_received ?? 0, cities, favorites: favorites.length });

  const tabs: { value: Tab; label: string }[] = [
    { value: 'avaliacoes', label: 'Histórico de avaliações' },
    ...(own ? [{ value: 'favoritos' as Tab, label: 'Favoritos' }] : []),
    { value: 'conquistas', label: 'Conquistas' },
    ...(own ? [{ value: 'configuracoes' as Tab, label: 'Configurações' }] : []),
  ];

  return (
    <>
      <section className="border-b border-line">
        <div className="container-site grid gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-end">
            <Avatar profile={profile} size={112} className="text-3xl" />
            <div>
              <div className="flex flex-wrap items-center gap-3">
                {level ? <p className="eyebrow text-red-bright">{level.name}</p> : <p className="eyebrow">Novo na comunidade</p>}
                {own && <Link href="/meus-ingressos" className="chip h-7">Meus ingressos</Link>}
              </div>
              <h1 className="mt-3 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[60px]">{profile.full_name || profile.username}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute">
                <span>@{profile.username}</span>
                {profile.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {profile.city}</span>}
                <span>Desde {formatDate(profile.created_at)}</span>
                {profile.is_imported && <PreLaunchTag />}
              </p>
              {profile.bio && <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-bone/80">{profile.bio}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-line rounded-card border border-line">
            <Stat label="Avaliações" value={reviewCount} />
            <Stat label="Curtidas recebidas" value={payload?.stats.likes_received ?? 0} />
          </div>
        </div>
        {upcoming && (
          <div className="container-site pb-10">
            <div className="flex items-center gap-4 text-[11px] text-mute">
              <span className="whitespace-nowrap">Próximo nível: <span className="text-bone">{upcoming.name}</span></span>
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
                <span className="block h-full bg-red transition-all" style={{ width: `${Math.min(100, (reviewCount / upcoming.min) * 100)}%` }} />
              </span>
              <span className="whitespace-nowrap">{reviewCount}/{upcoming.min}</span>
            </div>
          </div>
        )}
      </section>

      <section className="container-site py-10 sm:py-14">
        <Tabs value={tab} onChange={setTab} items={tabs} />
        <div className="mt-8">
          {!payload ? (
            <Skeleton className="h-64" />
          ) : tab === 'avaliacoes' ? (
            payload.reviews.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {payload.reviews.map((r) => (
                  <div key={r.review.id}>
                    <ReviewCard item={r} />
                    {own && (
                      <Link href={`/avaliar?local=${r.venue.slug}`} className="link-arrow mt-3">
                        Editar avaliação e ver versões anteriores
                      </Link>
                    )}
                    {own && r.review.status === 'hidden' && <p className="mt-2 text-[11px] text-mute">Esta avaliação foi ocultada pela moderação e não aparece publicamente.</p>}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma avaliação ainda" text={own ? 'Avalie sua primeira noite e desbloqueie o nível Night Beginner.' : undefined} action={own ? { href: '/avaliar', label: 'Avaliar uma experiência' } : undefined} />
            )
          ) : tab === 'favoritos' ? (
            favVenues.length || favEvents.length ? (
              <div className="flex flex-col gap-12">
                {favVenues.length > 0 && (
                  <div>
                    <p className="eyebrow mb-5">Boates favoritas</p>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{favVenues.map((v) => <VenueCard key={v.id} venue={v} stats={payload.allStats[v.id]} />)}</div>
                  </div>
                )}
                {favEvents.length > 0 && (
                  <div>
                    <p className="eyebrow mb-5">Eventos salvos</p>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{favEvents.map((e) => <EventCard key={e.id} event={e} />)}</div>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState title="Sem favoritos" text="Use o ícone de marcador nas páginas para salvar lugares e eventos." action={{ href: '/descobrir', label: 'Descobrir' }} />
            )
          ) : tab === 'conquistas' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {achievements.map((a) => (
                <div key={a.key} className={clsx('card flex items-center gap-4 p-5', !a.unlocked && 'opacity-40')}>
                  <BrandMark className={clsx('h-12 w-12 shrink-0', a.unlocked ? 'text-red-bright' : 'text-mute')} strokeWidth={2} />
                  <div>
                    <p className="font-display text-[14px] font-bold uppercase tracking-tight">{a.name}</p>
                    <p className="mt-1 text-[11px] text-mute">{a.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Settings profile={profile} />
          )}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-7 py-5 text-center">
      <p className="font-display text-[34px] font-extrabold leading-none text-red-bright">{value.toLocaleString('pt-BR')}</p>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-nav text-mute">{label}</p>
    </div>
  );
}

function Settings({ profile }: { profile: Profile }) {
  const { data, refreshUser } = useApp();
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ full_name: profile.full_name, username: profile.username, city: profile.city ?? '', bio: profile.bio ?? '' });
  const [avatar, setAvatar] = useState(profile.avatar_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await data.updateProfile({ ...form, avatar_url: avatar });
      await refreshUser();
      toast('Perfil atualizado.');
      if (updated.username !== profile.username) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (f: File | undefined) => {
    if (!f) return;
    try {
      setAvatar(await data.uploadImage(f, 'avatars'));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha no envio.', 'error');
    }
  };

  const changePassword = async () => {
    setPwBusy(true);
    try {
      await data.updatePassword(pw);
      setPw('');
      toast('Senha alterada.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao alterar a senha.', 'error');
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <form onSubmit={save} className="card flex flex-col gap-5 p-6 sm:p-8">
        <p className="eyebrow">Informações do perfil</p>
        <div className="flex items-center gap-5">
          <Avatar profile={{ ...profile, avatar_url: avatar }} size={72} />
          <label className="btn-ghost btn-sm cursor-pointer">
            <Camera className="h-3.5 w-3.5" /> Alterar foto
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
          </label>
          {avatar && <button type="button" onClick={() => setAvatar(null)} className="text-[11px] text-mute hover:text-bone">Remover</button>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="pf-name">Nome</label>
            <input id="pf-name" className="field" value={form.full_name} maxLength={80} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor="pf-user">Nome de usuário</label>
            <input id="pf-user" className="field" value={form.username} maxLength={24} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="pf-city">Cidade</label>
          <input id="pf-city" className="field" value={form.city} maxLength={80} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </div>
        <div>
          <label className="field-label" htmlFor="pf-bio">Biografia</label>
          <textarea id="pf-bio" className="field h-auto resize-none py-3" rows={3} maxLength={280} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          <p className="mt-1 text-right text-[11px] text-mute">{form.bio.length}/280</p>
        </div>
        <FieldError message={error} />
        <button disabled={busy} className="btn-primary self-start">{busy ? 'Salvando…' : 'Salvar alterações'}</button>
      </form>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-4 p-6">
          <p className="eyebrow flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Alterar senha</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nova senha (mín. 8)" className="field" autoComplete="new-password" />
          <button onClick={changePassword} disabled={pwBusy || pw.length < 8} className="btn-outline btn-sm self-start">Atualizar senha</button>
        </div>
        <div className="card p-6">
          <p className="eyebrow">Sessão</p>
          <button
            onClick={async () => {
              await data.signOut();
              router.push('/');
            }}
            className="btn-ghost btn-sm mt-4"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}
