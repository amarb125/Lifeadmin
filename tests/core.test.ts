import { describe, expect, it } from "vitest";
import { parseLocal } from "../lib/parser";
import { planReminders, suggestOffsets } from "../lib/reminders";
import { nextDue } from "../lib/recurrence";
import { runEngine } from "../lib/engine";
import type { Task } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";

// Monday 12 Oct 2026, 06:36 local (TZ=Asia/Kolkata in the npm script)
const NOW = new Date(2026, 9, 12, 6, 36);
const quiet = { enabled: true, start: "22:00", end: "07:00", tz: "Asia/Kolkata" };

describe("parser", () => {
  it("splits the spec's multi-task example and never invents missing deadlines", () => {
    const t = parseLocal("Buy groceries tomorrow evening, pay the electricity bill before Wednesday and submit the document by Friday at 5 PM", NOW);
    expect(t).toHaveLength(3);
    expect(t[0].title).toBe("Buy groceries");
    expect(new Date(t[0].dueAt!).getDate()).toBe(13);
    expect(t[0].assumptions.length).toBeGreaterThan(0); // "evening" → assumed time is disclosed
    expect(t[1].title.toLowerCase()).toContain("electricity bill");
    expect(new Date(t[1].dueAt!).getDay()).toBe(2); // before Wednesday → Tuesday
    expect(new Date(t[2].dueAt!).getDay()).toBe(5);
    expect(new Date(t[2].dueAt!).getHours()).toBe(17);
    expect(t[2].assumptions).toHaveLength(0);
  });

  it("keeps the presentation example as one task with a preferred time", () => {
    const t = parseLocal("I need to finish my office presentation by tomorrow at 4 PM. I can only work on it after 7 PM today.", NOW);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe("Finish my office presentation");
    const due = new Date(t[0].dueAt!);
    expect([due.getDate(), due.getHours()]).toEqual([13, 16]);
    expect(t[0].preferredTime).toMatch(/after 7:00\s?PM today/i);
  });

  it("detects monthly recurrence for rent on the first", () => {
    const [t] = parseLocal("Remind me to pay rent on the first of every month.", NOW);
    expect(t.title).toBe("Pay rent");
    expect(t.recurrence).toEqual({ freq: "monthly", interval: 1, byMonthDay: 1 });
    const due = new Date(t.dueAt!);
    expect([due.getFullYear(), due.getMonth(), due.getDate()]).toEqual([2026, 10, 1]);
  });

  it("asks instead of guessing when there is no date", () => {
    const [t] = parseLocal("Call the plumber", NOW);
    expect(t.dueAt).toBeNull();
    expect(t.clarification).toMatch(/when/i);
    expect(t.reminderOffsetsMin).toEqual([]);
  });

  it("asks which day for a bare 'every month'", () => {
    const [t] = parseLocal("Review subscriptions every month", NOW);
    expect(t.clarification).toMatch(/day of the month/i);
  });

  it("handles 'day after tomorrow' and durations", () => {
    const [t] = parseLocal("Write the report for 2 hours the day after tomorrow at 10 am", NOW);
    expect(new Date(t.dueAt!).getDate()).toBe(14);
    expect(t.estimatedMinutes).toBe(120);
  });
});

describe("reminders", () => {
  it("drops offsets already in the past instead of firing late", () => {
    const due = new Date(NOW.getTime() + 2 * 3600000);
    expect(suggestOffsets(due, NOW, [1440, 180, 60, 15])).toEqual([60, 15]);
  });

  it("falls back to a halfway reminder when every offset is too long", () => {
    const due = new Date(NOW.getTime() + 10 * 60000);
    expect(suggestOffsets(due, NOW, [1440, 180, 60, 15])).toEqual([5]);
  });

  it("moves reminders out of quiet hours and never schedules two in the same minute", () => {
    const due = new Date(2026, 9, 14, 7, 30); // 07:30 Wed
    const { slots } = planReminders({ dueAt: due.toISOString(), offsets: [1440, 180, 60, 15], now: NOW, quiet });
    for (const s of slots) {
      const d = new Date(s.fireAt);
      const mins = d.getHours() * 60 + d.getMinutes();
      expect(mins >= 7 * 60 && mins < 22 * 60).toBe(true);
    }
    expect(new Set(slots.map((s) => s.fireAt.slice(0, 16))).size).toBe(slots.length);
  });

  it("is DST-safe for recurring tasks (wall-clock time preserved)", () => {
    const d = nextDue(new Date(2026, 2, 28, 9, 0), { freq: "daily", interval: 1 });
    expect(d.getHours()).toBe(9);
  });
});

describe("engine", () => {
  const base: Task = {
    id: "t1", title: "Submit report", description: "", dueAt: new Date(2026, 9, 12, 7, 0).toISOString(), preferredTime: null,
    recurrence: null, priority: "high", estimatedMinutes: null, constraints: [], reminderOffsetsMin: [15],
    status: "pending", createdAt: NOW.toISOString(), completedAt: null, completedOnTime: null,
    nextFollowUpAt: new Date(2026, 9, 12, 7, 0).toISOString(), followUpCount: 0,
    reminders: [{ id: "s1", fireAt: new Date(2026, 9, 12, 6, 45).toISOString(), offsetMin: 15, status: "pending" }],
  };

  it("fires a due reminder once and never twice", () => {
    const at = new Date(2026, 9, 12, 6, 46);
    const r1 = runEngine([base], [], DEFAULT_SETTINGS, at);
    expect(r1.created).toHaveLength(1);
    const r2 = runEngine(r1.tasks, r1.created, DEFAULT_SETTINGS, new Date(at.getTime() + 60000));
    expect(r2.created).toHaveLength(0);
  });

  it("asks a follow-up after the deadline, and not for completed tasks", () => {
    const after = new Date(2026, 9, 12, 7, 5);
    const r = runEngine([{ ...base, reminders: [] }], [], DEFAULT_SETTINGS, after);
    expect(r.created.map((n) => n.kind)).toEqual(["followup"]);
    const done = runEngine([{ ...base, status: "completed", reminders: [] }], [], DEFAULT_SETTINGS, after);
    expect(done.created).toHaveLength(0);
  });
});
