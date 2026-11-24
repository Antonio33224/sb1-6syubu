/**
 * Tokens de cor da NO OFF — fonte única usada pelo Tailwind (tailwind.config.ts).
 *
 * Contraste sobre o fundo #050505 (WCAG 2.1):
 * - red        #E10600 → 4,1:1  (AA para texto grande ≥ 18px/14px bold e componentes de UI ≥ 3:1)
 * - redBright  #FF3B30 → 5,7:1  (AA para texto pequeno: links, eyebrows, foco, estados ativos)
 * - bone sobre red      → 4,6:1 (texto de botões primários)
 */
export const palette = {
  ink: '#050505',
  ink2: '#0A0A0A',
  panel: '#111111',
  line: '#292929',
  bone: '#F5F5F5',
  mute: '#A0A0A0',
  /** Vermelho NO OFF (cor principal). */
  red: '#E10600',
  /** Variação clara para texto pequeno e foco (AA). */
  redBright: '#FF3B30',
  /** Variação escura para estado active / pressionado. */
  redDeep: '#B00500',
  redSoft: 'rgba(225,6,0,0.12)',
} as const;
