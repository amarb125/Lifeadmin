import { isSupabaseConfigured, type Capabilities } from "@/lib/env";
import { json } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Tells the UI what the server can really do, so limitations are stated rather than hidden. */
export async function GET() {
  const cloud = isSupabaseConfigured();
  const vapid = Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
  const caps: Capabilities = {
    mode: cloud ? "cloud" : "demo",
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    transcription: Boolean(process.env.OPENAI_API_KEY),
    push: cloud && vapid,
    serverReminders: cloud && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET),
  };
  return json(caps);
}
