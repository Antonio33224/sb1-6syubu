import type { Config } from 'tailwindcss';
import { palette } from './src/lib/theme';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: palette.ink, 2: palette.ink2 },
        panel: palette.panel,
        line: palette.line,
        bone: palette.bone,
        mute: palette.mute,
        red: { DEFAULT: palette.red, bright: palette.redBright, deep: palette.redDeep, soft: palette.redSoft },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        nav: '0.18em',
        wide2: '0.28em',
      },
      borderRadius: {
        card: '6px',
      },
      maxWidth: {
        site: '1440px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in': 'fade-in 0.5s ease both',
      },
    },
  },
  plugins: [],
};

export default config;
