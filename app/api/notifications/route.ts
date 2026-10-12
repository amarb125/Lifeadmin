import { authenticate, json, requireCloud } from "@/lib/server/auth";
import { MarkReadSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const { data, error } = await c.auth.client
    .from("notifications")
    .select("id, task_id, kind, title, body, push_status, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return json({ error: error.message }, 500);
  return json({ notifications: data });
}

export async function POST(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const parsed = MarkReadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  let q = c.auth.client.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (!parsed.data.all) {
    if (!parsed.data.ids?.length) return json({ ok: true });
    q = q.in("id", parsed.data.ids);
  }
  const { error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
