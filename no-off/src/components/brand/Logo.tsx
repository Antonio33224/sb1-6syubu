import Link from 'next/link';
import { clsx } from 'clsx';

/** Logotipo textual: "NO" branco + "OFF" vermelho. */
export function Logo({ className, href = '/', size = 'md' }: { className?: string; href?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizes = { sm: 'text-[17px]', md: 'text-[22px]', lg: 'text-[30px]', xl: 'text-[40px] sm:text-[46px]' };
  const mark = (
    <span className={clsx('font-display font-extrabold uppercase leading-none tracking-[-0.03em] text-bone', sizes[size], className)}>
      NO<span className="ml-[0.18em] text-red-bright">OFF</span>
    </span>
  );
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="NO OFF — início" className="inline-flex items-center">
      {mark}
    </Link>
  );
}
