'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { History, LayoutDashboard, LogOut, Menu, Search, Settings, ShieldCheck, Ticket, User, X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { useApp } from '@/components/providers/AppProviders';
import { SLOGAN } from '@/lib/brand';
import { SearchOverlay } from './SearchOverlay';

export const NAV = [
  { href: '/eventos', label: 'Ingressos' },
  { href: '/rankings', label: 'Rankings' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/descobrir', label: 'Descobrir' },
  { href: '/editorial', label: 'Editorial' },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, data, authReady } = useApp();
  const isSuper = user?.role === 'super_admin';
  const isProducer = user?.role === 'admin_festa' || isSuper;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenu(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !(e.target as HTMLElement)?.closest('input,textarea'))) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenu(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
  }, [menuOpen]);

  const signOut = async () => {
    await data.signOut();
    router.push('/');
  };

  return (
    <>
      <header
        className={clsx(
          'sticky top-0 z-50 border-b transition-colors duration-500',
          scrolled || menuOpen ? 'border-line/80 bg-ink/90 backdrop-blur-md' : 'border-transparent bg-ink',
        )}
      >
        <div className="container-site relative flex h-[68px] items-center justify-between sm:h-[76px]">
          <Logo />

          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-10 lg:flex xl:gap-14" aria-label="Principal">
            {NAV.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'relative py-2 text-[11px] font-semibold uppercase tracking-nav transition-colors duration-300 hover:text-red-bright',
                    active ? 'text-bone' : 'text-bone/75',
                  )}
                >
                  {item.label}
                  <span
                    className={clsx(
                      'absolute -bottom-0.5 left-0 h-px bg-red transition-all duration-500',
                      active ? 'w-full' : 'w-0',
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-bone/85 transition-colors hover:text-red-bright"
              aria-label="Pesquisar"
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>

            {user && (
              <Link href="/meus-ingressos" className="relative flex h-10 w-10 items-center justify-center rounded-full text-bone/85 transition-colors hover:text-red-bright" aria-label="Meus ingressos" title="Meus ingressos">
                <Ticket className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </Link>
            )}

            {!authReady ? (
              <span className="hidden h-9 w-[92px] sm:block" />
            ) : user ? (
              <div className="relative hidden sm:block" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 transition-colors hover:border-bone/60"
                  aria-haspopup="menu"
                  aria-expanded={userMenu}
                >
                  <Avatar profile={user} size={28} />
                  <span className="max-w-[110px] truncate text-[11px] font-semibold uppercase tracking-nav">{user.username}</span>
                </button>
                {userMenu && (
                  <div role="menu" className="absolute right-0 mt-2 w-56 animate-fade-in overflow-hidden rounded-card border border-line bg-ink-2 py-2">
                    <MenuLink href="/meus-ingressos" icon={<Ticket className="h-4 w-4" />}>Meus ingressos</MenuLink>
                    <MenuLink href="/perfil" icon={<User className="h-4 w-4" />}>Meu perfil</MenuLink>
                    <MenuLink href="/retrospectiva" icon={<History className="h-4 w-4" />}>Minha retrospectiva</MenuLink>
                    <MenuLink href="/perfil?tab=configuracoes" icon={<Settings className="h-4 w-4" />}>Configurações</MenuLink>
                    {isProducer && <MenuLink href="/produtor" icon={<LayoutDashboard className="h-4 w-4" />}>Painel do produtor</MenuLink>}
                    {isSuper && <MenuLink href="/admin" icon={<ShieldCheck className="h-4 w-4" />}>Painel admin</MenuLink>}
                    <button onClick={signOut} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12px] text-mute transition-colors hover:bg-panel hover:text-bone">
                      <LogOut className="h-4 w-4" /> Sair
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href={`/entrar?next=${encodeURIComponent(pathname)}`}
                className="hidden h-9 items-center rounded-full border border-bone/85 px-6 text-[11px] font-semibold uppercase tracking-nav text-bone transition-colors duration-300 hover:border-red hover:text-red-bright sm:inline-flex"
              >
                Entrar
              </Link>
            )}

            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center text-bone lg:hidden"
              aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 top-[68px] z-40 flex animate-fade-in flex-col bg-ink px-5 pb-10 pt-8 sm:top-[76px] lg:hidden">
          <nav className="flex flex-col" aria-label="Menu">
            {NAV.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                style={{ animationDelay: `${i * 60}ms` }}
                className={clsx(
                  'animate-fade-up border-b border-line py-5 font-display text-[34px] font-extrabold uppercase leading-none tracking-tight',
                  pathname.startsWith(item.href) ? 'text-red-bright' : 'text-bone',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3">
            <Link href="/eventos" className="accent-frame flex h-12 items-center justify-center font-display text-[13px] font-extrabold uppercase tracking-[0.16em]">
              Comprar ingressos
            </Link>
            {user ? (
              <>
                <Link href="/meus-ingressos" className="btn-ghost w-full">Meus ingressos</Link>
                <Link href="/perfil" className="btn-outline w-full">Meu perfil</Link>
                {isProducer && <Link href="/produtor" className="btn-ghost w-full">Painel do produtor</Link>}
                {isSuper && <Link href="/admin" className="btn-ghost w-full">Painel admin</Link>}
                <button onClick={signOut} className="btn-ghost w-full">Sair</button>
              </>
            ) : (
              <Link href="/entrar" className="btn-outline w-full">Entrar</Link>
            )}
            <p className="mt-4 text-center text-[10px] font-semibold uppercase tracking-wide2 text-mute">{SLOGAN}</p>
          </div>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} role="menuitem" className="flex items-center gap-3 px-4 py-2.5 text-[12px] text-mute transition-colors hover:bg-panel hover:text-bone">
      {icon}
      {children}
    </Link>
  );
}
