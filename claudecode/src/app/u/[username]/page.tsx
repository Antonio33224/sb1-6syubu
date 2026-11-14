'use client';
import { useParams } from 'next/navigation';
import { useApp } from '@/components/providers/AppProviders';
import { ProfileView } from '@/components/profile/ProfileView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';

export default function PublicProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { data, user } = useApp();
  const { data: profile, loading } = useAsync(() => data.getProfileByUsername(decodeURIComponent(username)), [data, username]);

  if (loading) return <div className="container-site py-16"><Skeleton className="h-80" /></div>;
  if (!profile)
    return (
      <div className="container-site py-24">
        <EmptyState title="Perfil não encontrado" action={{ href: '/reviews', label: 'Ver reviews' }} />
      </div>
    );
  return <ProfileView key={profile.id} profile={profile} own={user?.id === profile.id} />;
}
