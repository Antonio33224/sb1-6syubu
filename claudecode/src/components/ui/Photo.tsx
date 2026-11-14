/* eslint-disable @next/next/no-img-element */
import { clsx } from 'clsx';

/**
 * Fotografia editorial com tratamento P&B de alto contraste.
 * Usa <img> nativo para aceitar imagens locais, do Supabase Storage e data URLs (modo demo).
 */
export function Photo({
  src,
  alt,
  className,
  zoom = true,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  zoom?: boolean;
  priority?: boolean;
}) {
  return (
    <img
      src={src || '/images/dance-floor.jpg'}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={clsx('photo h-full w-full object-cover', zoom && 'img-zoom', className)}
    />
  );
}
