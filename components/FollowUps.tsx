"use client";

import { useState } from "react";
import { CalendarClock, Check, Clock } from "lucide-react";
import type { Task } from "@/lib/types";
import { formatWhen, fromLocalInput, toLocalInput } from "@/lib/time";
import { useApp } from "@/lib/app-context";

function FollowUp({ task }: { task: Task }) {
  const { completeTask, snoozeTask, rescheduleTask, settings } = useApp();
  const [picking, setPicking] = useState(false);
  const [val, setVal] = useState(toLocalInput(new Date(Date.now() + 3600000).toISOString()));
  const iso = fromLocalInput(val);
  const valid = iso && new Date(iso) > new Date();
  const mins = settings.followUpIntervalMin;

  return (
    <li className="rounded-2xl border-2 border-warn/60 bg-warn/5 p-4 animate-rise">
      <p className="text-xs font-medium uppercase tracking-wide text-warn">Check-in · was due {formatWhen(task.dueAt)}</p>
      <h3 className="mt-1 font-display text-xl leading-snug">Did you complete: {task.title}?</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => completeTask(task.id)}><Check size={16} />Yes, completed</button>
        <button className="btn-ghost" onClick={() => snoozeTask(task.id)}><Clock size={16} />Not yet — remind me in {mins >= 60 ? `${mins / 60}h` : `${mins}m`}</button>
        <button className="btn-ghost" onClick={() => setPicking((p) => !p)} aria-expanded={picking}><CalendarClock size={16} />Reschedule</button>
      </div>
      {picking && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (valid && iso) rescheduleTask(task.id, iso); }}>
          <label className="sr-only" htmlFor={`rs-${task.id}`}>New deadline</label>
          <input id={`rs-${task.id}`} type="datetime-local" className="field max-w-[15rem]" value={val} onChange={(e) => setVal(e.target.value)} />
          <button className="btn-primary" disabled={!valid}>Set new deadline</button>
          {!valid && <span className="self-center text-xs text-muted">Pick a time in the future.</span>}
        </form>
      )}
    </li>
  );
}

export function FollowUps({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return null;
  return <ul className="space-y-3" aria-label="Tasks waiting for your answer">{tasks.map((t) => <FollowUp key={t.id} task={t} />)}</ul>;
}
