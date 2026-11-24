'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';

export default function RecuperarSenhaPage() {
  const { data } = useApp();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await data.requestPasswordReset(email);
      setDemoLink(res.demoLink ?? null);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="container-site flex min-h-[70vh] items-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Conta</p>
        <h1 className="mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight">Recuperar senha.</h1>
        {sent ? (
          <div className="mt-8 space-y-4 text-sm text-mute">
            <p>Se houver uma conta com <span className="text-bone">{email}</span>, enviaremos um link para redefinir a senha.</p>
            {data.mode === 'demo' && (
              <p className="rounded-card border border-line p-4">
                Modo demonstração: nenhum e-mail é enviado.{' '}
                {demoLink ? <Link href={demoLink} className="text-red-bright underline underline-offset-4">Abrir link de redefinição</Link> : 'Nenhuma conta encontrada neste navegador.'}
              </p>
            )}
            <Link href="/entrar" className="btn-outline btn-sm">Voltar ao login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
            <p className="text-sm text-mute">Informe o e-mail da sua conta.</p>
            <div>
              <label htmlFor="email" className="field-label">E-mail</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" required autoComplete="email" />
            </div>
            <FieldError message={error} />
            <button disabled={busy} className="btn-primary w-full">{busy ? 'Enviando…' : 'Enviar link'}</button>
            <Link href="/entrar" className="text-center text-[12px] text-mute hover:text-bone">Voltar</Link>
          </form>
        )}
      </div>
    </section>
  );
}
