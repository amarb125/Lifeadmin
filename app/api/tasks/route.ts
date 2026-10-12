import { authenticate, json, requireCloud } from "@/lib/server/auth";
import { CreateTasksSchema } from "@/lib/schemas";
import { createTasks, listTasks, loadPrefs } from "@/lib/server/taskService";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  try {
    return json({ tasks: await listTasks(c.auth.client) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

export async function POST(req: Request) {
  const c = requireCloud(await authenticate(req));
  if (!c.ok) return c.res;
  const parsed = CreateTasksSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Those tasks look invalid.", details: parsed.error.flatten() }, 400);
  try {
    const prefs = await loadPrefs(c.auth.client, c.auth.userId);
    const tasks = await createTasks(c.auth.client, c.auth.userId, parsed.data.tasks, prefs);
    return json({ tasks }, 201);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
