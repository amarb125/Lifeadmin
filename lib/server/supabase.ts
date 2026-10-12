import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Service-role client. Server only; bypasses RLS. Used by the reminder dispatcher. */
export function adminClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url() || !key) return null;
  return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Client that acts as the signed-in user, so RLS applies to every query. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(url(), anon(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
