'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clsx } from 'clsx';
import { Bookmark, Flag, Heart, Share2 } from 'lucide-react';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { Modal } from '@/components/ui/Controls';

function useRequireLogin() {
  const { user } = useApp();
  const router = useRouter();
  return () => {
    if (user) return true;
    router.push(`/entrar?next=${encodeURIComponent(location.pathname + location.search)}`);
    return false;
  };
}

export function FavoriteButton({ venueId, eventId, variant = 'button', className }: { venueId?: string; eventId?: string; variant?: 'button' | 'icon'; className?: string }) {
  const { data, favorites, refreshFavorites } = useApp();
  const toast = useToast();
  const requireLogin = useRequireLogin();
  const [busy, setBusy] = useState(false);
  const active = favorites.some((f) => (venueId ? f.venue_id === venueId : f.event_id === eventId));

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!requireLogin()) return;
    setBusy(true);
    try {
      const now = await data.toggleFavorite({ venueId, eventId });
      await refreshFavorites();
      toast(now ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao favoritar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'icon')
    return (
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={active}
        aria-label={active ? 'Remover dos favoritos' : 'Favoritar'}
        className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-sm transition-colors',
          active ? 'border-blue bg-blue text-ink' : 'border-bone/30 bg-ink/50 text-bone hover:border-bone',
          className,
        )}
      >
        <Bookmark className="h-4 w-4" fill={active ? 'currentColor' : 'none'} />
      </button>
    );

  return (
    <button onClick={toggle} disabled={busy} aria-pressed={active} className={clsx(active ? 'btn-primary' : 'btn-outline', className)}>
      <Bookmark className="h-4 w-4" fill={active ? 'currentColor' : 'none'} />
      {active ? 'Favoritado' : 'Favoritar'}
    </button>
  );
}

export function ShareButton({ title, className }: { title: string; className?: string }) {
  const toast = useToast();
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copiado.');
      }
    } catch {
      /* compartilhamento cancelado */
    }
  };
  return (
    <button onClick={share} className={clsx('btn-ghost', className)}>
      <Share2 className="h-4 w-4" /> Compartilhar
    </button>
  );
}

export function LikeButton({ reviewId, likes, liked, authorId, onChange }: { reviewId: string; likes: number; liked: boolean; authorId: string; onChange?: () => void }) {
  const { data, user, bump } = useApp();
  const toast = useToast();
  const requireLogin = useRequireLogin();
  const [state, setState] = useState({ likes, liked });
  const [busy, setBusy] = useState(false);
  const own = user?.id === authorId;

  const toggle = async () => {
    if (!requireLogin()) return;
    if (own) return toast('Você não pode curtir a própria avaliação.', 'error');
    setBusy(true);
    const optimistic = { liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) };
    setState(optimistic);
    try {
      await data.toggleLike(reviewId);
      onChange?.();
      bump();
    } catch (err) {
      setState(state);
      toast(err instanceof Error ? err.message : 'Erro ao curtir.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={state.liked}
      className={clsx(
        'inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors',
        state.liked ? 'text-blue' : 'text-mute hover:text-bone',
        own && 'cursor-default opacity-60',
      )}
      title={own ? 'Sua avaliação' : 'Curtir'}
    >
      <Heart className="h-4 w-4" fill={state.liked ? 'currentColor' : 'none'} />
      {state.likes}
    </button>
  );
}

const REASONS = ['Conteúdo ofensivo ou discriminatório', 'Spam ou propaganda', 'Avaliação falsa / de concorrente', 'Não é sobre este local'];

export function ReportButton({ reviewId, authorId }: { reviewId: string; authorId: string }) {
  const { data, user } = useApp();
  const toast = useToast();
  const requireLogin = useRequireLogin();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]!);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  if (user?.id === authorId) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await data.reportReview(reviewId, details.trim() ? `${reason}: ${details.trim()}` : reason);
      toast('Denúncia enviada para moderação.');
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erro ao denunciar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => requireLogin() && setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-mute transition-colors hover:text-bone"
        aria-label="Denunciar avaliação"
      >
        <Flag className="h-3.5 w-3.5" /> Denunciar
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Denunciar avaliação">
        <p className="text-sm text-mute">A denúncia é analisada pela moderação. Avaliações legítimas não são removidas a pedido de estabelecimentos.</p>
        <div className="mt-5 flex flex-col gap-2">
          {REASONS.map((r) => (
            <label key={r} className={clsx('flex cursor-pointer items-center gap-3 rounded-card border px-4 py-3 text-sm transition-colors', reason === r ? 'border-blue text-bone' : 'border-line text-mute')}>
              <input type="radio" name="reason" className="accent-[#83A9F5]" checked={reason === r} onChange={() => setReason(r)} />
              {r}
            </label>
          ))}
        </div>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={300} placeholder="Detalhes (opcional)" className="field mt-4 h-24 resize-none py-3" />
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn-primary btn-sm">Enviar denúncia</button>
        </div>
      </Modal>
    </>
  );
}
