'use client';
import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useApp } from '@/components/providers/AppProviders';
import { validateEmail } from '@/lib/moderation';

export function Newsletter() {
  const { data } = useApp();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'created' | 'exists' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail(email)) {
      setState('error');
      setMessage('Informe um e-mail válido.');
      return;
    }
    setState('loading');
    try {
      const res = await data.subscribeNewsletter(email);
      setState(res);
      setMessage(res === 'created' ? 'Inscrição confirmada. Bem-vindo à comunidade.' : 'Este e-mail já faz parte da comunidade.');
      if (res === 'created') setEmail('');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Não foi possível concluir a inscrição.');
    }
  };

  const done = state === 'created' || state === 'exists';

  return (
    <section className="border-t border-line bg-ink-2">
      <div className="container-site grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <div>
          <p className="flex items-center gap-3 text-[10px] font-extrabold uppercase tracking-wide2 text-red-bright">
            <span className="h-px w-8 bg-red/60" /> Newsletter
          </p>
          <h2 className="mt-4 font-display text-[40px] font-extrabold uppercase leading-[0.9] tracking-tight sm:text-[60px]">
            Receba o melhor
            <br />
            da <span className="text-red-bright">noite.</span>
          </h2>
        </div>
        <div>
          <p className="max-w-md text-[15px] leading-relaxed text-mute">
            Novidades, eventos da semana e os rankings atualizados direto no seu e-mail. Sem spam.
          </p>
          <form onSubmit={submit} className="mt-7 flex flex-col gap-3 sm:flex-row" noValidate>
            <label htmlFor="newsletter-email" className="sr-only">E-mail</label>
            <input
              id="newsletter-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === 'error') setState('idle');
              }}
              placeholder="Seu melhor e-mail"
              className="h-[52px] flex-1 rounded-full border border-line bg-ink px-6 text-sm text-bone placeholder:text-mute/60 transition-colors focus:border-red focus:outline-none"
            />
            <button type="submit" disabled={state === 'loading'} className="btn-primary group h-[52px] px-8">
              {state === 'loading' ? 'Enviando…' : 'Inscrever-se'}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </form>
          <p
            role="status"
            className={`mt-4 flex min-h-[20px] items-center gap-2 text-[13px] ${state === 'error' ? 'text-bone' : 'text-red-bright'}`}
          >
            {done && <Check className="h-4 w-4" />}
            {(done || state === 'error') && message}
          </p>
        </div>
      </div>
    </section>
  );
}
