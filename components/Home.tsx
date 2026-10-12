"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Settings as Gear, X } from "lucide-react";
import clsx from "clsx";
import { useApp } from "@/lib/app-context";
import { extractTasks, type ExtractionOutcome } from "@/lib/extract";
import type { Task } from "@/lib/types";
import { dayDiff } from "@/lib/time";
import { Capture } from "./Capture";
import { ConfirmSheet } from "./ConfirmSheet";
import { FollowUps } from "./FollowUps";
import { TaskCard } from "./TaskCard";
import { TaskEditor } from "./TaskEditor";
import { Sheet } from "./ui";
import { SettingsSheet } from "./SettingsSheet";
import { InboxSheet } from "./InboxSheet";

type Tab = "today" | "upcoming" | "overdue" | "completed";

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Home() {
  const app = useApp();
  const { tasks, settings, notifications, toasts, tzChanged } = app;
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>("today");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [modeBannerHidden, setModeBannerHidden] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const groups = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "pending");
    const byDue = (a: Task, b: Task) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9");
    const overdue = pending.filter((t) => t.dueAt && new Date(t.dueAt) < now).sort(byDue);
    const today = pending.filter((t) => t.dueAt && new Date(t.dueAt) >= now && dayDiff(new Date(t.dueAt), now) === 0).sort(byDue);
    const upcoming = pending.filter((t) => !t.dueAt || dayDiff(new Date(t.dueAt), now) > 0).sort(byDue);
    const completed = tasks.filter((t) => t.status === "completed").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")).slice(0, 50);
    const followUps = pending.filter((t) => t.dueAt && t.nextFollowUpAt && new Date(t.nextFollowUpAt) <= now);
    return { overdue, today, upcoming, completed, followUps };
  }, [tasks, now]);

  async function handleSubmit(text: string) {
    setBusy(true);
    try {
      const res = await extractTasks(text, settings);
      const clean = res.tasks.length > 0 && res.tasks.every((t) => !(t.clarification && !t.dueAt));
      if (settings.autoSave && clean) {
        await app.addTasks(res.tasks);
        app.toast({ kind: "info", title: `Saved ${res.tasks.length} task${res.tasks.length > 1 ? "s" : ""}`, body: res.tasks.map((t) => t.title).join(" · ") });
      } else setOutcome(res);
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string; items: Task[] }[] = [
    { id: "today", label: "Today", items: groups.today },
    { id: "upcoming", label: "Upcoming", items: groups.upcoming },
    { id: "overdue", label: "Overdue", items: groups.overdue },
    { id: "completed", label: "Completed", items: groups.completed },
  ];
  const current = tabs.find((t) => t.id === tab)!;
  const unread = notifications.filter((n) => !n.readAt).length;
  const empty: Record<Tab, string> = {
    today: "Nothing due today. Tell me what's coming up and I'll plan it.",
    upcoming: "No upcoming tasks.",
    overdue: "Nothing overdue. Nice.",
    completed: "Completed tasks will show up here.",
  };

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-24 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">{greeting(now)}</h1>
        </div>
        <div className="flex gap-1">
          <button aria-label={`Inbox${unread ? `, ${unread} unread` : ""}`} onClick={() => setShowInbox(true)} className="relative rounded-full p-2.5 hover:bg-line/50">
            <Bell size={22} />
            {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-bold text-white">{unread}</span>}
          </button>
          <button aria-label="Settings" onClick={() => setShowSettings(true)} className="rounded-full p-2.5 hover:bg-line/50"><Gear size={22} /></button>
        </div>
      </header>

      {app.mode === "demo" && !modeBannerHidden && (
        <div className="card mb-4 flex items-start gap-3 p-3 text-sm text-muted" role="note">
          <p className="flex-1"><strong className="text-ink">Demo mode.</strong> Tasks are saved in this browser only, and reminders appear while LifePilot is open. Connect Supabase for accounts and background reminders.</p>
          <button aria-label="Dismiss" onClick={() => setModeBannerHidden(true)}><X size={16} /></button>
        </div>
      )}
      {tzChanged && (
        <div className="mb-4 rounded-2xl border border-gold/50 bg-gold/10 p-3 text-sm" role="alert">
          Your time zone changed from <strong>{tzChanged}</strong> to <strong>{settings.timezone === tzChanged ? "this device's zone" : settings.timezone}</strong>. Re-plan reminders so quiet hours follow where you are now?
          <button className="btn-primary ml-2 mt-2 py-1.5" onClick={app.replanAll}>Re-plan</button>
        </div>
      )}

      <div className="space-y-4">
        <FollowUps tasks={groups.followUps} />
        <Capture onSubmit={handleSubmit} busy={busy} />
      </div>

      <nav className="mt-8 flex gap-1 overflow-x-auto" role="tablist" aria-label="Task lists">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx("flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition", tab === t.id ? "bg-ink text-bg" : "text-muted hover:bg-line/40")}>
            {t.label}
            <span className={clsx("rounded-full px-1.5 text-xs", t.id === "overdue" && t.items.length ? "bg-warn text-white" : "bg-line/60 text-muted")}>{t.items.length}</span>
          </button>
        ))}
      </nav>

      <ul className="mt-4 space-y-3" role="tabpanel">
        {current.items.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            now={now}
            onComplete={() => app.completeTask(t.id)}
            onEdit={() => setEditing(t)}
            onDelete={() => window.confirm(`Delete "${t.title}"? Its reminders will be cancelled.`) && app.deleteTask(t.id)}
          />
        ))}
        {current.items.length === 0 && <li className="py-10 text-center text-muted">{empty[tab]}</li>}
      </ul>

      <ConfirmSheet
        drafts={outcome?.tasks ?? null}
        engine={outcome?.engine ?? "demo"}
        note={outcome?.note}
        settings={settings}
        onClose={() => setOutcome(null)}
        onSave={async (items) => {
          setOutcome(null);
          await app.addTasks(items);
          app.toast({ kind: "info", title: `Saved ${items.length} task${items.length > 1 ? "s" : ""}`, body: "Reminders are scheduled." });
        }}
      />

      <EditSheet task={editing} onClose={() => setEditing(null)} />
      <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)} />
      <InboxSheet open={showInbox} onClose={() => setShowInbox(false)} />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-w-md flex-col gap-2 p-4" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={clsx("pointer-events-auto flex animate-rise items-start gap-3 rounded-2xl p-3 shadow-xl", t.kind === "error" ? "bg-warn text-white" : "bg-ink text-bg")}>
            <div className="min-w-0 flex-1"><p className="font-medium">{t.title}</p><p className="text-sm opacity-80">{t.body}</p></div>
            <button aria-label="Dismiss" onClick={() => app.dismissToast(t.id)}><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { updateTask, settings } = useApp();
  const [draft, setDraft] = useState<Task | null>(task);
  useEffect(() => setDraft(task), [task]);
  return (
    <Sheet open={!!task && !!draft} onClose={onClose} title="Edit task">
      {draft && (
        <>
          <TaskEditor value={draft} onChange={setDraft} settings={settings} />
          <div className="mt-5 flex gap-2">
            <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex-[2]" onClick={async () => { await updateTask(draft.id, draft); onClose(); }}>Save changes</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
