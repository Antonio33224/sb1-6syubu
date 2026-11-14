import Link from 'next/link';
import { clsx } from 'clsx';

/** Logotipo textual: "classify" branco + "DJ" azul. */
export function Logo({ className, href = '/', size = 'md' }: { className?: string; href?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sizes = { sm: 'text-[17px]', md: 'text-[22px]', lg: 'text-[30px]', xl: 'text-[40px] sm:text-[46px]' };
  const mark = (
    <span className={clsx('font-display font-bold leading-none tracking-[-0.04em] text-bone', sizes[size], className)}>
      classify<span className="text-blue">DJ</span>
    </span>
  );
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="Classify DJ — início" className="inline-flex items-center">
      {mark}
    </Link>
  );
}
