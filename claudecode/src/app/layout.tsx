import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '@/styles/globals.css';
import { AppProviders } from '@/components/providers/AppProviders';
import { PlusProvider } from '@/components/providers/PlusProvider';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { DemoBadge } from '@/components/layout/DemoBadge';
import { VoiceAssistant } from '@/components/voice/VoiceAssistant';
import { palette } from '@/lib/theme';

export const metadata: Metadata = {
  title: { default: 'Classify DJ — We rate the night.', template: '%s · Classify DJ' },
  description: 'Descubra, avalie e classifique as melhores festas, eventos e experiências noturnas.',
  icons: { icon: '/favicon.svg' },
};

// viewportFit "cover" habilita env(safe-area-inset-*) para o orbe no mobile.
export const viewport: Viewport = { themeColor: palette.ink, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AppProviders>
          <PlusProvider>
            <Header />
            <main className="min-h-[60vh]">{children}</main>
            <Footer />
            <DemoBadge />
            <VoiceAssistant />
          </PlusProvider>
        </AppProviders>
      </body>
    </html>
  );
}
