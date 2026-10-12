"use client";

import { useEffect, useState } from "react";
import { HelpCircle, Info, Trash2 } from "lucide-react";
import type { ExtractedTask, Settings } from "@/lib/types";
import { parseLocal } from "@/lib/parser";
import { suggestOffsets } from "@/lib/reminders";
import { describeRecurrence } from "@/lib/recurrence";
import { Sheet } from "./ui";
import { TaskEditor } from "./TaskEditor";

export function ConfirmSheet({ drafts, engine, note, settings, onSave, onClose }: { drafts: ExtractedTask[] | null; engine: "ai" | "demo"; note?: string; settings: Settings; onSave: (t: ExtractedTask[]) => void; onClose: () => void }) {
  const [items, setItems] = useState<ExtractedTask[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErr, setAnswerErr] = useState<Record<string, string>>({});

  useEffect(() => {
    setItems(drafts ?? []);
    setAnswers({});
    setAnswerErr({});
  }, [drafts]);

  const unresolved = (t: ExtractedTask) => Boolean(t.clarification) && !t.dueAt;
  const blocked = items.some(unresolved);

  function applyAnswer(t: ExtractedTask) {
    const a = (answers[t.tempId] || "").trim();
    const hit = a ? parseLocal(a, new Date())[0] : null;
    if (!hit || (!hit.dueAt && !hit.recurrence)) return setAnswerErr((e) => ({ ...e, [t.tempId]: "I couldn't read a date from that. Try “Friday 5 PM” or pick one below." }));
    const dueAt = hit.dueAt;
    setAnswerErr((e) => ({ ...e, [t.tempId]: "" }));
    setItems((xs) =>
      xs.map((x) =>
        x.tempId === t.tempId
          ? { ...x, dueAt, recurrence: x.recurrence ?? hit.recurrence, clarification: null, reminderOffsetsMin: dueAt ? suggestOffsets(new Date(dueAt), new Date(), settings.defaultOffsets, x.priority) : [] }
          : x
      )
    );
  }

  return (
    <Sheet open={!!drafts} onClose={onClose} title={items.length > 1 ? `Review ${items.length} tasks` : "Review task"}>
      <p className="mb-4 text-sm text-muted">
        {engine === "ai" ? "Here's what I understood." : "Here's what I understood (built-in parser — connect an AI key for smarter reading)."} Nothing is saved until you confirm.
      </p>
      {note && <p className="mb-3 rounded-xl bg-gold/15 p-3 text-sm">{note}</p>}
      {items.length === 0 && <p className="text-sm text-muted">I couldn't find a task in that. Try rephrasing.</p>}

      <div className="space-y-5">
        {items.map((t, i) => (
          <article key={t.tempId} className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Task {i + 1}{t.recurrence ? ` · ${describeRecurrence(t.recurrence)}` : ""}</span>
              <button aria-label="Discard this task" className="rounded-full p-1.5 text-muted hover:bg-line/50" onClick={() => setItems((xs) => xs.filter((x) => x.tempId !== t.tempId))}>
                <Trash2 size={16} />
              </button>
            </div>

            {unresolved(t) && (
              <div className="mb-4 rounded-xl border border-gold/50 bg-gold/10 p-3" role="group" aria-label="Question">
                <p className="flex gap-2 text-sm font-medium"><HelpCircle size={18} className="mt-0.5 shrink-0 text-gold" />{t.clarification}</p>
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); applyAnswer(t); }}>
                  <input aria-label="Your answer" className="field" placeholder="e.g. Friday 5 PM" value={answers[t.tempId] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [t.tempId]: e.target.value }))} />
                  <button className="btn-primary px-4">Set</button>
                </form>
                {answerErr[t.tempId] && <p className="mt-1 text-xs text-warn">{answerErr[t.tempId]}</p>}
                <button className="mt-2 text-xs text-muted underline" onClick={() => setItems((xs) => xs.map((x) => (x.tempId === t.tempId ? { ...x, clarification: null } : x)))}>
                  No deadline — save without one
                </button>
              </div>
            )}

            {t.assumptions.length > 0 && (
              <ul className="mb-4 space-y-1">
                {t.assumptions.map((a) => (
                  <li key={a} className="flex gap-2 text-xs text-muted"><Info size={14} className="mt-0.5 shrink-0" />{a}</li>
                ))}
              </ul>
            )}

            <TaskEditor value={t} settings={settings} onChange={(v) => setItems((xs) => xs.map((x) => (x.tempId === t.tempId ? v : x)))} />
          </article>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-5 mt-5 flex gap-2 bg-bg/95 px-5 py-3 backdrop-blur">
        <button className="btn-ghost flex-1" onClick={onClose}>Discard</button>
        <button className="btn-primary flex-[2]" disabled={!items.length || blocked} onClick={() => onSave(items)}>
          {blocked ? "Answer the question above" : `Save ${items.length > 1 ? `${items.length} tasks` : "task"}`}
        </button>
      </div>
    </Sheet>
  );
}
