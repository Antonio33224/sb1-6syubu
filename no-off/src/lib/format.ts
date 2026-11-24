const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatEventDate(date: string): { day: string; month: string; weekday: string; full: string } {
  const d = new Date(`${date}T12:00:00`);
  return {
    day: String(d.getDate()).padStart(2, '0'),
    month: MONTHS[d.getMonth()].toUpperCase(),
    weekday: WEEKDAYS[d.getDay()].toUpperCase(),
    full: `${WEEKDAYS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  return formatDate(iso);
}

export const formatBRL = (v: number | null | undefined) =>
  v === null || v === undefined
    ? 'Gratuito'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: v % 1 ? 2 : 0 });

export const priceLabel = (n: number) => `R${'$'.repeat(Math.max(1, Math.min(4, n)))}`;

export const CATEGORY_LABEL: Record<string, string> = {
  boate: 'Boate',
  festa: 'Festa',
  festival: 'Festival',
  experiencia: 'Experiência',
};

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Chave estável de DJ/artista ("JOSÉ  Pérez" → "jose-perez"), usada no filtro ?dj= da agenda. */
export const djKey = (name: string) => slugify(name).slice(0, 120);

/** Valor em reais sempre com centavos (checkout, relatórios). */
export const brlCents = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
