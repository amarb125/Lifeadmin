"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type AppNotification, type ExtractedTask, type Settings, type Task, type TaskFields } from "./types";
import { localRepo } from "./repo/local";
import { supabaseRepo } from "./repo/supabase";
import type { Repo } from "./repo/types";
import { SUPABASE_CONFIGURED, supabase } from "./supabase-browser";
import { planReminders, suggestOffsets } from "./reminders";
import { nextDue } from "./recurrence";
import { runEngine } from "./engine";
import { localTz, uid } from "./time";

export interface Toast {
  id: string;
  title: string;
  body: string;
  kind: "reminder" | "followup" | "info" | "error";
}

interface Ctx {
  ready: boolean;
  mode: "demo" | "supabase";
  userEmail: string | null;
  tasks: Task[];
  notifications: AppNotification[];
  settings: Settings;
  toasts: Toast[];
  tzChanged: string | null;
  addTasks: (items: (TaskFields | ExtractedTask)[]) => Promise<void>;
  updateTask: (id: string, fields: TaskFields) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  snoozeTask: (id: string) => Promise<void>;
  rescheduleTask: (id: string, dueAtIso: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  replanAll: () => Promise<void>;
  markAllRead: () => Promise<void>;
  enablePush: () => Promise<string>;
  pushPermission: "unsupported" | "default" | "granted" | "denied";
  pushServerReady: boolean;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  signInGoogle: () => Promise<string | null>;
  signInEmail: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  authChecked: boolean;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const MODE = SUPABASE_CONFIGURED ? "supabase" : "demo";
const repo: Repo = SUPABASE_CONFIGURED ? supabaseRepo : localRepo;

function quietOf(s: Settings) {
  return { enabled: s.quietEnabled, start: s.quietStart, end: s.quietEnd, tz: s.timezone };
}

function makeTask(f: TaskFields, s: Settings, now: Date): Task {
  const plan = planReminders({ dueAt: f.dueAt, offsets: f.reminderOffsetsMin, now, quiet: quietOf(s) });
  return {
    title: f.title.trim() || "Untitled task",
    description: f.description,
    dueAt: f.dueAt,
    preferredTime: f.preferredTime,
    recurrence: f.recurrence,
    priority: f.priority,
    estimatedMinutes: f.estimatedMinutes,
    constraints: f.constraints,
    reminderOffsetsMin: f.reminderOffsetsMin,
    id: uid(),
    status: "pending",
    createdAt: now.toISOString(),
    completedAt: null,
    completedOnTime: null,
    nextFollowUpAt: f.dueAt,
    followUpCount: 0,
    reminders: plan.slots,
  };
}

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function browserNotify(n: AppNotification): Promise<boolean> {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(n.title, { body: n.body, tag: n.dedupeKey, icon: "/icon.svg" });
    else new Notification(n.title, { body: n.body, tag: n.dedupeKey });
    return true;
  } catch {
    return false;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(MODE === "demo");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(MODE === "demo");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tzChanged, setTzChanged] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<Ctx["pushPermission"]>("default");

  const tasksRef = useRef(tasks);
  const notesRef = useRef(notifications);
  const settingsRef = useRef(settings);
  tasksRef.current = tasks;
  notesRef.current = notifications;
  settingsRef.current = settings;

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 9000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  /* ---------- auth (Supabase mode) ---------- */
  useEffect(() => {
    if (MODE !== "supabase") return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setUserEmail(data.session?.user.email ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user.email ?? null);
      if (!session) {
        setTasks([]);
        setNotifications([]);
        setReady(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---------- initial load ---------- */
  const load = useCallback(async () => {
    try {
      const snap = await repo.load();
      const merged: Settings = { ...DEFAULT_SETTINGS, timezone: localTz(), ...(snap.settings ?? {}) };
      if (snap.settings && snap.settings.timezone && snap.settings.timezone !== localTz()) setTzChanged(snap.settings.timezone);
      setSettings(merged);
      setTasks(snap.tasks);
      setNotifications(snap.notifications);
    } catch (e) {
      toast({ kind: "error", title: "Couldn't load your tasks", body: e instanceof Error ? e.message : "Please check your connection and reload." });
    } finally {
      setReady(true);
    }
  }, [toast]);

  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  /* ---------- service worker + permission ---------- */
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    setPushPermission(typeof Notification === "undefined" ? "unsupported" : (Notification.permission as Ctx["pushPermission"]));
  }, []);

  /* ---------- reminder loop ---------- */
  const tick = useCallback(async () => {
    if (!ready) return;
    if (MODE === "supabase") {
      // The server decides and sends; we just pull new state and surface what's new.
      try {
        const snap = await repo.load();
        const known = new Set(notesRef.current.map((n) => n.id));
        const fresh = snap.notifications.filter((n) => !known.has(n.id) && !n.readAt);
        setTasks(snap.tasks);
        setNotifications(snap.notifications);
        fresh.slice(0, 3).forEach((n) => toast({ kind: n.kind, title: n.title, body: n.body }));
      } catch {
        /* transient; try again next tick */
      }
      return;
    }
    const now = new Date();
    const prev = tasksRef.current;
    const r = runEngine(prev, notesRef.current, settingsRef.current, now);
    const changed = r.tasks.filter((t, i) => t !== prev[i]);
    if (!changed.length && !r.created.length) return;
    const notified = await Promise.all(r.created.map(async (n) => ((await browserNotify(n)) ? ({ ...n, channel: "browser" } as AppNotification) : n)));
    setTasks(r.tasks);
    setNotifications((x) => [...notified, ...x]);
    await Promise.all(changed.map((t) => repo.upsertTask(t)));
    await repo.addNotifications(notified);
    notified.forEach((n) => toast({ kind: n.kind, title: n.title, body: n.body }));
  }, [ready, toast]);

  useEffect(() => {
    if (!ready) return;
    tick();
    const id = setInterval(tick, MODE === "supabase" ? 45000 : 15000);
    const vis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ready, tick]);

  /* ---------- mutations ---------- */
  const persist = useCallback(async (t: Task) => {
    setTasks((x) => (x.some((y) => y.id === t.id) ? x.map((y) => (y.id === t.id ? t : y)) : [t, ...x]));
    try {
      await repo.upsertTask(t);
    } catch (e) {
      toast({ kind: "error", title: "Couldn't save", body: e instanceof Error ? e.message : "Try again." });
    }
  }, [toast]);

  const addTasks: Ctx["addTasks"] = async (items) => {
    const now = new Date();
    for (const f of items) await persist(makeTask(f, settingsRef.current, now));
  };

  const updateTask: Ctx["updateTask"] = async (id, f) => {
    const old = tasksRef.current.find((t) => t.id === id);
    if (!old) return;
    const now = new Date();
    const plan = planReminders({ dueAt: f.dueAt, offsets: f.reminderOffsetsMin, now, quiet: quietOf(settingsRef.current) });
    const dueChanged = old.dueAt !== f.dueAt;
    await persist({ ...old, ...f, title: f.title.trim() || old.title, reminders: plan.slots, nextFollowUpAt: dueChanged ? f.dueAt : old.nextFollowUpAt, followUpCount: dueChanged ? 0 : old.followUpCount });
  };

  const deleteTask: Ctx["deleteTask"] = async (id) => {
    setTasks((x) => x.filter((t) => t.id !== id)); // reminders go with it: client slots live on the task, server rows cascade
    try {
      await repo.deleteTask(id);
    } catch (e) {
      toast({ kind: "error", title: "Couldn't delete", body: e instanceof Error ? e.message : "Try again." });
      load();
    }
  };

  const completeTask: Ctx["completeTask"] = async (id) => {
    const old = tasksRef.current.find((t) => t.id === id);
    if (!old) return;
    const now = new Date();
    const onTime = old.dueAt ? now.getTime() <= new Date(old.dueAt).getTime() : null;
    await persist({ ...old, status: "completed", completedAt: now.toISOString(), completedOnTime: onTime, nextFollowUpAt: null, reminders: [] });
    if (old.recurrence && old.dueAt) {
      let d = nextDue(new Date(old.dueAt), old.recurrence);
      for (let i = 0; i < 400 && d <= now; i++) d = nextDue(d, old.recurrence);
      const offsets = suggestOffsets(d, now, settingsRef.current.defaultOffsets, old.priority);
      await persist(makeTask({ ...old, dueAt: d.toISOString(), reminderOffsetsMin: offsets }, settingsRef.current, now));
      toast({ kind: "info", title: "Done — and scheduled the next one", body: `${old.title} repeats on ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}.` });
    }
  };

  const snoozeTask: Ctx["snoozeTask"] = async (id) => {
    const old = tasksRef.current.find((t) => t.id === id);
    if (!old) return;
    const mins = settingsRef.current.followUpIntervalMin;
    await persist({ ...old, nextFollowUpAt: new Date(Date.now() + mins * 60000).toISOString(), followUpCount: old.followUpCount + 1 });
    toast({ kind: "info", title: "I'll ask again", body: `Next check-in on "${old.title}" in ${mins >= 60 ? `${mins / 60}h` : `${mins} min`}.` });
  };

  const rescheduleTask: Ctx["rescheduleTask"] = async (id, iso) => {
    const old = tasksRef.current.find((t) => t.id === id);
    if (!old) return;
    const now = new Date();
    const due = new Date(iso);
    const offsets = suggestOffsets(due, now, settingsRef.current.defaultOffsets, old.priority);
    const plan = planReminders({ dueAt: iso, offsets, now, quiet: quietOf(settingsRef.current) });
    await persist({ ...old, dueAt: iso, reminderOffsetsMin: offsets, reminders: plan.slots, nextFollowUpAt: iso, followUpCount: 0 });
  };

  const saveSettings: Ctx["saveSettings"] = async (s) => {
    setSettings(s);
    try {
      await repo.saveSettings(s);
    } catch {
      toast({ kind: "error", title: "Couldn't save settings", body: "Try again." });
    }
  };

  const replanAll: Ctx["replanAll"] = async () => {
    const s = { ...settingsRef.current, timezone: localTz() };
    await saveSettings(s);
    const now = new Date();
    for (const t of tasksRef.current.filter((x) => x.status === "pending" && x.dueAt)) {
      const plan = planReminders({ dueAt: t.dueAt, offsets: t.reminderOffsetsMin, now, quiet: quietOf(s) });
      await persist({ ...t, reminders: plan.slots });
    }
    setTzChanged(null);
    toast({ kind: "info", title: "Reminders re-planned", body: `Quiet hours now follow ${s.timezone}.` });
  };

  const markAllRead = async () => {
    const ids = notesRef.current.filter((n) => !n.readAt).map((n) => n.id);
    const now = new Date().toISOString();
    setNotifications((x) => x.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    await repo.markRead(ids);
  };

  const pushServerReady = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) && MODE === "supabase";

  const enablePush: Ctx["enablePush"] = async () => {
    if (typeof Notification === "undefined") return "This browser doesn't support notifications. You'll still get in-app reminders while LifePilot is open.";
    const perm = await Notification.requestPermission();
    setPushPermission(perm as Ctx["pushPermission"]);
    if (perm !== "granted") return "Notifications are blocked. You'll still see reminders inside LifePilot while it's open; allow notifications in your browser's site settings to change that.";
    if (!pushServerReady) return MODE === "demo"
      ? "Browser notifications are on, but in demo mode they only appear while LifePilot is open in a tab. Connect Supabase + VAPID keys for reminders when the app is closed."
      : "Browser notifications are on, but server push isn't configured (missing VAPID keys), so reminders only appear while LifePilot is open.";
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) }));
      const { data } = await supabase().auth.getSession();
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("subscribe failed");
      return "Push is set up for this device. Note: a push being accepted by your browser's push service isn't proof you saw it — LifePilot also keeps every reminder in your inbox.";
    } catch {
      return "Couldn't register this device for push. You'll still get in-app reminders while LifePilot is open.";
    }
  };

  /* ---------- auth actions ---------- */
  const signInGoogle = async () => {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    return error ? error.message : null;
  };
  const signInEmail = async (email: string) => {
    const { error } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    return error ? error.message : null;
  };
  const signOut = async () => {
    if (MODE === "supabase") await supabase().auth.signOut();
  };

  const value = useMemo<Ctx>(
    () => ({
      ready, mode: MODE, userEmail, tasks, notifications, settings, toasts, tzChanged,
      addTasks, updateTask, deleteTask, completeTask, snoozeTask, rescheduleTask, saveSettings, replanAll, markAllRead,
      enablePush, pushPermission, pushServerReady, toast, dismissToast, signInGoogle, signInEmail, signOut, authChecked,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, userEmail, tasks, notifications, settings, toasts, tzChanged, pushPermission, authChecked]
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
