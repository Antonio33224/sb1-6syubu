import type { Venue } from '@/types';

export interface DiscoverCategory {
  slug: string;
  label: string;
  image: string;
  blurb: string;
  match: (v: Venue) => boolean;
}

const hasStyle = (v: Venue, styles: string[]) => v.music_styles.some((s) => styles.includes(s));
const text = (v: Venue) => `${v.name} ${v.description} ${v.neighborhood}`.toLowerCase();

/**
 * Categorias de descoberta. O filtro usa apenas dados cadastrados
 * (estilos, tipo e descrição do local) — uma categoria sem locais
 * correspondentes aparece como "em breve", nunca com conteúdo inventado.
 */
export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  { slug: 'eletronica', label: 'Música eletrônica', image: '/images/lasers.jpg', blurb: 'House, techno e pistas que vão até o sol nascer.', match: (v) => hasStyle(v, ['Eletrônica', 'Techno', 'House']) },
  { slug: 'funk', label: 'Funk', image: '/images/crowd-faces.jpg', blurb: 'Bailes, MCs e a pista mais democrática da noite.', match: (v) => hasStyle(v, ['Funk']) },
  { slug: 'sertanejo', label: 'Sertanejo', image: '/images/guitarist-beams.jpg', blurb: 'Modão, universitário e shows ao vivo.', match: (v) => hasStyle(v, ['Sertanejo']) },
  { slug: 'hip-hop', label: 'Hip-hop', image: '/images/microphone.jpg', blurb: 'Rap, trap e batalhas de MCs.', match: (v) => hasStyle(v, ['Hip-hop', 'Trap']) },
  { slug: 'open-format', label: 'Open format', image: '/images/dance-floor.jpg', blurb: 'Do pop ao funk na mesma noite.', match: (v) => hasStyle(v, ['Open format']) },
  { slug: 'festivais', label: 'Festivais', image: '/images/festival-stage.jpg', blurb: 'Palcos gigantes, line-ups extensos.', match: (v) => v.category === 'festival' },
  { slug: 'rooftops', label: 'Rooftops', image: '/images/rooftop-party.jpg', blurb: 'Terraços, vista e DJ sets ao entardecer.', match: (v) => /rooftop|terraço|cobertura/.test(text(v)) },
  { slug: 'beach-clubs', label: 'Beach clubs', image: '/images/confetti-arena.jpg', blurb: 'Pé na areia, mar e música.', match: (v) => /beach|praia|areia/.test(text(v)) },
];

export const findCategory = (slug: string | null | undefined) => DISCOVER_CATEGORIES.find((c) => c.slug === slug) ?? null;
