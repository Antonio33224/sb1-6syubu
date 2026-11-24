'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { useApp, useToast } from '@/components/providers/AppProviders';
import { FieldError } from '@/components/ui/Controls';
import { Logo } from '@/components/brand/Logo';
import { slugify } from '@/lib/format';
import { SLOGAN } from '@/lib/brand';
import { formatPhone, toE164 } from '@/lib/cpf';

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
  // Login por celular (OTP por SMS)
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [method, setMethod] = useState<'email' | 'celular'>('email');

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

  const google = async () => {
    setError(null);
    try {
      await data.signInWithGoogle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar com Google.');
    }
  };

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const e164 = toE164(phone);
    if (!e164) return setError('Informe o celular com DDD.');
    setBusy(true);
    try {
      if (!otpSent) {
        await data.sendPhoneOtp(e164);
        setOtpSent(true);
        setInfo('Enviamos um código por SMS. Ele vale por alguns minutos.');
      } else {
        await data.verifyPhoneOtp(e164, otp);
        toast('Bem-vindo.');
        router.replace(next);
      }
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
        <p className="absolute bottom-12 right-14 font-display text-[64px] font-extrabold uppercase leading-[0.9] tracking-tight">Uma nova forma<br />de adquirir<br />experiências<br />noturnas.</p>
      </div>

      <div className="container-site flex min-h-[calc(100vh-76px)] items-center py-14">
        <div className="w-full max-w-md">
          <Logo href={null} size="lg" />
          <h1 className="mt-8 font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-tight sm:text-[44px]">
            {mode === 'login' ? 'Entrar.' : 'Criar conta.'}
          </h1>
          <p className="mt-3 text-sm text-mute">
            {mode === 'login' ? `${SLOGAN}.` : 'Ingressos, rankings, avaliações e favoritos em um só lugar.'}
          </p>

          <div className="mt-8 flex flex-col gap-3">
              <button type="button" onClick={google} className="btn-outline w-full">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.44-1.66 4.22-5.35 4.22-3.22 0-5.85-2.67-5.85-5.95S8.78 6.4 12 6.4c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.85 14.55 2.9 12 2.9 6.98 2.9 2.9 6.98 2.9 12s4.08 9.1 9.1 9.1c5.25 0 8.73-3.69 8.73-8.89 0-.6-.07-1.05-.15-1.51z" /></svg>
                Continuar com Google
              </button>
              <button type="button" onClick={() => { setMethod(method === 'celular' ? 'email' : 'celular'); setError(null); setInfo(null); }} className="btn-ghost w-full">
                {method === 'celular' ? 'Usar e-mail e senha' : 'Entrar com celular (código por SMS)'}
              </button>
          </div>

          {method === 'celular' ? (
            <form onSubmit={sendOtp} className="mt-8 flex flex-col gap-5" noValidate>
              <div>
                <label htmlFor="phone" className="field-label">Celular</label>
                <input id="phone" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(21) 99999-9999" className="field" disabled={otpSent} />
              </div>
              {otpSent && (
                <div>
                  <label htmlFor="otp" className="field-label">Código recebido por SMS</label>
                  <input id="otp" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))} className="field font-display text-lg tracking-[0.4em]" />
                </div>
              )}
              <FieldError message={error} />
              {info && <p className="rounded-card border border-red/40 px-4 py-3 text-[13px] text-red-bright">{info}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Aguarde…' : otpSent ? 'Confirmar código' : 'Enviar código'}</button>
              {otpSent && <button type="button" onClick={() => { setOtpSent(false); setOtp(''); setInfo(null); }} className="text-[11px] text-mute hover:text-red-bright">Trocar número / reenviar</button>}
            </form>
          ) : (<>

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
                {mode === 'login' && <Link href="/recuperar-senha" className="mb-2 text-[11px] text-mute hover:text-red-bright">Esqueci a senha</Link>}
              </div>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="field" required minLength={8} />
              {mode === 'cadastro' && <p className="mt-2 text-[11px] text-mute">Mínimo de 8 caracteres.</p>}
            </div>
            <FieldError message={error} />
            {info && <p className="rounded-card border border-red/40 px-4 py-3 text-[13px] text-red-bright">{info}</p>}
            <button type="submit" disabled={busy} className="btn-primary mt-2 w-full">
              {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
            {mode === 'cadastro' && (
              <p className="text-[11px] leading-relaxed text-mute">
                Ao criar a conta você concorda com os <Link href="/termos" className="text-bone hover:text-red-bright">Termos</Link> e a{' '}
                <Link href="/privacidade" className="text-bone hover:text-red-bright">Política de privacidade</Link>.
              </p>
            )}
          </form>
          </>)}
        </div>
      </div>
    </section>
  );
}
