import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ClassifyMark } from '@/components/brand/ApprovedSeal';
import { SocialIcon, SOCIALS } from './SocialIcons';

const LINKS = [
  { href: '/sobre', label: 'Sobre' },
  { href: '/contato', label: 'Contato' },
  { href: '/termos', label: 'Termos' },
  { href: '/privacidade', label: 'Privacidade' },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink">
      <div className="container-site">
        <div className="grid items-center gap-10 py-12 md:grid-cols-[auto_1fr_auto] md:gap-14 lg:py-14">
          <Logo size="md" />

          <nav className="flex flex-wrap gap-x-8 gap-y-3 md:justify-center lg:gap-x-12" aria-label="Institucional">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="text-[11px] font-semibold uppercase tracking-nav text-bone/75 transition-colors hover:text-blue">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-6">
            <ul className="flex items-center gap-2">
              {SOCIALS.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-bone/80 transition-colors hover:border-blue hover:text-blue"
                  >
                    <SocialIcon name={s.key} className="h-[15px] w-[15px]" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
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
