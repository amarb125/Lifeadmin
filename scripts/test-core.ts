/* Run with: npm test   (tsx scripts/test-core.ts) — no network or extra deps needed. */
import assert from "node:assert/strict";
import { parseHeuristic, applyClarificationAnswer } from "../lib/parser";
import { fmt, zonedDate, nextOccurrence, inQuietHours, addLocalDays, localParts } from "../lib/time";
import { planAll, planNextFollowUp, applyQuietHours, collectDueInApp } from "../lib/reminders";
import { DEFAULT_PREFS, type NotificationPrefs, type Task } from "../lib/types";
import { convertLlmOutput } from "../lib/server/llm";
import { bucketTasks, completeLocal, rescheduleLocal, snoozeLocal, tickLocal } from "../lib/localStore";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const IST = "Asia/Calcutta";
const prefs: NotificationPrefs = { ...DEFAULT_PREFS, timezone: IST };
// Monday 12 Oct 2026, 10:00 IST
const now = zonedDate(IST, 2026, 9, 12, 10, 0);
const at = (iso: string | null, tz = IST) => (iso ? fmt(iso, tz, "EEE d MMM h:mm a") : null);

console.log("time");
test("zonedDate round-trips in IST", () => {
  assert.equal(now.toISOString(), "2026-10-12T04:30:00.000Z");
  assert.equal(fmt(now, IST, "EEE d MMM yyyy h:mm a"), "Mon 12 Oct 2026 10:00 AM");
});
test("local time is preserved across a US DST change", () => {
  const tz = "America/New_York";
  // US DST ends Sun 1 Nov 2026 at 2 AM: Sat 31 Oct 4 PM (EDT) -> Sun 1 Nov 4 PM (EST) is 25 real hours.
  const before = zonedDate(tz, 2026, 9, 31, 16, 0);
  const next = addLocalDays(before, 1, tz);
  const p = localParts(next, tz);
  assert.equal(p.hour, 16);
  assert.equal(p.day, 1);
  assert.equal((next.getTime() - before.getTime()) / 3600000, 25);
  // Spring forward (Sun 8 Mar 2026): Sat 7 Mar 4 PM (EST) -> Sun 8 Mar 4 PM (EDT) is 23 real hours.
  const s1 = zonedDate(tz, 2026, 2, 7, 16, 0);
  assert.equal((addLocalDays(s1, 1, tz).getTime() - s1.getTime()) / 3600000, 23);
});
test("quiet hours wrap midnight", () => {
  assert.ok(inQuietHours(zonedDate(IST, 2026, 9, 12, 23, 0), IST, "22:30", "07:00"));
  assert.ok(inQuietHours(zonedDate(IST, 2026, 9, 12, 6, 59), IST, "22:30", "07:00"));
  assert.ok(!inQuietHours(zonedDate(IST, 2026, 9, 12, 7, 0), IST, "22:30", "07:00"));
});
test("monthly recurrence clamps to short months", () => {
  const anchor = zonedDate(IST, 2026, 0, 31, 9, 0);
  const n = nextOccurrence(anchor, { freq: "monthly", interval: 1, byMonthDay: 31 }, anchor, IST);
  assert.equal(fmt(n, IST, "d MMM"), "28 Feb");
});

console.log("parser");
test("three tasks from one sentence", () => {
  const r = parseHeuristic(
    "I need to buy groceries tomorrow evening, pay the electricity bill before Wednesday, and submit the document by Friday at 5 PM.",
    now, IST, prefs
  );
  assert.equal(r.tasks.length, 3);
  const [a, b, c] = r.tasks;
  assert.equal(a.title, "Buy groceries");
  assert.equal(at(a.dueAt), "Tue 13 Oct 6:00 PM");
  assert.ok(a.assumptions.some((x) => /evening/.test(x)), "records the evening assumption");
  assert.equal(b.title, "Pay the electricity bill");
  assert.equal(b.dueIsAllDay, true);
  assert.equal(fmt(b.dueAt!, IST, "EEE d MMM"), "Tue 13 Oct");
  assert.equal(c.title, "Submit the document");
  assert.equal(at(c.dueAt), "Fri 16 Oct 5:00 PM");
  for (const t of r.tasks) assert.equal(t.clarifications.length, 0);
});
test("follow-on sentence becomes a constraint, not a new task", () => {
  const r = parseHeuristic(
    "I need to finish my office presentation by tomorrow at 4 PM. I can only work on it after 7 PM today.",
    now, IST, prefs
  );
  assert.equal(r.tasks.length, 1);
  const t = r.tasks[0];
  assert.equal(t.title, "Finish my office presentation");
  assert.equal(at(t.dueAt), "Tue 13 Oct 4:00 PM");
  assert.equal(at(t.preferredStartAt), "Mon 12 Oct 7:00 PM");
  assert.ok(t.constraints.some((c) => /after 7 pm today/i.test(c)));
});
test("monthly recurrence on the first", () => {
  const r = parseHeuristic("Remind me to pay rent on the first of every month.", now, IST, prefs);
  assert.equal(r.tasks.length, 1);
  const t = r.tasks[0];
  assert.deepEqual(t.recurrence, { freq: "monthly", interval: 1, byMonthDay: 1 });
  assert.equal(t.title, "Pay rent");
  assert.equal(fmt(t.dueAt!, IST, "EEE d MMM"), "Sun 1 Nov");
  assert.equal(t.clarifications.length, 0);
});
test("never invents a deadline", () => {
  const r = parseHeuristic("Call the dentist", now, IST, prefs);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.tasks[0].dueAt, null);
  assert.equal(r.tasks[0].clarifications[0]?.field, "dueAt");
});
test("ambiguous hour asks AM or PM, and the answer resolves it", () => {
  const r = parseHeuristic("Buy milk tomorrow at 4", now, IST, prefs);
  const t = r.tasks[0];
  assert.equal(t.dueAt, null);
  assert.match(t.clarifications[0].question, /AM or 4 PM/);
  const fixed = applyClarificationAnswer(t, t.clarifications[0], "pm", now, IST, prefs);
  assert.equal(at(fixed.dueAt), "Tue 13 Oct 4:00 PM");
  assert.equal(fixed.clarifications.length, 0);
});
test("'next week' alone asks which day", () => {
  const r = parseHeuristic("Submit the report next week", now, IST, prefs);
  assert.equal(r.tasks[0].dueAt, null);
  assert.match(r.tasks[0].clarifications[0].question, /Which day next week/);
});
test("priority and duration extraction", () => {
  const r = parseHeuristic("Urgent: send the invoice by tomorrow 11 am, it takes 30 minutes", now, IST, prefs);
  const t = r.tasks[0];
  assert.equal(t.priority, "urgent");
  assert.equal(t.estimatedMinutes, 30);
  assert.equal(at(t.dueAt), "Tue 13 Oct 11:00 AM");
});
test("weekly recurrence on named days", () => {
  const r = parseHeuristic("Go to the gym every Monday and Thursday at 6 PM", now, IST, prefs);
  const t = r.tasks[0];
  assert.deepEqual(t.recurrence?.byWeekday, [1, 4]);
  assert.equal(at(t.dueAt), "Mon 12 Oct 6:00 PM");
});

console.log("reminders");
const baseTask = (over: Partial<Task>): Task => ({
  id: "t1", title: "Submit report", description: "", dueAt: null, dueIsAllDay: false,
  preferredTime: null, preferredStartAt: null, recurrence: null, priority: "medium",
  estimatedMinutes: null, constraints: [], reminders: [], status: "active", completedAt: null,
  snoozeCount: 0, nextFollowUpAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...over,
});
const offs = (m: number[]) => m.map((x, i) => ({ id: `r${i}`, minutesBefore: x, enabled: true }));

test("skips offsets already in the past", () => {
  const due = new Date(now.getTime() + 2 * 3600_000); // due in 2h, 12:00 IST
  const task = baseTask({ dueAt: due.toISOString(), reminders: offs([1440, 180, 60, 15]) });
  const plan = planAll(task, { now, prefs });
  const kinds = plan.map((p) => `${p.kind}:${p.label}`);
  assert.deepEqual(kinds, ["before:Due in 1 hour", "before:Due in 15 min", "overdue:Deadline reached"]);
});
test("dedupe keys are unique and stable", () => {
  const due = new Date(now.getTime() + 30 * 3600_000);
  const task = baseTask({ dueAt: due.toISOString(), reminders: offs([1440, 180, 60, 15]) });
  const a = planAll(task, { now, prefs }).map((p) => p.dedupeKey);
  const b = planAll(task, { now, prefs }).map((p) => p.dedupeKey);
  assert.equal(new Set(a).size, a.length);
  assert.deepEqual(a, b);
});
test("quiet hours push a night reminder to morning", () => {
  const fire = zonedDate(IST, 2026, 9, 12, 23, 30);
  const due = zonedDate(IST, 2026, 9, 13, 18, 0);
  const shifted = applyQuietHours(fire, due, "medium", prefs, now)!;
  assert.equal(at(shifted.toISOString()), "Tue 13 Oct 7:00 AM");
});
test("urgent tasks may break quiet hours near the deadline", () => {
  const due = zonedDate(IST, 2026, 9, 13, 0, 30);
  const fire = new Date(due.getTime() - 15 * 60_000);
  const kept = applyQuietHours(fire, due, "urgent", prefs, now)!;
  assert.equal(kept.getTime(), fire.getTime());
});
test("a reminder that would land after the deadline fires before quiet hours start instead", () => {
  const due = zonedDate(IST, 2026, 9, 12, 23, 0); // due 11 PM, inside quiet hours
  const fire = new Date(due.getTime() - 15 * 60_000);
  const moved = applyQuietHours(fire, due, "medium", prefs, now)!;
  assert.equal(at(moved.toISOString()), "Mon 12 Oct 10:25 PM");
});
test("follow-ups stop after the configured maximum", () => {
  const task = baseTask({ dueAt: now.toISOString(), snoozeCount: prefs.maxFollowUps });
  assert.equal(planNextFollowUp(task, now, prefs), null);
  assert.ok(planNextFollowUp({ ...task, snoozeCount: 1 }, now, prefs));
});
test("completed and deleted tasks plan nothing", () => {
  const due = new Date(now.getTime() + 5 * 3600_000).toISOString();
  for (const status of ["completed", "deleted"] as const) {
    const task = baseTask({ dueAt: due, status, reminders: offs([60]) });
    assert.equal(planAll(task, { now, prefs }).length, 0);
    assert.equal(planNextFollowUp(task, now, prefs), null);
  }
});
test("demo in-app notifications: one per task, never repeated", () => {
  const due = new Date(now.getTime() - 30 * 60_000); // overdue by 30 min, app was closed
  const task = baseTask({ dueAt: due.toISOString(), reminders: offs([1440, 180, 60]) });
  const seen = new Set<string>();
  const first = collectDueInApp([task], prefs, now, seen);
  assert.equal(first.shown.length, 1);
  assert.equal(first.shown[0].rem.kind, "overdue");
  first.newlySeen.forEach((k) => seen.add(k));
  assert.equal(collectDueInApp([task], prefs, now, seen).shown.length, 0);
});

console.log("demo-mode state transitions");
test("completing a recurring task keeps history and creates the next occurrence", () => {
  const due = zonedDate(IST, 2026, 9, 12, 9, 0);
  const t = baseTask({ dueAt: due.toISOString(), recurrence: { freq: "monthly", interval: 1, byMonthDay: 12 }, reminders: offs([60]) });
  const out = completeLocal([t], "t1", now, IST);
  assert.equal(out.length, 2);
  assert.equal(out[0].status, "completed");
  assert.equal(out[1].status, "active");
  assert.equal(fmt(out[1].dueAt!, IST, "d MMM h:mm a"), "12 Nov 9:00 AM");
  assert.notEqual(out[1].id, out[0].id);
});
test("completing a one-off task adds nothing and clears the follow-up", () => {
  const t = baseTask({ dueAt: now.toISOString(), nextFollowUpAt: now.toISOString() });
  const out = completeLocal([t], "t1", now, IST);
  assert.equal(out.length, 1);
  assert.equal(out[0].nextFollowUpAt, null);
  assert.ok(out[0].completedAt);
});
test("snooze schedules a follow-up at the configured interval and resets the nag count", () => {
  const t = baseTask({ dueAt: now.toISOString(), snoozeCount: 5 });
  const [s] = snoozeLocal([t], "t1", now, { ...prefs, quietHoursEnabled: false, followUpIntervalMinutes: 90 });
  assert.equal(s.snoozeCount, 0);
  assert.equal(new Date(s.nextFollowUpAt!).getTime() - now.getTime(), 90 * 60_000);
});
test("reschedule moves the deadline and restarts follow-ups", () => {
  const t = baseTask({ dueAt: now.toISOString(), snoozeCount: 3, nextFollowUpAt: now.toISOString() });
  const to = zonedDate(IST, 2026, 9, 14, 17, 0);
  const [r] = rescheduleLocal([t], "t1", to, false, now);
  assert.equal(r.dueAt, to.toISOString());
  assert.equal(r.snoozeCount, 0);
  assert.equal(r.nextFollowUpAt, null);
});
test("tick: overdue prompt fires once, then follow-ups continue until the cap, then stop", () => {
  const p = { ...prefs, quietHoursEnabled: false, followUpIntervalMinutes: 60, maxFollowUps: 2 };
  const due = new Date(now.getTime() - 5 * 60_000);
  let tasks = [baseTask({ dueAt: due.toISOString(), reminders: [] })];
  const seen = new Set<string>();
  let clock = now;
  const kinds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = tickLocal(tasks, p, clock, seen);
    r.newlySeen.forEach((k) => seen.add(k));
    tasks = r.tasks;
    r.notifications.forEach((n) => kinds.push(n.kind));
    clock = new Date(clock.getTime() + 61 * 60_000);
  }
  assert.deepEqual(kinds, ["overdue", "followup"]); // cap of 2 prompts total
  assert.equal(tasks[0].nextFollowUpAt, null);
});
test("tick never notifies for completed tasks", () => {
  const t = baseTask({ dueAt: new Date(now.getTime() - 3600_000).toISOString(), status: "completed" });
  assert.equal(tickLocal([t], prefs, now, new Set()).notifications.length, 0);
});
test("buckets: overdue / today / upcoming / no deadline / completed", () => {
  const mk = (id: string, due: Date | null, over: Partial<Task> = {}) =>
    baseTask({ id, dueAt: due ? due.toISOString() : null, ...over });
  const tasks = [
    mk("past", new Date(now.getTime() - 3600_000)),
    mk("today", zonedDate(IST, 2026, 9, 12, 18, 0)),
    mk("later", zonedDate(IST, 2026, 9, 15, 18, 0)),
    mk("none", null),
    mk("done", null, { status: "completed", completedAt: now.toISOString() }),
  ];
  const b = bucketTasks(tasks, now, IST);
  assert.deepEqual(b.overdue.map((t) => t.id), ["past"]);
  assert.deepEqual(b.today.map((t) => t.id), ["today"]);
  assert.deepEqual(b.upcoming.map((t) => t.id), ["later"]);
  assert.deepEqual(b.noDeadline.map((t) => t.id), ["none"]);
  assert.deepEqual(b.completed.map((t) => t.id), ["done"]);
});

console.log("llm output conversion");
test("converts model output to UTC using the user's timezone", () => {
  const drafts = convertLlmOutput(
    { tasks: [{ title: "Submit report", priority: "high", due_date: "2026-10-16", due_time: "17:00", description: "" }] },
    now, IST, prefs
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].dueAt, "2026-10-16T11:30:00.000Z");
  assert.equal(drafts[0].clarifications.length, 0);
  assert.ok(drafts[0].reminders.length >= 3);
});
test("missing deadline becomes a clarification, never a guess", () => {
  const [d] = convertLlmOutput({ tasks: [{ title: "Call dentist", priority: "medium" }] }, now, IST, prefs);
  assert.equal(d.dueAt, null);
  assert.equal(d.clarifications[0].field, "dueAt");
});
test("explicit 'no deadline' is respected", () => {
  const [d] = convertLlmOutput({ tasks: [{ title: "Learn guitar", priority: "low", no_deadline_intended: true }] }, now, IST, prefs);
  assert.equal(d.dueAt, null);
  assert.equal(d.clarifications.length, 0);
});
test("rejects impossible and past dates, ignores junk shapes", () => {
  const ds = convertLlmOutput(
    { tasks: [
      { title: "A", priority: "medium", due_date: "2026-02-31", due_time: "09:00" },
      { title: "B", priority: "medium", due_date: "2026-10-01", due_time: "09:00" },
      { title: "", priority: "medium" },
      null,
      "nope",
    ] },
    now, IST, prefs
  );
  assert.equal(ds.length, 2);
  assert.equal(ds[0].dueAt, null);
  assert.equal(ds[1].dueAt, null);
  assert.match(ds[1].clarifications[0].question, /already in the past/);
  assert.deepEqual(convertLlmOutput({ tasks: "x" }, now, IST, prefs), []);
});
test("date without time is an all-day deadline", () => {
  const [d] = convertLlmOutput({ tasks: [{ title: "Pay bill", priority: "medium", due_date: "2026-10-20", due_time: null }] }, now, IST, prefs);
  assert.equal(d.dueIsAllDay, true);
  assert.equal(fmt(d.dueAt!, IST, "d MMM h:mm a"), "20 Oct 11:59 PM");
});

console.log(`\n${passed} passed${process.exitCode ? " (with failures)" : ""}`);
