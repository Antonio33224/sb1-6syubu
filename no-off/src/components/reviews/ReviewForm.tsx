'use client';
import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { Photo } from '@/components/ui/Photo';
import { Score } from '@/components/ui/Score';
import { computeOverall } from '@/lib/rating';
import { COMMENT_MAX, MAX_REVIEW_PHOTOS } from '@/lib/moderation';
import { formatDate, isoDate } from '@/lib/format';
import { CRITERIA, type CriteriaScores, type ReviewRevision, type Venue, type VenueReview } from '@/types';

const DEFAULT_SCORES = Object.fromEntries(CRITERIA.map((c) => [c.key, 8])) as CriteriaScores;

export function ReviewForm({ venue, existing, onSaved }: { venue: Venue; existing: VenueReview | null; onSaved: (r: VenueReview) => void }) {
  const { data, bump } = useApp();
  const toast = useToast();
  const [scores, setScores] = useState<CriteriaScores>(() =>
    existing ? (Object.fromEntries(CRITERIA.map((c) => [c.key, existing[c.key]])) as CriteriaScores) : DEFAULT_SCORES,
  );
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [date, setDate] = useState(existing?.experience_date ?? isoDate(new Date()));
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ReviewRevision[]>([]);

  // Pré-visualização apenas: a nota oficial é recalculada no servidor.
  const overall = useMemo(() => computeOverall(scores), [scores]);

  useEffect(() => {
    if (existing) data.listRevisions(existing.id).then(setRevisions).catch(() => setRevisions([]));
  }, [data, existing]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const slots = MAX_REVIEW_PHOTOS - photos.length;
    if (slots <= 0) return toast(`Máximo de ${MAX_REVIEW_PHOTOS} fotos.`, 'error');
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, slots)) urls.push(await data.uploadImage(f, 'review-photos'));
      setPhotos((p) => [...p, ...urls]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha no envio da foto.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await data.upsertReview({ venue_id: venue.id, ...scores, comment, experience_date: date || null, photos });
      bump();
      toast(existing ? 'Avaliação atualizada.' : 'Avaliação publicada. Obrigado por avaliar a noite.');
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-8">
        <fieldset>
          <legend className="eyebrow mb-5">Notas por critério (0 a 10)</legend>
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {CRITERIA.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 py-4 sm:grid-cols-[200px_1fr_48px]">
                <label htmlFor={c.key} className="text-[13px] font-semibold">
                  {c.label}
                  <span className="ml-2 text-[10px] font-normal text-mute">peso {Math.round(c.weight * 100)}%</span>
                </label>
                <span className="font-display text-xl font-bold text-red-bright sm:order-last sm:text-right">{scores[c.key]}</span>
                <input
                  id={c.key}
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={scores[c.key]}
                  onChange={(e) => setScores((s) => ({ ...s, [c.key]: Number(e.target.value) }))}
                  className="col-span-2 w-full accent-[#E10600] sm:col-span-1"
                  aria-valuetext={`${scores[c.key]} de 10`}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="comment" className="field-label">Conte como foi a experiência</label>
          <textarea
            id="comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={COMMENT_MAX}
            rows={6}
            placeholder="Som, público, filas, bar, atendimento… seja específico e respeitoso."
            className="field h-auto resize-y py-3 leading-relaxed"
          />
          <p className="mt-2 text-right text-[11px] text-mute">{comment.length}/{COMMENT_MAX}</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="date" className="field-label">Data da experiência</label>
            <input id="date" type="date" max={isoDate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} className="field" />
          </div>
          <div>
            <span className="field-label">Fotos ({photos.length}/{MAX_REVIEW_PHOTOS})</span>
            <label className={clsx('field flex cursor-pointer items-center gap-3 text-mute hover:border-bone/40', (uploading || photos.length >= MAX_REVIEW_PHOTOS) && 'pointer-events-none opacity-50')}>
              <ImagePlus className="h-4 w-4" />
              {uploading ? 'Enviando…' : 'Adicionar fotos'}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
            </label>
          </div>
        </div>
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {photos.map((src, i) => (
              <div key={i} className="relative h-20 w-28 overflow-hidden rounded-[4px] border border-line">
                <Photo src={src} alt={`Foto ${i + 1}`} zoom={false} />
                <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-bone" aria-label="Remover foto">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <FieldError message={error} />
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="card p-6">
          <p className="eyebrow">Nota geral estimada</p>
          <Score value={overall} size="xl" className="mt-4" />
          <p className="mt-4 text-[12px] leading-relaxed text-mute">Média ponderada dos 7 critérios. A nota oficial é recalculada pelo servidor ao publicar.</p>
          <button type="submit" disabled={saving || uploading} className="btn-primary mt-7 w-full">
            {saving ? 'Salvando…' : existing ? 'Atualizar avaliação' : 'Publicar avaliação'}
          </button>
          {existing && <DeleteReview reviewId={existing.id} />}
        </div>
        {revisions.length > 0 && (
          <div className="card mt-4 p-6">
            <p className="eyebrow mb-4">Versões anteriores</p>
            <ul className="flex flex-col gap-3">
              {revisions.map((r) => (
                <li key={r.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-mute">{formatDate(r.created_at)}</span>
                    <Score value={r.overall_rating} size="xs" />
                  </div>
                  {r.comment && <p className="mt-1.5 line-clamp-2 text-[12px] text-bone/70">{r.comment}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </form>
  );
}

function DeleteReview({ reviewId }: { reviewId: string }) {
  const { data, bump } = useApp();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const remove = async () => {
    try {
      await data.deleteMyReview(reviewId);
      bump();
      toast('Avaliação removida.');
      location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erro ao remover.', 'error');
    }
  };
  return confirm ? (
    <div className="mt-4 rounded-card border border-line p-4 text-[12px]">
      <p className="text-bone">Remover sua avaliação? Esta ação não pode ser desfeita.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={remove} className="btn-outline btn-sm">Remover</button>
        <button type="button" onClick={() => setConfirm(false)} className="btn-ghost btn-sm">Cancelar</button>
      </div>
    </div>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="mt-4 inline-flex w-full items-center justify-center gap-2 text-[11px] font-semibold text-mute hover:text-bone">
      <Trash2 className="h-3.5 w-3.5" /> Remover minha avaliação
    </button>
  );
}
