"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import clsx from "clsx";
import type { Priority, Recurrence, Settings, TaskFields } from "@/lib/types";
import { planReminders } from "@/lib/reminders";
import { formatWhen, fromLocalInput, offsetLabel, toLocalInput } from "@/lib/time";
import { Segmented } from "./ui";

const PRESETS = [4320, 1440, 180, 60, 15, 5];

export function TaskEditor<T extends TaskFields>({ value, onChange, settings }: { value: T; onChange: (v: T) => void; settings: Settings }) {
  const [custom, setCustom] = useState("");
  const set = (p: Partial<TaskFields>) => onChange({ ...value, ...p });

  const plan = useMemo(
    () =>
      planReminders({
        dueAt: value.dueAt,
        offsets: value.reminderOffsetsMin,
        now: new Date(),
        quiet: { enabled: settings.quietEnabled, start: settings.quietStart, end: settings.quietEnd, tz: settings.timezone },
      }),
    [value.dueAt, value.reminderOffsetsMin, settings.quietEnabled, settings.quietStart, settings.quietEnd, settings.timezone]
  );

  const allOffsets = [...new Set([...PRESETS, ...value.reminderOffsetsMin])].sort((a, b) => b - a);
  const toggleOffset = (o: number) =>
    set({ reminderOffsetsMin: value.reminderOffsetsMin.includes(o) ? value.reminderOffsetsMin.filter((x) => x !== o) : [...value.reminderOffsetsMin, o] });

  function setRepeat(freq: string) {
    if (!freq) return set({ recurrence: null });
    const due = value.dueAt ? new Date(value.dueAt) : new Date();
    const rule: Recurrence = { freq: freq as Recurrence["freq"], interval: 1 };
    if (freq === "weekly") rule.byWeekday = [due.getDay()];
    if (freq === "monthly") rule.byMonthDay = value.recurrence?.byMonthDay ?? due.getDate();
    set({ recurrence: rule });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="t-title">Task</label>
        <input id="t-title" className="field" value={value.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="t-desc">Context</label>
        <textarea id="t-desc" rows={2} className="field resize-none" value={value.description} onChange={(e) => set({ description: e.target.value })} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="t-due">Deadline</label>
          <div className="flex gap-2">
            <input id="t-due" type="datetime-local" className="field" value={toLocalInput(value.dueAt)} onChange={(e) => set({ dueAt: fromLocalInput(e.target.value) })} />
            {value.dueAt && (
              <button className="btn-ghost px-3" aria-label="Clear deadline" onClick={() => set({ dueAt: null, reminderOffsetsMin: [] })}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="t-rep">Repeats</label>
          <select id="t-rep" className="field" value={value.recurrence?.freq ?? ""} onChange={(e) => setRepeat(e.target.value)}>
            <option value="">Doesn't repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="t-pref">Preferred time</label>
          <input id="t-pref" className="field" placeholder="e.g. After 7 PM today" value={value.preferredTime ?? ""} onChange={(e) => set({ preferredTime: e.target.value || null })} />
        </div>
        <div>
          <label className="label" htmlFor="t-dur">Estimated minutes</label>
          <input id="t-dur" type="number" min={0} className="field" value={value.estimatedMinutes ?? ""} onChange={(e) => set({ estimatedMinutes: e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null })} />
        </div>
      </div>

      <div>
        <span className="label">Priority</span>
        <Segmented<Priority>
          label="Priority"
          value={value.priority}
          onChange={(p) => set({ priority: p })}
          options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]}
        />
      </div>

      {value.constraints.length > 0 && (
        <div>
          <span className="label">Constraints</span>
          <div className="flex flex-wrap gap-1.5">
            {value.constraints.map((c) => (
              <span key={c} className="chip">
                {c}
                <button aria-label={`Remove ${c}`} onClick={() => set({ constraints: value.constraints.filter((x) => x !== c) })}><X size={12} /></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className="label">Reminders</span>
        {!value.dueAt ? (
          <p className="text-sm text-muted">Add a deadline to schedule reminders. Without one, nothing will be sent.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {allOffsets.map((o) => {
                const on = value.reminderOffsetsMin.includes(o);
                return (
                  <button key={o} aria-pressed={on} onClick={() => toggleOffset(o)} className={clsx("chip transition", on ? "border-accent bg-accent/10 text-accent" : "hover:bg-line/40")}>
                    {offsetLabel(o)}
                  </button>
                );
              })}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(custom, 10);
                if (n > 0) set({ reminderOffsetsMin: [...new Set([...value.reminderOffsetsMin, n])] });
                setCustom("");
              }}
            >
              <input aria-label="Custom reminder, minutes before" type="number" min={1} className="field max-w-[11rem]" placeholder="Custom: minutes before" value={custom} onChange={(e) => setCustom(e.target.value)} />
              <button className="btn-ghost px-3" aria-label="Add custom reminder"><Plus size={16} /></button>
            </form>
            <div className="mt-3 rounded-xl bg-line/30 p-3 text-sm" aria-live="polite">
              {plan.slots.length ? (
                <>
                  <p className="font-medium">Will remind you:</p>
                  <ul className="mt-1 space-y-0.5 text-muted">
                    {plan.slots.map((s) => (
                      <li key={s.id}>{formatWhen(s.fireAt)} <span className="opacity-70">({offsetLabel(s.offsetMin)})</span></li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-muted">No reminders will be scheduled for this deadline.</p>
              )}
              {plan.dropped.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Skipped: {plan.dropped.map((d) => `${offsetLabel(d.offsetMin)} (${d.reason === "past" ? "already passed" : "no slot outside quiet hours"})`).join(", ")}.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
