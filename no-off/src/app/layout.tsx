import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '@/styles/globals.css';
import { AppProviders } from '@/components/providers/AppProviders';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { palette } from '@/lib/theme';
import { SITE_NAME, SLOGAN } from '@/lib/brand';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — ${SLOGAN}`, template: `%s · ${SITE_NAME}` },
  description: `${SLOGAN}. Ingressos, agenda, rankings e avaliações de festas, eventos e casas noturnas.`,
  applicationName: SITE_NAME,
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'pt_BR',
    title: `${SITE_NAME} — ${SLOGAN}`,
    description: `${SLOGAN}. Ingressos para festas, eventos e casas noturnas.`,
    images: [{ url: '/images/hero-crowd.jpg', alt: SITE_NAME }],
  },
  twitter: { card: 'summary_large_image', title: `${SITE_NAME} — ${SLOGAN}`, description: SLOGAN },
};

export const viewport: Viewport = { themeColor: palette.ink };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppProviders>
          <Header />
          <main className="min-h-[60vh]">{children}</main>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}
