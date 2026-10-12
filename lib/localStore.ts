import type { DraftTask, InAppNotification, NotificationPrefs, Priority, Task } from "./types";
import { collectDueInApp, notificationCopy, planNextFollowUp, uid } from "./reminders";
import { isSameLocalDay, nextOccurrence } from "./time";

/**
 * Pure state transitions for demo mode (data lives in the browser). They mirror what the server does in
 * cloud mode, so the UI behaves the same either way. No React, no storage: easy to test.
 */

export function draftToTask(d: DraftTask, now: Date): Task {
  const iso = now.toISOString();
  return {
    id: uid("task"),
    title: d.title.trim(),
    description: d.description,
    dueAt: d.dueAt,
    dueIsAllDay: d.dueIsAllDay,
    preferredTime: d.preferredTime,
    preferredStartAt: d.preferredStartAt,
    recurrence: d.recurrence,
    priority: d.priority,
    estimatedMinutes: d.estimatedMinutes,
    constraints: d.constraints,
    reminders: d.reminders,
    status: "active",
    completedAt: null,
    snoozeCount: 0,
    nextFollowUpAt: null,
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Payload for POST /api/tasks. */
export function draftToInput(d: DraftTask) {
  return {
    title: d.title.trim(),
    description: d.description,
    dueAt: d.dueAt,
    dueIsAllDay: d.dueIsAllDay,
    preferredTime: d.preferredTime,
    preferredStartAt: d.preferredStartAt,
    recurrence: d.recurrence,
    priority: d.priority,
    estimatedMinutes: d.estimatedMinutes,
    constraints: d.constraints,
    reminders: d.reminders,
  };
}

export function isOverdue(task: Task, now: Date): boolean {
  return task.status === "active" && task.dueAt !== null && new Date(task.dueAt).getTime() <= now.getTime();
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function bucketTasks(tasks: Task[], now: Date, tz: string) {
  const active = tasks.filter((t) => t.status === "active");
  const byDue = (a: Task, b: Task) =>
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  const overdue = active.filter((t) => isOverdue(t, now)).sort(byDue);
  const open = active.filter((t) => !isOverdue(t, now));
  const today = open.filter((t) => t.dueAt && isSameLocalDay(new Date(t.dueAt), now, tz)).sort(byDue);
  const upcoming = open.filter((t) => t.dueAt && !isSameLocalDay(new Date(t.dueAt), now, tz)).sort(byDue);
  const noDeadline = open.filter((t) => !t.dueAt).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const completed = tasks
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return { overdue, today, upcoming, noDeadline, completed };
}

export function completeLocal(tasks: Task[], id: string, now: Date, tz: string): Task[] {
  const cur = tasks.find((t) => t.id === id);
  if (!cur || cur.status !== "active") return tasks;
  const iso = now.toISOString();
  const out = tasks.map((t) =>
    t.id === id ? { ...t, status: "completed" as const, completedAt: iso, nextFollowUpAt: null, updatedAt: iso } : t
  );
  if (cur.recurrence && cur.dueAt) {
    const anchor = new Date(cur.dueAt);
    const after = new Date(Math.max(anchor.getTime(), now.getTime()));
    const nextDue = nextOccurrence(anchor, cur.recurrence, after, tz);
    out.push({
      ...cur,
      id: uid("task"),
      dueAt: nextDue.toISOString(),
      preferredStartAt: null,
      status: "active",
      completedAt: null,
      snoozeCount: 0,
      nextFollowUpAt: null,
      createdAt: iso,
      updatedAt: iso,
    });
  }
  return out;
}

/** "Not yet, remind me later": the user answered, so the unanswered-nag counter restarts. */
export function snoozeLocal(tasks: Task[], id: string, now: Date, prefs: NotificationPrefs): Task[] {
  return tasks.map((t) => {
    if (t.id !== id || t.status !== "active") return t;
    const fresh = { ...t, snoozeCount: 0 };
    const f = planNextFollowUp(fresh, now, prefs);
    return { ...fresh, nextFollowUpAt: f?.fireAt ?? null, updatedAt: now.toISOString() };
  });
}

export function rescheduleLocal(tasks: Task[], id: string, dueAt: Date, allDay: boolean, now: Date): Task[] {
  return tasks.map((t) =>
    t.id === id && t.status === "active"
      ? { ...t, dueAt: dueAt.toISOString(), dueIsAllDay: allDay, snoozeCount: 0, nextFollowUpAt: null, updatedAt: now.toISOString() }
      : t
  );
}

/**
 * Demo mode has no server, so reminders can only surface while the app is open. This finds what became due,
 * produces in-app notifications (one per task, never repeated), and advances the follow-up cycle.
 */
export function tickLocal(tasks: Task[], prefs: NotificationPrefs, now: Date, seen: Set<string>) {
  const { shown, newlySeen } = collectDueInApp(tasks, prefs, now, seen);
  if (!shown.length) return { tasks, notifications: [] as InAppNotification[], newlySeen };

  const notifications: InAppNotification[] = [];
  const updates = new Map<string, Partial<Task>>();
  for (const { task, rem } of shown) {
    const copy = notificationCopy(task, rem.kind, rem.label);
    notifications.push({
      id: uid("n"),
      taskId: task.id,
      kind: rem.kind,
      title: copy.title,
      body: copy.body,
      at: now.toISOString(),
      read: false,
    });
    if (rem.kind === "overdue" || rem.kind === "followup") {
      const sent = task.snoozeCount + 1;
      const next = planNextFollowUp({ ...task, snoozeCount: sent }, now, prefs);
      updates.set(task.id, { snoozeCount: sent, nextFollowUpAt: next?.fireAt ?? null });
    }
  }
  const next = updates.size ? tasks.map((t) => (updates.has(t.id) ? { ...t, ...updates.get(t.id) } : t)) : tasks;
  return { tasks: next, notifications, newlySeen };
}

export function deleteLocal(tasks: Task[], id: string): Task[] {
  return tasks.filter((t) => t.id !== id);
}
