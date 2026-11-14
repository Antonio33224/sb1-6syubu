'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { Logo } from '@/components/brand/Logo';
import { DEMO_ADMIN_EMAIL, DEMO_PASSWORD, DEMO_USER_EMAIL } from '@/data/demo-seed';
import { slugify } from '@/lib/format';

export default function EntrarPage() {
  return (
    <Suspense>
      <AuthScreen />
    </Suspense>
  );
}

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/entrar') ? n : '/perfil';
}

function AuthScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, user, authReady } = useApp();
  const toast = useToast();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'login' | 'cadastro'>(params.get('modo') === 'cadastro' ? 'cadastro' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && user) router.replace(next);
  }, [authReady, user, next, router]);

  useEffect(() => {
    if (!usernameTouched) setUsername(slugify(fullName).replace(/-/g, '.').slice(0, 24));
  }, [fullName, usernameTouched]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'login') {
        await data.signIn(email, password);
        toast('Bem-vindo de volta.');
      } else {
        const { needsConfirmation } = await data.signUp({ email, password, username, full_name: fullName });
        if (needsConfirmation) {
          setInfo('Conta criada. Enviamos um link de confirmação para o seu e-mail.');
          return;
        }
        toast('Conta criada. Bem-vindo à comunidade.');
      }
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível continuar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative isolate min-h-[calc(100vh-76px)] overflow-hidden">
      <div className="absolute inset-y-0 right-0 -z-10 hidden w-1/2 lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/laser-red.jpg" alt="" className="photo h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/40 to-ink/10" />
        <p className="absolute bottom-12 right-14 font-display text-[64px] font-extrabold uppercase leading-[0.9] tracking-tight">We rate<br />the night.</p>
      </div>

      <div className="container-site flex min-h-[calc(100vh-76px)] items-center py-14">
        <div className="w-full max-w-md">
          <Logo href={null} size="lg" />
          <h1 className="mt-8 font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[44px]">
            {mode === 'login' ? 'Entrar.' : 'Criar conta.'}
          </h1>
          <p className="mt-3 text-sm text-mute">
            {mode === 'login' ? 'Avalie, curta e favorite as melhores noites.' : 'Rankings, avaliações e favoritos em um só lugar.'}
          </p>

          <div className="mt-8 flex rounded-full border border-line p-1" role="tablist">
            {(['login', 'cadastro'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => { setMode(m); setError(null); setInfo(null); }}
                className={clsx('h-10 flex-1 rounded-full text-[10px] font-bold uppercase tracking-nav transition-colors', mode === m ? 'bg-bone text-ink' : 'text-mute hover:text-bone')}
              >
                {m === 'login' ? 'Entrar' : 'Cadastrar'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-5" noValidate>
            {mode === 'cadastro' && (
              <>
                <div>
                  <label htmlFor="name" className="field-label">Nome</label>
                  <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className="field" required maxLength={80} />
                </div>
                <div>
                  <label htmlFor="username" className="field-label">Nome de usuário</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-mute">@</span>
                    <input id="username" value={username} onChange={(e) => { setUsernameTouched(true); setUsername(e.target.value.toLowerCase()); }} className="field pl-8" required maxLength={24} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label htmlFor="email" className="field-label">E-mail</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="field" required />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="field-label">Senha</label>
                {mode === 'login' && <Link href="/recuperar-senha" className="mb-2 text-[11px] text-mute hover:text-blue">Esqueci a senha</Link>}
              </div>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="field" required minLength={8} />
              {mode === 'cadastro' && <p className="mt-2 text-[11px] text-mute">Mínimo de 8 caracteres.</p>}
            </div>
            <FieldError message={error} />
            {info && <p className="rounded-card border border-blue/40 px-4 py-3 text-[13px] text-blue">{info}</p>}
            <button type="submit" disabled={busy} className="btn-primary mt-2 w-full">
              {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
            {mode === 'cadastro' && (
              <p className="text-[11px] leading-relaxed text-mute">
                Ao criar a conta você concorda com os <Link href="/termos" className="text-bone hover:text-blue">Termos</Link> e a{' '}
                <Link href="/privacidade" className="text-bone hover:text-blue">Política de privacidade</Link>.
              </p>
            )}
          </form>

          {data.mode === 'demo' && (
            <div className="mt-10 rounded-card border border-line p-5 text-[12px] leading-relaxed text-mute">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-nav text-bone">Modo demonstração</p>
              Sem Supabase configurado: as contas ficam salvas só neste navegador. Contas de teste (senha <span className="text-bone">{DEMO_PASSWORD}</span>):
              <ul className="mt-2 space-y-1">
                <li><span className="text-bone">{DEMO_USER_EMAIL}</span> — usuário</li>
                <li><span className="text-bone">{DEMO_ADMIN_EMAIL}</span> — administrador</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
