import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Task } from "../types";
import { rowToTask, type TaskRow } from "../mapping";
import { applyQuietHours, notificationCopy, planNextFollowUp } from "../reminders";
import { loadPrefs } from "./taskService";

/**
 * Sends due reminders. Safe to run on overlapping schedules:
 *  - claim_due_reminders() atomically claims rows (FOR UPDATE SKIP LOCKED), so each row is handled once.
 *  - notifications.reminder_id is unique, so even a retry after a crash cannot create a second notification.
 *
 * What "sent" means: the notification was written to the in-app inbox and handed to the push service.
 * A push service accepting a message is NOT confirmation that a device displayed it, and we never claim that.
 */

interface ReminderRow {
  id: string;
  task_id: string;
  user_id: string;
  fire_at: string;
  kind: "before" | "overdue" | "followup";
  label: string;
  attempts: number;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  rescheduled: number;
  cancelled: number;
  skipped: number;
  failed: number;
  push: { accepted: number; noSubscription: number; notConfigured: number; failed: number };
}

let vapidReady: boolean | null = null;
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (pub && priv && subject) {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  } else {
    vapidReady = false;
  }
  return vapidReady;
}

type PushStatus = "accepted" | "no_subscription" | "not_configured" | "failed";

async function sendPush(admin: SupabaseClient, userId: string, payload: object, urgent: boolean): Promise<PushStatus> {
  if (!ensureVapid()) return "not_configured";
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, failure_count").eq("user_id", userId);
  if (!subs?.length) return "no_subscription";

  let accepted = 0;
  for (const s of subs as { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: urgent ? "high" : "normal", timeout: 10_000 }
      );
      accepted++;
      await admin.from("push_subscriptions").update({ last_accepted_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // The browser unsubscribed; this endpoint will never work again.
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        await admin.from("push_subscriptions").update({ failure_count: s.failure_count + 1 }).eq("id", s.id);
      }
    }
  }
  return accepted > 0 ? "accepted" : "failed";
}

export async function dispatchDue(admin: SupabaseClient): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    claimed: 0, sent: 0, rescheduled: 0, cancelled: 0, skipped: 0, failed: 0,
    push: { accepted: 0, noSubscription: 0, notConfigured: 0, failed: 0 },
  };

  const { data, error } = await admin.rpc("claim_due_reminders", { batch: 100 });
  if (error) throw new Error(`claim_due_reminders failed: ${error.message}`);
  const claimed = (data ?? []) as ReminderRow[];
  summary.claimed = claimed.length;

  const prefsCache = new Map<string, Awaited<ReturnType<typeof loadPrefs>>>();

  for (const r of claimed) {
    try {
      const { data: row } = await admin.from("tasks").select("*").eq("id", r.task_id).maybeSingle();
      const task: Task | null = row ? rowToTask(row as TaskRow) : null;

      // Completed or deleted since it was scheduled: never notify.
      if (!task || task.status !== "active") {
        await admin.from("reminders").update({ status: "cancelled", note: "task no longer active" }).eq("id", r.id);
        summary.cancelled++;
        continue;
      }

      let prefs = prefsCache.get(r.user_id);
      if (!prefs) {
        prefs = await loadPrefs(admin, r.user_id);
        prefsCache.set(r.user_id, prefs);
      }
      const now = new Date();
      const due = task.dueAt ? new Date(task.dueAt) : null;

      // A "due soon" reminder that is now stale (deadline long gone) is pointless.
      if (r.kind === "before" && due && due.getTime() < now.getTime() - 5 * 60_000) {
        await admin.from("reminders").update({ status: "skipped", note: "deadline already passed" }).eq("id", r.id);
        summary.skipped++;
        continue;
      }

      // Quiet hours may have changed since this was planned. Re-check at send time.
      const shifted = applyQuietHours(now, r.kind === "before" ? due : null, task.priority, prefs, now);
      if (shifted === null) {
        await admin.from("reminders").update({ status: "skipped", note: "suppressed by quiet hours" }).eq("id", r.id);
        summary.skipped++;
        continue;
      }
      if (shifted.getTime() > now.getTime() + 60_000) {
        await admin
          .from("reminders")
          .update({
            status: "pending",
            claimed_at: null,
            fire_at: shifted.toISOString(),
            dedupe_key: `${r.task_id}:${r.kind}:${shifted.toISOString()}`,
            note: "moved out of quiet hours",
          })
          .eq("id", r.id);
        summary.rescheduled++;
        continue;
      }

      const copy = notificationCopy(task, r.kind, r.label);

      // Unique reminder_id guarantees at most one notification per reminder, even across retries.
      const ins = await admin
        .from("notifications")
        .insert({
          user_id: r.user_id,
          task_id: task.id,
          reminder_id: r.id,
          kind: r.kind,
          title: copy.title,
          body: copy.body,
          push_status: "no_subscription",
        })
        .select("id")
        .single();

      if (ins.error) {
        if (ins.error.code === "23505") {
          await admin.from("reminders").update({ status: "sent", sent_at: now.toISOString(), note: "already recorded" }).eq("id", r.id);
          summary.sent++;
          continue;
        }
        throw new Error(ins.error.message);
      }

      const pushStatus = await sendPush(
        admin,
        r.user_id,
        {
          title: copy.title,
          body: copy.body,
          taskId: task.id,
          kind: r.kind,
          tag: `${task.id}:${r.kind}`,
          url: `/?task=${task.id}${r.kind === "before" ? "" : "&followup=1"}`,
        },
        task.priority === "urgent" || r.kind !== "before"
      );
      await admin.from("notifications").update({ push_status: pushStatus }).eq("id", ins.data.id);
      if (pushStatus === "accepted") summary.push.accepted++;
      else if (pushStatus === "failed") summary.push.failed++;
      else if (pushStatus === "not_configured") summary.push.notConfigured++;
      else summary.push.noSubscription++;

      await admin.from("reminders").update({ status: "sent", sent_at: now.toISOString(), note: `push:${pushStatus}` }).eq("id", r.id);
      summary.sent++;

      // The deadline prompt and each follow-up trigger the next follow-up, until the user answers or the cap is hit.
      if (r.kind === "overdue" || r.kind === "followup") {
        const sentCount = task.snoozeCount + 1;
        const progressed: Task = { ...task, snoozeCount: sentCount };
        const next = planNextFollowUp(progressed, now, prefs);
        await admin
          .from("tasks")
          .update({ snooze_count: sentCount, next_follow_up_at: next?.fireAt ?? null })
          .eq("id", task.id)
          .eq("status", "active");
        if (next) {
          await admin.from("reminders").upsert(
            {
              task_id: task.id,
              user_id: r.user_id,
              fire_at: next.fireAt,
              kind: next.kind,
              label: next.label,
              status: "pending",
              dedupe_key: next.dedupeKey,
            },
            { onConflict: "dedupe_key", ignoreDuplicates: true }
          );
        }
      }
    } catch (e) {
      summary.failed++;
      await admin
        .from("reminders")
        .update({ status: r.attempts >= 3 ? "failed" : "pending", claimed_at: null, note: `error: ${(e as Error).message}`.slice(0, 300) })
        .eq("id", r.id);
    }
  }
  return summary;
}
