/**
 * Hero "cinematográfico" da home — regras puras (sem React), testadas em tests/hero.test.ts.
 *
 * Só trabalha com dados já mascarados pelo banco (view public_events e
 * função public_event_batches): festa oculta nunca chega aqui, e os campos
 * ocultos são trocados pelos textos de HERO_TEXT.
 */
import { formatEventDate } from '@/lib/format';
import { WEEKDAY_LONG, WEEKDAY_SHORT, byDateTime, weekdayOf } from '@/lib/week';
import type { EventWithVenue, PublicBatch } from '@/types';

export const HERO_MAX = 5;
/** Duração de cada festa na tela (autoplay, barra de progresso e Ken Burns). */
export const SLIDE_MS = 7000;
/** A contagem "Lote vira em" só aparece quando a virada é em menos de 48h. */
export const COUNTDOWN_WINDOW_MS = 48 * 60 * 60 * 1000;
export const HERO_FALLBACK_IMAGE = '/images/hero-crowd.jpg';

export const HERO_TEXT = {
  name: 'Revelado em breve',
  location: 'Local em breve',
  price: 'Em breve',
  empty: 'Novas noites em breve',
  buy: 'Comprar ingresso',
  notify: 'Me avise',
  waitlist: 'Lista de espera',
  soldOut: 'Esgotado',
} as const;

/** Evento de entrada. `featured` ainda não existe no banco; quando existir, já entra na ordenação. */
export type HeroSource = EventWithVenue & { featured?: boolean };

export type HeroMode = 'buy' | 'notify' | 'waitlist';

export interface HeroLot {
  /** Nome do lote atual (ex.: "2º lote"). */
  label: string | null;
  price: number | null;
  /** Fim do lote à venda (ISO) — base da contagem regressiva. */
  endsAt: string | null;
  soldOut: boolean;
}

export interface HeroSlide {
  id: string;
  href: string;
  title: string;
  subtitle: string | null;
  image: string;
  /** "SÁBADO 12 DEZ · 23H" */
  when: string;
  /** "SÁB 12" */
  chapterDay: string;
  place: string;
  /** "São Paulo · SP" */
  placeSub: string;
  mode: HeroMode;
  ringText: string;
  lotLabel: string | null;
  priceText: string;
  ariaBuy: string;
  endsAt: string | null;
}

/** Venda aberta = lotes NO OFF ou link externo de ingressos, em data futura. */
export function isOnSale(e: Pick<HeroSource, 'event_date' | 'has_tickets' | 'ticket_url'>, today: string): boolean {
  return e.event_date >= today && (Boolean(e.has_tickets) || Boolean(e.ticket_url));
}

/** Até 5 festas: destaque primeiro, depois data e horário. */
export function selectHeroEvents<T extends HeroSource>(events: T[], today: string, max = HERO_MAX): T[] {
  return events
    .filter((e) => isOnSale(e, today))
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || byDateTime(a, b))
    .slice(0, max);
}

const OPEN_STATES = new Set<PublicBatch['state']>(['upcoming', 'waiting', 'paused', 'reserved_out']);

function pickBatch(list: PublicBatch[]): PublicBatch | undefined {
  return [...list].sort(
    (a, b) =>
      Number(b.ticket_type === 'pista') - Number(a.ticket_type === 'pista') ||
      (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY),
  )[0];
}

/**
 * Lote atual a partir de public_event_batches.
 * - prefere um lote à venda (Pista primeiro, depois o mais barato);
 * - sem lote à venda, mostra o próximo que ainda pode abrir;
 * - nada à venda nem para abrir → esgotado (lista de espera).
 * Sem lotes (link externo) → null: o hero usa o preço do evento.
 */
export function currentLot(batches: PublicBatch[] | null | undefined): HeroLot | null {
  if (!batches || batches.length === 0) return null;
  const onSale = pickBatch(batches.filter((b) => b.state === 'on_sale'));
  if (onSale) return { label: onSale.name || null, price: onSale.price, endsAt: onSale.sales_end, soldOut: false };
  const later = pickBatch(batches.filter((b) => OPEN_STATES.has(b.state)));
  if (later) return { label: later.name || null, price: later.price, endsAt: null, soldOut: false };
  return { label: null, price: null, endsAt: null, soldOut: true };
}

/** "HH:MM:SS" até a virada do lote, ou null fora da janela de 48h / já virado. */
export function countdownText(endsAt: string | null | undefined, now: number): string | null {
  if (!endsAt) return null;
  const diff = Date.parse(endsAt) - now;
  if (!Number.isFinite(diff) || diff <= 0 || diff >= COUNTDOWN_WINDOW_MS) return null;
  const total = Math.floor(diff / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Preço curto do círculo: "R$80", "R$42,50", "GRÁTIS". */
export function compactPrice(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v === 0) return 'Grátis';
  return `R$${v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "23:00" → "23H", "23:30" → "23H30". */
export function shortTime(t: string): string {
  const [hh = '', mm = '00'] = (t || '').split(':');
  if (!hh) return '';
  return mm === '00' ? `${hh}H` : `${hh}H${mm}`;
}

/** Divide o nome em 2 linhas com comprimentos equilibrados (celular). */
export function splitBalanced(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text.trim()];
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const score = Math.max(words.slice(0, i).join(' ').length, words.slice(i).join(' ').length);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/**
 * Tamanho de fonte que faz um texto medido em `basePx` caber em `containerPx`
 * (letter-spacing em em escala junto). Margem de 3% contra arredondamentos e kerning.
 */
export function fitFontSize(containerPx: number, measuredPx: number, basePx: number, maxPx = Number.POSITIVE_INFINITY): number {
  if (!(containerPx > 0) || !(measuredPx > 0)) return Math.min(basePx, maxPx);
  const size = (containerPx / measuredPx) * basePx * 0.97;
  return Math.max(8, Math.floor(Math.min(size, maxPx) * 100) / 100);
}

function subtitleOf(e: HeroSource): string | null {
  const source = e.music_styles.length ? e.music_styles : e.dj_names;
  const parts = source.map((s) => s.trim()).filter(Boolean).slice(0, 2);
  return parts.length ? parts.join(' · ') : null;
}

/** Monta o que o slide exibe, respeitando nome/local/preço ocultos e esgotado. */
export function toSlide(e: HeroSource, lot: HeroLot | null): HeroSlide {
  const hidden = e.hidden ?? { name: false, price: false, location: false, capacity: false };
  const title = hidden.name ? HERO_TEXT.name : e.name;
  const d = formatEventDate(e.event_date);
  const longDay = (WEEKDAY_LONG[weekdayOf(e.event_date)] ?? '').split('-')[0]!.toUpperCase();
  const time = shortTime(e.start_time);
  const city = e.city || e.venue.city;
  const state = e.state || e.venue.state;

  const base = {
    id: e.id,
    href: `/eventos/${e.slug}`,
    title,
    subtitle: subtitleOf(e),
    image: e.cover_image || e.venue.cover_image || HERO_FALLBACK_IMAGE,
    when: [`${longDay} ${d.day} ${d.month}`, time].filter(Boolean).join(' · '),
    chapterDay: `${(WEEKDAY_SHORT[weekdayOf(e.event_date)] ?? '').toUpperCase()} ${d.day}`,
    place: hidden.location ? HERO_TEXT.location : e.venue.name,
    placeSub: [city, state].filter(Boolean).join(' · '),
  };

  if (hidden.price) {
    return {
      ...base,
      mode: 'notify',
      ringText: HERO_TEXT.notify,
      lotLabel: null,
      priceText: HERO_TEXT.price,
      ariaBuy: `Me avise — ${title}, preço em breve`,
      endsAt: null,
    };
  }
  if (lot?.soldOut) {
    return {
      ...base,
      mode: 'waitlist',
      ringText: HERO_TEXT.waitlist,
      lotLabel: HERO_TEXT.soldOut,
      priceText: HERO_TEXT.waitlist,
      ariaBuy: `Lista de espera — ${title}, ingressos esgotados`,
      endsAt: null,
    };
  }
  const priceText = compactPrice(lot?.price ?? e.ticket_price) ?? 'Ingressos';
  const lotLabel = lot?.label ?? null;
  return {
    ...base,
    mode: 'buy',
    ringText: HERO_TEXT.buy,
    lotLabel,
    priceText,
    ariaBuy: [`Comprar ingresso — ${title}`, priceText, lotLabel].filter(Boolean).join(', '),
    endsAt: lot?.endsAt ?? null,
  };
}
