import { NextResponse } from "next/server";
import { pushConfigured, serviceClient, webpush } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Server-side reminder + follow-up job. Call it every minute (Vercel Cron on Pro, Supabase pg_cron, or GitHub Actions).
 *
 * Reliability rules:
 *  - Reminders are CLAIMED atomically in SQL (FOR UPDATE SKIP LOCKED), so overlapping runs never double-send.
 *  - Notifications have a unique dedupe_key; a retried run cannot create a second one.
 *  - A reminder for a completed/deleted task is skipped (and deleting a task cascades its reminders anyway).
 *  - We only record what we know: "push_accepted" = the push service accepted it (NOT that a device displayed it),
 *    "in_app_only" = no push subscription / push not configured, "push_failed" = every attempt errored.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = serviceClient();
  if (!sb) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });

  const pushOn = pushConfigured();
  const stats = { reminders: 0, skipped: 0, followups: 0, pushed: 0, failed: 0 };

  async function deliver(userId: string, note: { task_id: string; kind: string; title: string; body: string; dedupe_key: string }) {
    const ins = await sb!.from("notifications").upsert({ user_id: userId, ...note, channel: "in-app", delivery: "in_app_only" }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (ins.error || !ins.data?.length) return "duplicate" as const; // already created by an earlier run
    if (!pushOn) return "in_app_only" as const;
    const { data: subs } = await sb!.from("push_subscriptions").select("*").eq("user_id", userId);
    if (!subs?.length) return "in_app_only" as const;
    let accepted = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: note.title, body: note.body, tag: note.dedupe_key, url: `/?task=${note.task_id}` }), { TTL: 3600, urgency: "high" });
        accepted++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await sb!.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    const delivery = accepted ? "push_accepted" : "push_failed";
    await sb!.from("notifications").update({ channel: accepted ? "push" : "in-app", delivery }).eq("dedupe_key", note.dedupe_key);
    accepted ? stats.pushed++ : stats.failed++;
    return delivery;
  }

  // 1) due reminders
  const claimed = await sb.rpc("claim_due_reminders", { batch_size: 200 });
  for (const r of (claimed.data ?? []) as any[]) {
    const { data: task } = await sb.from("tasks").select("id,user_id,title,due_at,status").eq("id", r.task_id).maybeSingle();
    if (!task || task.status !== "pending" || !task.due_at || new Date(task.due_at) <= new Date()) {
      await sb.from("reminders").update({ sent_at: new Date().toISOString(), delivery: "skipped" }).eq("id", r.id);
      stats.skipped++;
      continue;
    }
    const mins = r.offset_min as number;
    const label = mins >= 1440 ? `${Math.round(mins / 1440)} day(s)` : mins >= 60 ? `${Math.round(mins / 60)} hour(s)` : `${mins} minutes`;
    const result = await deliver(task.user_id, {
      task_id: task.id,
      kind: "reminder",
      title: task.title,
      body: `Due in about ${label} (${new Date(task.due_at).toUTCString()}).`,
      dedupe_key: `reminder:${r.id}`,
    });
    await sb.from("reminders").update({ sent_at: new Date().toISOString(), delivery: result }).eq("id", r.id);
    stats.reminders++;
  }

  // 2) overdue follow-ups ("Did you complete …?"), repeated at each user's own interval until answered (max 12 asks)
  const nowIso = new Date().toISOString();
  const { data: overdue } = await sb.from("tasks").select("id,user_id,title,follow_up_count,next_follow_up_at").eq("status", "pending").lte("next_follow_up_at", nowIso).lt("follow_up_count", 12).limit(200);
  for (const t of (overdue ?? []) as any[]) {
    const { data: st } = await sb.from("settings").select("data").eq("user_id", t.user_id).maybeSingle();
    const interval = (st?.data as any)?.followUpIntervalMin ?? 60;
    // optimistic claim: only one run can move follow_up_count from N to N+1
    const claim = await sb.from("tasks").update({ follow_up_count: t.follow_up_count + 1, next_follow_up_at: new Date(Date.now() + interval * 60000).toISOString() }).eq("id", t.id).eq("follow_up_count", t.follow_up_count).select("id");
    if (!claim.data?.length) continue;
    await deliver(t.user_id, {
      task_id: t.id,
      kind: "followup",
      title: `Did you complete: ${t.title}?`,
      body: "Open LifePilot to mark it done, snooze, or reschedule.",
      dedupe_key: `followup:${t.id}:${t.follow_up_count}`,
    });
    stats.followups++;
  }

  return NextResponse.json({ ok: true, pushConfigured: pushOn, ...stats });
}
