/* eslint-disable @next/next/no-img-element */
import { clsx } from 'clsx';
import { initials } from '@/lib/format';
import type { Profile } from '@/types';

export function Avatar({ profile, size = 40, className }: { profile: Pick<Profile, 'full_name' | 'username' | 'avatar_url'> | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (profile?.avatar_url)
    return <img src={profile.avatar_url} alt={profile.full_name} style={style} className={clsx('photo shrink-0 rounded-full object-cover', className)} />;
  return (
    <span
      style={{ ...style, fontSize: Math.max(10, size * 0.36) }}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-panel font-display font-bold text-bone', className)}
      aria-hidden="true"
    >
      {initials(profile?.full_name || profile?.username || '?')}
    </span>
  );
}
