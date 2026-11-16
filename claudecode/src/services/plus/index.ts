'use client';
import { getDataService } from '../index';
import { SupabaseService } from '../supabase-service';
import { DemoPlusService } from './demo-plus-service';
import type { PlusService } from './plus-service';
import { SupabasePlusService } from './supabase-plus-service';

let instance: PlusService | null = null;

/** Mesmo critério do DataService: Supabase se configurado, senão modo demonstração. */
export function getPlusService(): PlusService {
  if (!instance) {
    const data = getDataService();
    instance = data instanceof SupabaseService ? new SupabasePlusService(data.client) : new DemoPlusService(data);
  }
  return instance;
}

export type { PlusService, CheckoutResult, BillingStatus } from './plus-service';
