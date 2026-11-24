/**
 * Autenticação e autorização nas rotas de API (servidor).
 *
 * - O usuário é identificado pelo token Supabase (Authorization: Bearer …).
 * - As consultas usam um client com o token do próprio usuário: a RLS vale sempre.
 * - `requireAdmin` confere o papel NO SERVIDOR (public.is_admin()); as funções
 *   SQL admin_* conferem de novo (defesa em profundidade).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
  siteUrl: string;
}

export function supabaseEnv(env: NodeJS.ProcessEnv = process.env): SupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return {
    url,
    anonKey,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
    siteUrl: (env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  };
}

export interface AuthContext {
  db: SupabaseClient;
  userId: string;
}

export function userClient(url: string, anonKey: string, accessToken: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export function serviceClient(env: SupabaseEnv): SupabaseClient | null {
  if (!env.serviceRoleKey) return null;
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

/** Usuário do token Supabase; null = não autenticado. */
export async function authenticate(req: Request, env: Pick<SupabaseEnv, 'url' | 'anonKey'>): Promise<AuthContext | null> {
  const token = bearer(req);
  if (!token || token.length > 4096) return null;
  const db = userClient(env.url, env.anonKey, token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return { db, userId: data.user.id };
}

/** Papel conferido no banco (função security definer public.is_admin()). */
export async function checkAdmin(ctx: AuthContext): Promise<boolean> {
  const { data, error } = await ctx.db.rpc('is_admin');
  return !error && data === true;
}

export const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** IP do cliente (Vercel/proxy: primeiro valor de x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (fwd || req.headers.get('x-real-ip') || 'desconhecido').slice(0, 64);
}
