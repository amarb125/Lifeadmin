import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationPrefs, ScheduledReminder, Task } from "../types";
import { mergePrefs, rowToTask, taskToRow, type TaskRow } from "../mapping";
import { planAll, planNextFollowUp } from "../reminders";
import { localParts, nextOccurrence, zonedDate } from "../time";
import type { TaskInput } from "../schemas";

/**
 * Task persistence + reminder scheduling for signed-in users. Every function takes a
 * Supabase client (user-scoped, so RLS applies; the dispatcher passes the admin client).
 * Reminder rows are the source of truth for what will fire; the DB trigger in schema.sql
 * additionally cancels them when a task stops being active.
 */

function fail(error: { message: string } | null, what: string): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

export async function loadPrefs(client: SupabaseClient, userId: string): Promise<NotificationPrefs> {
  const { data } = await client.from("user_prefs").select("prefs").eq("user_id", userId).maybeSingle();
  return mergePrefs(data?.prefs as Partial<NotificationPrefs> | undefined);
}

export async function savePrefs(client: SupabaseClient, userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const current = await loadPrefs(client, userId);
  const next = { ...current, ...patch };
  const { error } = await client
    .from("user_prefs")
    .upsert({ user_id: userId, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) fail(error, "Could not save settings");

  const scheduleChanged =
    next.timezone !== current.timezone ||
    next.quietHoursEnabled !== current.quietHoursEnabled ||
    next.quietStart !== current.quietStart ||
    next.quietEnd !== current.quietEnd;
  if (scheduleChanged) await replanAll(client, userId, next, current.timezone);
  return next;
}

export async function prefsStored(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await client.from("user_prefs").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/**
 * Re-plan every active task after a timezone or quiet-hours change.
 * Timed deadlines keep their exact moment (a 5 PM IST deadline is still that instant after you fly);
 * all-day deadlines keep their calendar date, so "due Friday" stays "end of Friday" where you are now.
 */
export async function replanAll(client: SupabaseClient, userId: string, prefs: NotificationPrefs, oldTz: string): Promise<void> {
  const { data, error } = await client.from("tasks").select("*").eq("status", "active").limit(1000);
  if (error) fail(error, "Could not load tasks to reschedule");
  for (const row of data as TaskRow[]) {
    let task = rowToTask(row);
    if (oldTz !== prefs.timezone && task.dueIsAllDay && task.dueAt) {
      const p = localParts(new Date(task.dueAt), oldTz);
      const moved = zonedDate(prefs.timezone, p.year, p.month0, p.day, 23, 59).toISOString();
      const upd = await client.from("tasks").update({ due_at: moved }).eq("id", task.id).select("*").maybeSingle();
      if (upd.data) task = rowToTask(upd.data as TaskRow);
    }
    await replanReminders(client, userId, task, prefs, { keepFollowUps: true });
  }
}

export async function listTasks(client: SupabaseClient): Promise<Task[]> {
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (error) fail(error, "Could not load tasks");
  return (data as TaskRow[]).map(rowToTask);
}

async function getTask(client: SupabaseClient, id: string): Promise<Task> {
  const { data, error } = await client.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) fail(error, "Could not load task");
  if (!data) throw new NotFoundError();
  return rowToTask(data as TaskRow);
}

export class NotFoundError extends Error {
  constructor() {
    super("Task not found");
  }
}

/** Replace the not-yet-fired reminders of a task with a fresh plan. Sent/claimed rows are left alone. */
export async function replanReminders(
  client: SupabaseClient,
  userId: string,
  task: Task,
  prefs: NotificationPrefs,
  opts: { includeFollowUp?: Date; keepFollowUps?: boolean } = {}
): Promise<void> {
  const now = new Date();
  let clear = client.from("reminders").delete().eq("task_id", task.id).eq("status", "pending");
  // Follow-ups already queued for an overdue task survive a settings change; user actions reset them.
  if (opts.keepFollowUps) clear = clear.in("kind", ["before", "overdue"]);
  const del = await clear;
  if (del.error) fail(del.error, "Could not clear old reminders");
  if (task.status !== "active") return;

  const plan: ScheduledReminder[] = planAll(task, { now, prefs });
  if (opts.includeFollowUp) {
    const f = planNextFollowUp(task, opts.includeFollowUp, prefs);
    if (f) plan.push(f);
  }
  if (!plan.length) return;

  const rows = plan.map((p) => ({
    task_id: task.id,
    user_id: userId,
    fire_at: p.fireAt,
    kind: p.kind,
    label: p.label,
    status: "pending",
    dedupe_key: p.dedupeKey,
  }));
  // ignoreDuplicates: the unique dedupe_key makes re-planning idempotent.
  const ins = await client.from("reminders").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (ins.error) fail(ins.error, "Could not schedule reminders");
}

export async function createTasks(client: SupabaseClient, userId: string, inputs: TaskInput[], prefs: NotificationPrefs): Promise<Task[]> {
  const rows = inputs.map((t) => ({ ...taskToRow(t), user_id: userId }));
  const { data, error } = await client.from("tasks").insert(rows).select("*");
  if (error) fail(error, "Could not save tasks");
  const tasks = (data as TaskRow[]).map(rowToTask);
  for (const t of tasks) await replanReminders(client, userId, t, prefs);
  return tasks;
}

export async function patchTask(
  client: SupabaseClient,
  userId: string,
  id: string,
  patch: Partial<TaskInput>,
  prefs: NotificationPrefs
): Promise<Task> {
  const timingChanged = ["dueAt", "dueIsAllDay", "reminders", "priority", "recurrence"].some((k) => k in patch);
  const row = { ...taskToRow(patch as Partial<Task>) };
  if (timingChanged) {
    // A new schedule starts the follow-up cycle over.
    row.snooze_count = 0;
    row.next_follow_up_at = null;
  }
  const { data, error } = await client.from("tasks").update(row).eq("id", id).select("*").maybeSingle();
  if (error) fail(error, "Could not update task");
  if (!data) throw new NotFoundError();
  const task = rowToTask(data as TaskRow);
  if (timingChanged) await replanReminders(client, userId, task, prefs);
  return task;
}

export async function deleteTask(client: SupabaseClient, id: string): Promise<void> {
  // Reminders cascade-delete with the task, so nothing can fire after this returns.
  const { error, count } = await client.from("tasks").delete({ count: "exact" }).eq("id", id);
  if (error) fail(error, "Could not delete task");
  if (!count) throw new NotFoundError();
}

export type TaskAction =
  | { action: "complete" }
  | { action: "snooze" }
  | { action: "reschedule"; dueAt: string; dueIsAllDay?: boolean };

export async function actOnTask(
  client: SupabaseClient,
  userId: string,
  id: string,
  act: TaskAction,
  prefs: NotificationPrefs
): Promise<{ task: Task; next?: Task }> {
  const now = new Date();
  const current = await getTask(client, id);

  if (act.action === "complete") {
    const { data, error } = await client
      .from("tasks")
      .update({ status: "completed", completed_at: now.toISOString(), next_follow_up_at: null })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) fail(error, "Could not complete task");
    if (!data) throw new NotFoundError();
    const done = rowToTask(data as TaskRow);
    // The trigger already cancelled queued reminders; this also removes any that were inserted concurrently.
    await replanReminders(client, userId, done, prefs);

    let next: Task | undefined;
    if (current.recurrence && current.dueAt) {
      const anchor = new Date(current.dueAt);
      const after = new Date(Math.max(anchor.getTime(), now.getTime()));
      const nextDue = nextOccurrence(anchor, current.recurrence, after, prefs.timezone);
      const ins = await client
        .from("tasks")
        .insert({
          ...taskToRow({
            title: current.title,
            description: current.description,
            dueAt: nextDue.toISOString(),
            dueIsAllDay: current.dueIsAllDay,
            preferredTime: current.preferredTime,
            preferredStartAt: null,
            recurrence: current.recurrence,
            priority: current.priority,
            estimatedMinutes: current.estimatedMinutes,
            constraints: current.constraints,
            reminders: current.reminders,
          }),
          user_id: userId,
        })
        .select("*")
        .single();
      if (ins.error) fail(ins.error, "Could not create the next occurrence");
      next = rowToTask(ins.data as TaskRow);
      await replanReminders(client, userId, next, prefs);
    }
    return { task: done, next };
  }

  if (act.action === "snooze") {
    // "Not yet": the user answered, so the unanswered-nag counter restarts and we remind again at their interval.
    const fresh: Task = { ...current, snoozeCount: 0 };
    const followUp = planNextFollowUp(fresh, now, prefs);
    const { data, error } = await client
      .from("tasks")
      .update({ snooze_count: 0, next_follow_up_at: followUp?.fireAt ?? null })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) fail(error, "Could not snooze task");
    if (!data) throw new NotFoundError();
    const task = rowToTask(data as TaskRow);
    await replanReminders(client, userId, task, prefs, { includeFollowUp: now });
    return { task };
  }

  // reschedule
  const { data, error } = await client
    .from("tasks")
    .update({
      due_at: act.dueAt,
      due_is_all_day: act.dueIsAllDay ?? false,
      snooze_count: 0,
      next_follow_up_at: null,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) fail(error, "Could not reschedule task");
  if (!data) throw new NotFoundError();
  const task = rowToTask(data as TaskRow);
  await replanReminders(client, userId, task, prefs);
  return { task };
}
