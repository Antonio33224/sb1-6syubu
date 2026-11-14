import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '@/styles/globals.css';
import { AppProviders } from '@/components/providers/AppProviders';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { DemoBadge } from '@/components/layout/DemoBadge';

export const metadata: Metadata = {
  title: { default: 'Classify DJ — We rate the night.', template: '%s · Classify DJ' },
  description: 'Descubra, avalie e classifique as melhores festas, eventos e experiências noturnas.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#050505' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppProviders>
          <Header />
          <main className="min-h-[60vh]">{children}</main>
          <Footer />
          <DemoBadge />
        </AppProviders>
      </body>
    </html>
  );
}
