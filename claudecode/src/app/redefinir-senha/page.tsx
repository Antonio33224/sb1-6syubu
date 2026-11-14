'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';

export default function RedefinirSenhaPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { data } = useApp();
  const toast = useToast();
  const token = params.get('token') ?? undefined;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      // Supabase: a sessão de recuperação vem do link do e-mail (detectSessionInUrl).
      await data.updatePassword(password, token);
      toast('Senha atualizada.');
      router.replace('/entrar');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar a senha.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="container-site flex min-h-[70vh] items-center py-16">
      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-5">
        <p className="eyebrow">Conta</p>
        <h1 className="font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight">Nova senha.</h1>
        <div>
          <label htmlFor="pw" className="field-label">Nova senha</label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="field" minLength={8} required autoComplete="new-password" />
        </div>
        <div>
          <label htmlFor="pw2" className="field-label">Confirmar senha</label>
          <input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field" minLength={8} required autoComplete="new-password" />
        </div>
        <FieldError message={error} />
        <button disabled={busy} className="btn-primary w-full">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </section>
  );
}
