"use client";

import { Bell, Check, Clock, Pencil, Repeat, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { Task } from "@/lib/types";
import { describeRecurrence } from "@/lib/recurrence";
import { formatWhen, relative } from "@/lib/time";

const DOT = { high: "bg-warn", medium: "bg-gold", low: "bg-muted" } as const;

export function TaskCard({ task, now, onComplete, onEdit, onDelete }: { task: Task; now: Date; onComplete: () => void; onEdit: () => void; onDelete: () => void }) {
  const done = task.status === "completed";
  const overdue = !done && task.dueAt && new Date(task.dueAt) < now;
  const pending = task.reminders.filter((r) => r.status === "pending").length;

  return (
    <li className={clsx("card flex gap-3 p-4 animate-rise", overdue && "border-warn/50")}>
      <button
        onClick={onComplete}
        disabled={done}
        aria-label={done ? "Completed" : `Mark "${task.title}" complete`}
        className={clsx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition", done ? "border-accent bg-accent text-accent-ink" : "border-line hover:border-accent")}
      >
        {done && <Check size={16} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className={clsx("font-medium leading-snug", done && "text-muted line-through")}>{task.title}</h3>
          {!done && <span title={`${task.priority} priority`} aria-label={`${task.priority} priority`} className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOT[task.priority])} />}
        </div>

        <p className={clsx("mt-0.5 flex items-center gap-1.5 text-sm", overdue ? "text-warn" : "text-muted")}>
          <Clock size={14} />
          {done && task.completedAt ? `Done ${formatWhen(task.completedAt, now)}${task.completedOnTime === false ? " (late)" : ""}` : formatWhen(task.dueAt, now)}
          {!done && task.dueAt && <span className="opacity-80">· {relative(task.dueAt, now)}</span>}
        </p>

        {(task.recurrence || task.preferredTime || task.estimatedMinutes || task.constraints.length > 0 || (!done && pending > 0)) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.recurrence && <span className="chip"><Repeat size={12} />{describeRecurrence(task.recurrence)}</span>}
            {task.preferredTime && <span className="chip">{task.preferredTime}</span>}
            {task.estimatedMinutes ? <span className="chip">~{task.estimatedMinutes >= 60 ? `${Math.round((task.estimatedMinutes / 60) * 10) / 10}h` : `${task.estimatedMinutes}m`}</span> : null}
            {task.constraints.map((c) => <span key={c} className="chip">{c}</span>)}
            {!done && pending > 0 && <span className="chip"><Bell size={12} />{pending} reminder{pending > 1 ? "s" : ""}</span>}
          </div>
        )}
        {task.description && task.description !== task.title && !done && <p className="mt-2 line-clamp-2 text-sm text-muted">{task.description}</p>}
      </div>

      <div className="flex shrink-0 flex-col gap-1">
        {!done && <button aria-label={`Edit ${task.title}`} onClick={onEdit} className="rounded-full p-2 text-muted hover:bg-line/50"><Pencil size={16} /></button>}
        <button aria-label={`Delete ${task.title}`} onClick={onDelete} className="rounded-full p-2 text-muted hover:bg-line/50 hover:text-warn"><Trash2 size={16} /></button>
      </div>
    </li>
  );
}
