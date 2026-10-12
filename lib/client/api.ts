"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, publicEnv } from "../env";

let browserClient: SupabaseClient | null = null;

/** Browser Supabase client, or null in demo mode. The anon key is public by design; RLS protects the data. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return browserClient;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    if (data.session?.access_token) headers.set("authorization", `Bearer ${data.session.access_token}`);
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new ApiError(body.error || `Something went wrong (${res.status}).`, res.status);
  return body as T;
}
