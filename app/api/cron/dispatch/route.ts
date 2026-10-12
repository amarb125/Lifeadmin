import { timingSafeEqual } from "node:crypto";
import { json } from "@/lib/server/auth";
import { adminClient } from "@/lib/server/supabase";
import { dispatchDue } from "@/lib/server/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    // Refuse to run an unauthenticated endpoint that can send notifications.
    return json({ error: "CRON_SECRET is not configured on the server." }, 503);
  }
  if (!authorised(req)) return json({ error: "Unauthorized" }, 401);
  const admin = adminClient();
  if (!admin) return json({ error: "SUPABASE_SERVICE_ROLE_KEY / Supabase URL are not configured." }, 503);
  try {
    return json(await dispatchDue(admin));
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// Vercel Cron issues GET; external schedulers can use either.
export const GET = run;
export const POST = run;
