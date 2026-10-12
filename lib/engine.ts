import type { AppNotification, Settings, Task } from "./types";
import { formatTime, offsetLabel, uid } from "./time";

export interface EngineResult {
  tasks: Task[];
  created: AppNotification[];
}

const LATE_AFTER_MIN = 5;

/**
 * Client-side reminder pass used in demo (no-backend) mode. It only runs while the app is open,
 * so anything it shows late says so. In Supabase mode the same decisions are made server-side by /api/cron/reminders.
 *
 * Duplicate protection: a slot is only ever shown once (status flips to "shown"/"missed"),
 * and every notification carries a dedupeKey that is checked against existing notifications.
 */
export function runEngine(tasks: Task[], existing: AppNotification[], _settings: Settings, now: Date): EngineResult {
  const keys = new Set(existing.map((n) => n.dedupeKey));
  const created: AppNotification[] = [];
  const nowMs = now.getTime();

  const next = tasks.map((task) => {
    if (task.status !== "pending") return task;
    let changed = false;
    let t = task;

    const due = t.reminders.filter((s) => s.status === "pending" && new Date(s.fireAt).getTime() <= nowMs);
    if (due.length) {
      const latest = due[due.length - 1];
      const late = (nowMs - new Date(latest.fireAt).getTime()) / 60000 > LATE_AFTER_MIN;
      const key = `reminder:${task.id}:${latest.id}`;
      const dueTime = task.dueAt ? new Date(task.dueAt) : null;
      const stillUpcoming = dueTime ? dueTime.getTime() > nowMs : false;
      if (stillUpcoming && !keys.has(key)) {
        keys.add(key);
        created.push({
          id: uid(),
          taskId: task.id,
          kind: "reminder",
          title: task.title,
          body:
            `Due ${dueTime!.toDateString() === now.toDateString() ? "today" : dueTime!.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${formatTime(dueTime!)} (${offsetLabel(latest.offsetMin)} reminder).` +
            (late ? " Shown late — LifePilot wasn't open when this was scheduled." : ""),
          createdAt: now.toISOString(),
          readAt: null,
          dedupeKey: key,
          channel: "in-app",
        });
      }
      t = {
        ...t,
        reminders: t.reminders.map((s) => {
          if (!due.some((d) => d.id === s.id)) return s;
          return { ...s, status: s.id === latest.id && stillUpcoming ? "shown" : "missed" };
        }),
      };
      changed = true;
    }

    if (t.dueAt && t.nextFollowUpAt && new Date(t.nextFollowUpAt).getTime() <= nowMs) {
      const key = `followup:${task.id}:${t.nextFollowUpAt}`;
      if (!keys.has(key)) {
        keys.add(key);
        created.push({
          id: uid(),
          taskId: task.id,
          kind: "followup",
          title: `Did you complete: ${task.title}?`,
          body: "This was due " + new Date(t.dueAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) + ". Mark it done, snooze, or reschedule.",
          createdAt: now.toISOString(),
          readAt: null,
          dedupeKey: key,
          channel: "in-app",
        });
      }
    }
    return changed ? t : task;
  });

  return { tasks: next, created };
}
