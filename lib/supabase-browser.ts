import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) throw new Error("Supabase is not configured");
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
