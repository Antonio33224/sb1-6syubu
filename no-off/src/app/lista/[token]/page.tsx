'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { FieldError } from '@/components/ui/Controls';
import { Photo } from '@/components/ui/Photo';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { formatEventDate } from '@/lib/format';
import { formatCpf, formatPhone, isFullName, isValidCpf, onlyDigits } from '@/lib/cpf';
import { HIDDEN_TEXT } from '@/lib/public-events';
import { vipPublicService } from '@/services/ticket-service';

/** Inscrição pública na lista VIP — entra como pendente até o produtor aprovar. */
export default function ListaVipPage() {
  const { token } = useParams<{ token: string }>();
  const { data, loading } = useAsync(() => vipPublicService.link(token), [token]);
  const [f, setF] = useState({ name: '', email: '', phone: '', cpf: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="container-site py-16"><Skeleton className="h-96" /></div>;
  if (!data) return <div className="container-site py-24"><EmptyState title="Link inválido" text="Esta lista não existe ou foi removida." action={{ href: '/eventos', label: 'Ver a agenda' }} /></div>;

  const d = formatEventDate(data.event.event_date);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isFullName(f.name)) return setError('Informe o nome completo.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return setError('E-mail inválido.');
    if (f.cpf && !isValidCpf(f.cpf)) return setError('CPF inválido.');
    setBusy(true);
    try {
      await vipPublicService.signup(token, { name: f.name.trim(), email: f.email.trim(), phone: onlyDigits(f.phone), cpf: onlyDigits(f.cpf) });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a inscrição.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="container-site grid gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:gap-16">
      <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-line lg:aspect-auto">
        <Photo src={data.event.cover_image} alt="" zoom={false} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-7">
          <p className="eyebrow text-red-bright">Lista VIP</p>
          <p className="mt-3 font-display text-[32px] font-extrabold uppercase leading-[0.95] tracking-tight">{data.event.name ?? HIDDEN_TEXT.name}</p>
          <p className="mt-2 text-[13px] text-bone/80">{d.full} · {data.event.start_time} · {data.event.city}</p>
        </div>
      </div>
      <div className="flex flex-col justify-center">
        {done ? (
          <div className="flex flex-col items-start gap-4">
            <CheckCircle2 className="h-10 w-10 text-red-bright" />
            <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-tight">Inscrição enviada.</h1>
            <p className="text-mute">Seu nome entra na lista depois da aprovação do produtor. Leve um documento com foto no dia.</p>
            <Link href={`/eventos/${data.event.slug}`} className="btn-outline mt-4">Ver o evento</Link>
          </div>
        ) : !data.open ? (
          <EmptyState title="Inscrições encerradas" text="Esta lista não aceita novos nomes." action={{ href: `/eventos/${data.event.slug}`, label: 'Ver o evento' }} />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-tight">Coloque seu nome na lista.</h1>
            <p className="text-[13px] text-mute">A inscrição fica pendente até a aprovação do produtor.</p>
            <label><span className="field-label">Nome completo</span><input className="field" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className="field-label">E-mail</span><input className="field" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label><span className="field-label">Celular</span><input className="field" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: formatPhone(e.target.value) })} /></label>
              <label><span className="field-label">CPF (opcional)</span><input className="field" inputMode="numeric" value={formatCpf(f.cpf)} onChange={(e) => setF({ ...f, cpf: onlyDigits(e.target.value).slice(0, 11) })} /></label>
            </div>
            <FieldError message={error} />
            <button disabled={busy} className="btn-primary self-start">{busy ? 'Enviando…' : 'Quero entrar na lista'}</button>
            <p className="text-[11px] text-mute">Seus dados são compartilhados apenas com o produtor desta festa. <Link href="/privacidade">Privacidade</Link>.</p>
          </form>
        )}
      </div>
    </section>
  );
}
