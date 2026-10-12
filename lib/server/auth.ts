import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "../env";
import { userClient } from "./supabase";

export type AuthResult =
  | { mode: "demo" }
  | { mode: "cloud"; userId: string; token: string; client: SupabaseClient };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * In demo mode (no Supabase env) requests are allowed anonymously, because nothing is stored server-side.
 * In cloud mode a valid Supabase access token is required, which also protects the LLM key from the public.
 */
export async function authenticate(req: Request): Promise<AuthResult | Response> {
  if (!isSupabaseConfigured()) return { mode: "demo" };
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return json({ error: "Sign in required." }, 401);
  const client = userClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return json({ error: "Your session has expired. Please sign in again." }, 401);
  return { mode: "cloud", userId: data.user.id, token, client };
}

/** Narrow helper for task/pref routes that only make sense with a database. */
export function requireCloud(auth: AuthResult | Response): { ok: true; auth: Extract<AuthResult, { mode: "cloud" }> } | { ok: false; res: Response } {
  if (auth instanceof Response) return { ok: false, res: auth };
  if (auth.mode !== "cloud") return { ok: false, res: json({ error: "Demo mode stores data in your browser only." }, 400) };
  return { ok: true, auth };
}
