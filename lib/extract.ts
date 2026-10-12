import type { ExtractedTask, Priority, Recurrence, Settings } from "./types";
import { parseLocal } from "./parser";
import { suggestOffsets } from "./reminders";
import { fromLocalInput, toLocalString, uid } from "./time";

export interface ExtractionOutcome {
  tasks: ExtractedTask[];
  engine: "ai" | "demo";
  note?: string;
}

/** Shape the LLM route returns for each task (local wall-clock times, no offsets). */
export interface RawAiTask {
  title?: string;
  description?: string;
  due_local?: string | null;
  preferred_time?: string | null;
  recurrence?: Recurrence | null;
  priority?: string;
  estimated_minutes?: number | null;
  constraints?: string[];
  clarification?: string | null;
  assumptions?: string[];
}

const PRIORITIES: Priority[] = ["low", "medium", "high"];

export function normalizeAi(raw: RawAiTask, settings: Settings, now: Date): ExtractedTask {
  const dueAt = raw.due_local ? fromLocalInput(raw.due_local) : null;
  const priority = PRIORITIES.includes(raw.priority as Priority) ? (raw.priority as Priority) : "medium";
  const rec = raw.recurrence && ["daily", "weekly", "monthly", "yearly"].includes(raw.recurrence.freq) ? { ...raw.recurrence, interval: Math.max(1, raw.recurrence.interval || 1) } : null;
  return {
    tempId: uid(),
    title: (raw.title || "Untitled task").trim(),
    description: (raw.description || "").trim(),
    dueAt,
    preferredTime: raw.preferred_time || null,
    recurrence: rec,
    priority,
    estimatedMinutes: typeof raw.estimated_minutes === "number" ? Math.round(raw.estimated_minutes) : null,
    constraints: Array.isArray(raw.constraints) ? raw.constraints.filter((c) => typeof c === "string") : [],
    reminderOffsetsMin: dueAt ? suggestOffsets(new Date(dueAt), now, settings.defaultOffsets, priority) : [],
    clarification: raw.clarification || null,
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((c) => typeof c === "string") : [],
    source: "ai",
  };
}

export async function extractTasks(text: string, settings: Settings, now: Date = new Date()): Promise<ExtractionOutcome> {
  let note: string | undefined;
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        nowLocal: toLocalString(now),
        weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
        timezone: settings.timezone,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.mode === "ai" && Array.isArray(json.tasks)) {
      return { tasks: json.tasks.map((t: RawAiTask) => normalizeAi(t, settings, now)), engine: "ai" };
    }
    if (json.mode === "error") note = "The AI service didn't respond, so I used the built-in parser instead.";
  } catch {
    note = "Couldn't reach the AI service, so I used the built-in parser instead.";
  }
  const tasks = parseLocal(text, now).map((t) => ({
    ...t,
    reminderOffsetsMin: t.dueAt ? suggestOffsets(new Date(t.dueAt), now, settings.defaultOffsets, t.priority) : [],
  }));
  return { tasks, engine: "demo", note };
}
