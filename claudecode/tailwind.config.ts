import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#050505', 2: '#0A0A0A' },
        panel: '#111111',
        line: '#292929',
        bone: '#F5F5F5',
        mute: '#A0A0A0',
        blue: { DEFAULT: '#83A9F5', soft: 'rgba(131,169,245,0.12)' },
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
