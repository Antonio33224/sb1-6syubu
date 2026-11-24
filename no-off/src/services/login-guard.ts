/**
 * Registro de tentativas de login falhas (sem dependências: importado pelo SupabaseService).
 */
/**
 * Avisa o servidor de uma tentativa de login recusada pelo Supabase. Nunca
 * bloqueia o login por erro de rede (tempo máximo de 2,5 s).
 */
export async function reportLoginFailure(email: string): Promise<{ too_many: boolean; retry_after_minutes?: number }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('/api/auth/login-failed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    const j = (await res.json().catch(() => ({}))) as { too_many?: boolean; retry_after_minutes?: number };
    return { too_many: Boolean(j.too_many), retry_after_minutes: j.retry_after_minutes };
  } catch {
    return { too_many: false };
  }
}

