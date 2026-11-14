'use client';
import type { DataService } from './data-service';
import { DemoService } from './demo-service';
import { SupabaseService } from './supabase-service';

let instance: DataService | null = null;

export const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** Seleciona o backend: Supabase se configurado, caso contrário modo demonstração. */
export function getDataService(): DataService {
  if (!instance) {
    instance = SUPABASE_CONFIGURED
      ? new SupabaseService(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      : new DemoService();
  }
  return instance;
}

export { ServiceError } from './data-service';
export type { DataService } from './data-service';
