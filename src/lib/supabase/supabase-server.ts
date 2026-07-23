/**
 * supabase-server.ts
 * ==================
 * Server-side Supabase initialization.
 *
 * Used ONLY in API routes and server components.
 * Uses the service_role key (bypasses RLS — full admin access).
 *
 * SECURITY: This file MUST NEVER be imported in client-side code.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let serverClient: SupabaseClient | null = null;

/**
 * Get the server-side Supabase client (service_role — bypasses RLS).
 * Use this in API routes for admin operations.
 */
export function getSupabaseServer(): SupabaseClient {
  if (!serverClient) {
    serverClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return serverClient;
}

/** Convenience export — lazily initialized */
export const supabaseServer = getSupabaseServer();
