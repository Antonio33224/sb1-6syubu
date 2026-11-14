export const SOCIALS = [
  { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/' },
  { key: 'tiktok', label: 'TikTok', href: 'https://tiktok.com/' },
  { key: 'youtube', label: 'YouTube', href: 'https://youtube.com/' },
  { key: 'x', label: 'X', href: 'https://x.com/' },
] as const;

export function SocialIcon({ name, className }: { name: (typeof SOCIALS)[number]['key']; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', 'aria-hidden': true as const };
  switch (name) {
    case 'instagram':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common} fill="currentColor">
          <path d="M16.6 3c.4 2.3 1.9 3.9 4.2 4.1v3.1c-1.5.1-2.9-.4-4.2-1.2v6.3c0 3.9-3.4 6.4-6.9 5.5-3.6-.9-5-5.4-2.6-8.2 1.3-1.5 3.3-2.2 5.2-1.8v3.3c-.9-.3-1.9-.1-2.5.6-1 1.2-.4 3.1 1.1 3.4 1.4.3 2.6-.7 2.6-2.2V3h3.1z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg {...common} fill="currentColor">
          <path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common} fill="currentColor">
          <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z" />
        </svg>
      );
  }
}
