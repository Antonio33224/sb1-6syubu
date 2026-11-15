export const WEEKDAY_LONG = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Data local no formato YYYY-MM-DD (evita o deslocamento de fuso do toISOString à noite). */
export function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Hoje + 6 dias (7 dias corridos), em datas locais. */
export function weekWindow(now = new Date()): { from: string; to: string; days: string[] } {
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(localIso(d));
  }
  return { from: days[0]!, to: days[6]!, days };
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

/** "Hoje", "Amanhã" ou o dia da semana por extenso. */
export function relativeDayLabel(date: string, now = new Date()): string {
  const today = localIso(now);
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  if (date === today) return 'Hoje';
  if (date === localIso(t)) return 'Amanhã';
  return WEEKDAY_LONG[weekdayOf(date)]!;
}

/** Ordena cronologicamente por data e horário. */
export function byDateTime<T extends { event_date: string; start_time: string }>(a: T, b: T) {
  return a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time);
}
