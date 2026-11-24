'use client';
import { SupabaseService } from './supabase-service';

let instance: SupabaseService | null = null;

export const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Backend único: Supabase. Exige NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY. */
export function getDataService(): SupabaseService {
  if (!instance) {
    if (!SUPABASE_CONFIGURED) {
      throw new Error('Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (veja o .env.example).');
    }
    instance = new SupabaseService(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }
  return instance;
}

export { ServiceError } from './data-service';
export type { DataService } from './data-service';
