// NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them in the browser bundle.
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
};

/** True when real accounts + a database are available. Otherwise the app runs in demo mode. */
export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

/** What the server can actually do right now. Exposed to the UI so limits are stated honestly. */
export interface Capabilities {
  mode: "demo" | "cloud";
  ai: boolean;
  transcription: boolean;
  push: boolean;
  serverReminders: boolean;
}
