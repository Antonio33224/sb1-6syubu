import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ClassifyMark } from '@/components/brand/ApprovedSeal';
import { SocialIcon, SOCIALS } from './SocialIcons';

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'Explorar',
    links: [
      { href: '/descobrir', label: 'Explorar boates' },
      { href: '/rankings', label: 'Rankings' },
      { href: '/eventos', label: 'Eventos' },
      { href: '/reviews', label: 'Avaliações' },
    ],
  },
  {
    title: 'Classify DJ',
    links: [
      { href: '/classify-plus', label: 'Classify+ (assinatura)' },
      { href: '/sobre', label: 'Sobre o Classify DJ' },
      { href: '/approved', label: 'Selo Approved' },
      { href: '/editorial', label: 'Editorial' },
      { href: '/avaliar', label: 'Fazer uma avaliação' },
    ],
  },
  {
    title: 'Contato',
    links: [
      { href: '/contato', label: 'Fale conosco' },
      { href: 'https://instagram.com/', label: 'Instagram', external: true },
      { href: '/termos', label: 'Termos de uso' },
      { href: '/privacidade', label: 'Política de privacidade' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink">
      <div className="container-site">
        <div className="grid gap-12 py-14 lg:grid-cols-[1.3fr_2fr] lg:gap-20 lg:py-20">
          <div>
            <Logo size="lg" />
            <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-mute">
              A plataforma premium para descobrir, avaliar e comparar as melhores boates, festas e experiências da vida noturna.
            </p>
            <ul className="mt-7 flex items-center gap-2">
              {SOCIALS.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-bone/80 transition-colors hover:border-blue hover:text-blue"
                  >
                    <SocialIcon name={s.key} className="h-[15px] w-[15px]" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav className="grid grid-cols-2 gap-10 sm:grid-cols-3" aria-label="Rodapé">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-[10px] font-extrabold uppercase tracking-wide2 text-blue">{col.title}</p>
                <ul className="mt-5 flex flex-col gap-3.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[13px] text-bone/75 transition-colors hover:text-blue">{l.label}</a>
                      ) : (
                        <Link href={l.href} className="text-[13px] text-bone/75 transition-colors hover:text-blue">{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="flex flex-col items-start justify-between gap-6 border-t border-line pb-20 pt-7 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <ClassifyMark className="h-9 w-9" strokeWidth={1.8} />
            <p className="font-display text-[13px] font-extrabold uppercase tracking-[0.22em]">We rate the night.</p>
          </div>
          <p className="text-[11px] text-mute">© {new Date().getFullYear()} Classify DJ. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
