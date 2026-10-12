import { authenticate, json, requireCloud } from "@/lib/server/auth";
import { TaskActionSchema } from "@/lib/schemas";
import { actOnTask, loadPrefs, NotFoundError } from "@/lib/server/taskService";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** complete | snooze ("not yet, remind me later") | reschedule */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Invalid task id." }, 400);
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const parsed = TaskActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Unknown action." }, 400);
  try {
    const prefs = await loadPrefs(c.auth.client, c.auth.userId);
    const result = await actOnTask(c.auth.client, c.auth.userId, id, parsed.data, prefs);
    return json(result);
  } catch (e) {
    if (e instanceof NotFoundError) return json({ error: "Task not found." }, 404);
    return json({ error: (e as Error).message }, 500);
  }
}
