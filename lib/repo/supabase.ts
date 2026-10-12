import type { AppNotification, ReminderSlot, Settings, Task } from "../types";
import type { Repo, Snapshot } from "./types";
import { supabase } from "../supabase-browser";

/* eslint-disable @typescript-eslint/no-explicit-any */
const toTask = (r: any): Task => ({
  id: r.id,
  title: r.title,
  description: r.description ?? "",
  dueAt: r.due_at,
  preferredTime: r.preferred_time,
  recurrence: r.recurrence,
  priority: r.priority,
  estimatedMinutes: r.estimated_minutes,
  constraints: r.constraints ?? [],
  reminderOffsetsMin: r.reminder_offsets ?? [],
  status: r.status,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  completedOnTime: r.completed_on_time,
  nextFollowUpAt: r.next_follow_up_at,
  followUpCount: r.follow_up_count ?? 0,
  reminders: ((r.reminders ?? []) as any[])
    .filter((x) => !x.sent_at)
    .map((x): ReminderSlot => ({ id: x.id, fireAt: x.fire_at, offsetMin: x.offset_min, status: "pending" }))
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt)),
});

const toNotification = (r: any): AppNotification => ({
  id: r.id,
  taskId: r.task_id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
  readAt: r.read_at,
  dedupeKey: r.dedupe_key,
  channel: r.channel,
});

/** Persistent storage + server-side scheduling. Reminder rows are what the cron job reads. */
export const supabaseRepo: Repo = {
  async load(): Promise<Snapshot> {
    const sb = supabase();
    const [tasks, settings, notes] = await Promise.all([
      sb.from("tasks").select("*, reminders(*)").order("due_at", { ascending: true, nullsFirst: false }),
      sb.from("settings").select("data").maybeSingle(),
      sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (tasks.error) throw tasks.error;
    return {
      tasks: (tasks.data ?? []).map(toTask),
      settings: (settings.data?.data as Settings) ?? null,
      notifications: (notes.data ?? []).map(toNotification),
    };
  },

  async upsertTask(task) {
    const sb = supabase();
    const { error } = await sb.from("tasks").upsert({
      id: task.id,
      title: task.title,
      description: task.description,
      due_at: task.dueAt,
      preferred_time: task.preferredTime,
      recurrence: task.recurrence,
      priority: task.priority,
      estimated_minutes: task.estimatedMinutes,
      constraints: task.constraints,
      reminder_offsets: task.reminderOffsetsMin,
      status: task.status,
      completed_at: task.completedAt,
      completed_on_time: task.completedOnTime,
      next_follow_up_at: task.nextFollowUpAt,
      follow_up_count: task.followUpCount,
    });
    if (error) throw error;
    // Replace reminders that have not been claimed by the scheduler yet. Completed tasks end up with none.
    const del = await sb.from("reminders").delete().eq("task_id", task.id).is("claimed_at", null);
    if (del.error) throw del.error;
    if (task.status === "pending" && task.reminders.length) {
      const ins = await sb
        .from("reminders")
        .upsert(task.reminders.map((s) => ({ task_id: task.id, fire_at: s.fireAt, offset_min: s.offsetMin })), { onConflict: "task_id,fire_at", ignoreDuplicates: true });
      if (ins.error) throw ins.error;
    }
  },

  async deleteTask(id) {
    const { error } = await supabase().from("tasks").delete().eq("id", id); // reminders cascade
    if (error) throw error;
  },

  async saveSettings(settings) {
    const { data: u } = await supabase().auth.getUser();
    if (!u.user) return;
    const { error } = await supabase().from("settings").upsert({ user_id: u.user.id, data: settings });
    if (error) throw error;
  },

  async addNotifications() {
    /* notifications are created server-side by the cron job in this mode */
  },

  async markRead(ids) {
    if (!ids.length) return;
    await supabase().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  },
};
