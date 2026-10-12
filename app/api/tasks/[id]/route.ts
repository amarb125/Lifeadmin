import { authenticate, json, requireCloud } from "@/lib/server/auth";
import { TaskPatchSchema } from "@/lib/schemas";
import { deleteTask, loadPrefs, NotFoundError, patchTask } from "@/lib/server/taskService";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Invalid task id." }, 400);
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const parsed = TaskPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Those changes look invalid.", details: parsed.error.flatten() }, 400);
  try {
    const prefs = await loadPrefs(c.auth.client, c.auth.userId);
    const task = await patchTask(c.auth.client, c.auth.userId, id, parsed.data, prefs);
    return json({ task });
  } catch (e) {
    if (e instanceof NotFoundError) return json({ error: "Task not found." }, 404);
    return json({ error: (e as Error).message }, 500);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ error: "Invalid task id." }, 400);
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  try {
    await deleteTask(c.auth.client, id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return json({ error: "Task not found." }, 404);
    return json({ error: (e as Error).message }, 500);
  }
}
