import { authenticate, json, requireCloud } from "@/lib/server/auth";
import { PrefsSchema } from "@/lib/schemas";
import { loadPrefs, prefsStored, savePrefs } from "@/lib/server/taskService";
import { isValidTimezone } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const [prefs, stored] = await Promise.all([loadPrefs(c.auth.client, c.auth.userId), prefsStored(c.auth.client, c.auth.userId)]);
  return json({ prefs, stored });
}

export async function PUT(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const parsed = PrefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Those settings look invalid.", details: parsed.error.flatten() }, 400);
  if (parsed.data.timezone && !isValidTimezone(parsed.data.timezone)) return json({ error: "Unknown timezone." }, 400);
  try {
    return json({ prefs: await savePrefs(c.auth.client, c.auth.userId, parsed.data) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
