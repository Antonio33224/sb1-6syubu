/**
 * Tokens de cor do Classify DJ — fonte única usada pelo Tailwind
 * (tailwind.config.ts) e pelo assistente de voz (shaders do orbe).
 */
export const palette = {
  ink: '#050505',
  ink2: '#0A0A0A',
  panel: '#111111',
  line: '#292929',
  bone: '#F5F5F5',
  mute: '#A0A0A0',
  /** Azul-lavanda do logo "DJ". */
  blue: '#83A9F5',
  blueSoft: 'rgba(131,169,245,0.12)',
} as const;

/** Variações do azul Classify para as partículas do orbe (ciano e violeta). */
export const orbPalette = {
  primary: palette.blue,
  cyan: '#7FD8F2',
  violet: '#A38BF0',
  background: palette.ink,
} as const;
