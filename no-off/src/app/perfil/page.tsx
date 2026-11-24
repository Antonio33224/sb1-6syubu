'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/providers/AppProviders';
import { ProfileView } from '@/components/profile/ProfileView';
import { Skeleton } from '@/components/ui/States';

export default function PerfilPage() {
  return (
    <Suspense fallback={<div className="container-site py-16"><Skeleton className="h-80" /></div>}>
      <OwnProfile />
    </Suspense>
  );
}

function OwnProfile() {
  const { user, authReady } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') === 'configuracoes' ? 'configuracoes' : 'avaliacoes';

  useEffect(() => {
    if (authReady && !user) router.replace('/entrar?next=/perfil');
  }, [authReady, user, router]);

  if (!authReady || !user) return <div className="container-site py-16"><Skeleton className="h-80" /></div>;
  return <ProfileView key={`${user.id}-${tab}`} profile={user} own initialTab={tab} />;
}
