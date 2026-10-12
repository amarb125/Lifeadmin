import type { Priority, ReminderSlot } from "./types";
import { inQuiet, uid } from "./time";

export interface QuietConfig {
  enabled: boolean;
  start: string;
  end: string;
  tz: string;
}

/**
 * Adapt the user's default reminder offsets (minutes before the deadline) to the time actually available.
 * - Offsets that would already have passed are dropped rather than fired late.
 * - If every offset is gone but there is still time, a single reminder at the halfway point is kept.
 * - Low priority: fewer nudges (drops the 3h and 15m ones). High priority: adds a 5 minute last call.
 */
export function suggestOffsets(dueAt: Date, now: Date, defaults: number[], priority: Priority = "medium"): number[] {
  const minsLeft = (dueAt.getTime() - now.getTime()) / 60000;
  if (minsLeft <= 1) return [];
  let offsets = [...defaults].sort((a, b) => b - a);
  if (priority === "low") offsets = offsets.filter((o) => o !== 180 && o !== 15);
  if (priority === "high" && !offsets.includes(5)) offsets.push(5);
  const kept = offsets.filter((o) => o < minsLeft);
  if (kept.length === 0 && minsLeft > 5) return [Math.max(1, Math.floor(minsLeft / 2))];
  return kept;
}

/** Move a reminder out of quiet hours. Prefers later; falls back to earlier; returns null if neither is usable. */
export function shiftOutOfQuiet(fire: Date, due: Date, now: Date, q: QuietConfig): Date | null {
  if (!q.enabled || !inQuiet(fire, q.tz, q.start, q.end)) return fire;
  const STEP = 5 * 60000;
  let t = fire.getTime();
  for (let i = 0; i < (24 * 60) / 5; i++) {
    t += STEP;
    if (!inQuiet(new Date(t), q.tz, q.start, q.end)) break;
  }
  if (t < due.getTime() - STEP && !inQuiet(new Date(t), q.tz, q.start, q.end)) return new Date(t);
  t = fire.getTime();
  for (let i = 0; i < (24 * 60) / 5; i++) {
    t -= STEP;
    if (!inQuiet(new Date(t), q.tz, q.start, q.end)) break;
  }
  if (t > now.getTime() && !inQuiet(new Date(t), q.tz, q.start, q.end)) return new Date(t);
  return null;
}

export interface PlanResult {
  slots: ReminderSlot[];
  /** offsets that were not scheduled, with the reason */
  dropped: { offsetMin: number; reason: "past" | "quiet-hours" }[];
}

/** Turn a deadline + offsets into concrete reminder instants. Pure and deterministic apart from slot ids. */
export function planReminders(opts: { dueAt: string | null; offsets: number[]; now: Date; quiet: QuietConfig }): PlanResult {
  const { dueAt, offsets, now, quiet } = opts;
  const out: PlanResult = { slots: [], dropped: [] };
  if (!dueAt) return out;
  const due = new Date(dueAt);
  if (isNaN(due.getTime())) return out;
  const seen = new Set<number>();
  for (const offsetMin of [...new Set(offsets)].sort((a, b) => b - a)) {
    const raw = new Date(due.getTime() - offsetMin * 60000);
    if (raw.getTime() <= now.getTime()) {
      out.dropped.push({ offsetMin, reason: "past" });
      continue;
    }
    const fire = shiftOutOfQuiet(raw, due, now, quiet);
    if (!fire) {
      out.dropped.push({ offsetMin, reason: "quiet-hours" });
      continue;
    }
    const minute = Math.floor(fire.getTime() / 60000); // never two reminders in the same minute
    if (seen.has(minute)) continue;
    seen.add(minute);
    out.slots.push({ id: uid(), fireAt: fire.toISOString(), offsetMin, status: "pending" });
  }
  out.slots.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  return out;
}
