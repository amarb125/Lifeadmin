import type { NotificationPrefs, Task } from "./types";
import { DEFAULT_PREFS } from "./types";

/* Database row <-> Task. Kept dependency-free so both server routes and tests can use it. */

export interface TaskRow {
  id: string;
  user_id?: string;
  title: string;
  description: string;
  due_at: string | null;
  due_is_all_day: boolean;
  preferred_time: string | null;
  preferred_start_at: string | null;
  recurrence: Task["recurrence"];
  priority: Task["priority"];
  estimated_minutes: number | null;
  constraints: string[] | null;
  reminders: Task["reminders"] | null;
  status: "active" | "completed";
  completed_at: string | null;
  snooze_count: number;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    dueAt: r.due_at,
    dueIsAllDay: r.due_is_all_day,
    preferredTime: r.preferred_time,
    preferredStartAt: r.preferred_start_at,
    recurrence: r.recurrence ?? null,
    priority: r.priority,
    estimatedMinutes: r.estimated_minutes,
    constraints: r.constraints ?? [],
    reminders: r.reminders ?? [],
    status: r.status,
    completedAt: r.completed_at,
    snoozeCount: r.snooze_count,
    nextFollowUpAt: r.next_follow_up_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Columns a client is allowed to write. Never includes id, user_id or timestamps we control. */
export function taskToRow(t: Partial<Task>): Partial<TaskRow> {
  const out: Partial<TaskRow> = {};
  if (t.title !== undefined) out.title = t.title;
  if (t.description !== undefined) out.description = t.description;
  if (t.dueAt !== undefined) out.due_at = t.dueAt;
  if (t.dueIsAllDay !== undefined) out.due_is_all_day = t.dueIsAllDay;
  if (t.preferredTime !== undefined) out.preferred_time = t.preferredTime;
  if (t.preferredStartAt !== undefined) out.preferred_start_at = t.preferredStartAt;
  if (t.recurrence !== undefined) out.recurrence = t.recurrence;
  if (t.priority !== undefined) out.priority = t.priority;
  if (t.estimatedMinutes !== undefined) out.estimated_minutes = t.estimatedMinutes;
  if (t.constraints !== undefined) out.constraints = t.constraints;
  if (t.reminders !== undefined) out.reminders = t.reminders;
  if (t.status !== undefined && t.status !== "deleted") out.status = t.status;
  if (t.completedAt !== undefined) out.completed_at = t.completedAt;
  if (t.snoozeCount !== undefined) out.snooze_count = t.snoozeCount;
  if (t.nextFollowUpAt !== undefined) out.next_follow_up_at = t.nextFollowUpAt;
  return out;
}

export function mergePrefs(stored: Partial<NotificationPrefs> | null | undefined, fallbackTz?: string): NotificationPrefs {
  return { ...DEFAULT_PREFS, ...(fallbackTz ? { timezone: fallbackTz } : {}), ...(stored ?? {}) };
}
