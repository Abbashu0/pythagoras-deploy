/**
 * supabase-client.ts
 * ==================
 * Client-side Supabase initialization.
 *
 * Used by admin components for client-side queries, realtime, and auth.
 * Uses the anon key (safe to expose in browser).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
    });
  }
  return client;
}

export const supabase = getSupabaseClient();
