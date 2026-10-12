"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Capabilities } from "@/lib/env";
import { DEFAULT_PREFS, type DraftTask, type InAppNotification, type NotificationPrefs, type ParseResult, type Task } from "@/lib/types";
import { api, getSupabase } from "@/lib/client/api";
import { browserTimezone } from "@/lib/time";
import { collectDueInApp } from "@/lib/reminders";
import {
  completeLocal,
  deleteLocal,
  draftToInput,
  draftToTask,
  rescheduleLocal,
  snoozeLocal,
  tickLocal,
} from "@/lib/localStore";
import { registerServiceWorker } from "@/lib/client/push";

const KEY = {
  tasks: "lifepilot.v1.tasks",
  prefs: "lifepilot.v1.prefs",
  notifs: "lifepilot.v1.notifs",
  seen: "lifepilot.v1.seen",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

interface NotificationRow {
  id: string;
  task_id: string | null;
  kind: InAppNotification["kind"];
  title: string;
  body: string;
  push_status: InAppNotification["pushStatus"];
  created_at: string;
  read_at: string | null;
}

export interface LifePilotContextValue {
  /** false until capabilities, auth and data have loaded */
  ready: boolean;
  caps: Capabilities | null;
  mode: "demo" | "cloud";
  session: Session | null;
  now: Date;
  prefs: NotificationPrefs;
  tasks: Task[];
  notifications: InAppNotification[];
  unread: number;
  toast: Toast | null;
  focusTaskId: string | null;
  /** Device timezone differs from the saved one (cloud mode); offers a one-tap switch. */
  tzMismatch: string | null;
  clearFocus: () => void;
  dismissToast: () => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
  parse: (text: string) => Promise<ParseResult>;
  createTasks: (drafts: DraftTask[]) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  snoozeTask: (id: string) => Promise<void>;
  rescheduleTask: (id: string, due: Date, allDay?: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  savePrefs: (patch: Partial<NotificationPrefs>) => Promise<void>;
  markRead: (ids?: string[]) => Promise<void>;
  signOut: () => Promise<void>;
  acceptTimezoneSwitch: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LifePilotContextValue | null>(null);

export function useLifePilot(): LifePilotContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLifePilot must be used inside <LifePilotProvider>");
  return v;
}

const TIMING_FIELDS: (keyof Task)[] = ["dueAt", "dueIsAllDay", "reminders", "priority", "recurrence"];

export function LifePilotProvider({ children }: { children: ReactNode }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [prefs, setPrefs] = useState<NotificationPrefs>({ ...DEFAULT_PREFS, timezone: "UTC" });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [tzMismatch, setTzMismatch] = useState<string | null>(null);

  const mode: "demo" | "cloud" = caps?.mode === "cloud" ? "cloud" : "demo";

  // Refs give timers the latest state without re-subscribing.
  const tasksRef = useRef(tasks);
  const prefsRef = useRef(prefs);
  const modeRef = useRef(mode);
  const seenRef = useRef<Set<string>>(new Set());
  const toastId = useRef(0);
  tasksRef.current = tasks;
  prefsRef.current = prefs;
  modeRef.current = mode;

  const notify = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = ++toastId.current;
    setToast({ id, message, tone });
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), tone === "error" ? 6000 : 3500);
  }, []);

  // ---------- capabilities + auth ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let c: Capabilities;
      try {
        c = await api<Capabilities>("/api/capabilities");
      } catch {
        c = { mode: "demo", ai: false, transcription: false, push: false, serverReminders: false };
      }
      if (cancelled) return;
      setCaps(c);
      if (c.mode === "cloud") {
        const sb = getSupabase();
        const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
        if (cancelled) return;
        setSession(data.session);
        setAuthChecked(true);
      } else {
        setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (caps?.mode !== "cloud") return;
    const sb = getSupabase();
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setTasks([]);
        setNotifications([]);
        setLoaded(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [caps?.mode]);

  // Service worker is used for push (cloud) and local alerts (demo); registering is harmless either way.
  useEffect(() => {
    void registerServiceWorker();
    const onMessage = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string } | null)?.url;
      if ((e.data as { type?: string } | null)?.type === "lifepilot:navigate" && url) {
        try {
          const id = new URL(url).searchParams.get("task");
          if (id) setFocusTaskId(id);
        } catch {
          /* ignore malformed url */
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    // Deep link from a tapped notification that opened a fresh window.
    try {
      const id = new URLSearchParams(window.location.search).get("task");
      if (id) setFocusTaskId(id);
    } catch {
      /* ignore */
    }
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  // ---------- data loading ----------
  const loadCloud = useCallback(async () => {
    const [p, t, n] = await Promise.all([
      api<{ prefs: NotificationPrefs; stored: boolean }>("/api/prefs"),
      api<{ tasks: Task[] }>("/api/tasks"),
      api<{ notifications: NotificationRow[] }>("/api/notifications"),
    ]);
    let nextPrefs = p.prefs;
    const deviceTz = browserTimezone();
    if (!p.stored) {
      const saved = await api<{ prefs: NotificationPrefs }>("/api/prefs", { method: "PUT", body: JSON.stringify({ timezone: deviceTz }) });
      nextPrefs = saved.prefs;
    } else if (p.prefs.timezone !== deviceTz) {
      setTzMismatch(deviceTz);
    } else {
      setTzMismatch(null);
    }
    setPrefs(nextPrefs);
    setTasks(t.tasks);
    setNotifications(n.notifications.map(rowToNotification));
  }, []);

  useEffect(() => {
    if (!authChecked || !caps) return;
    if (caps.mode === "demo") {
      const storedPrefs = readJson<Partial<NotificationPrefs> | null>(KEY.prefs, null);
      setPrefs({ ...DEFAULT_PREFS, timezone: browserTimezone(), ...(storedPrefs ?? {}) });
      setTasks(readJson<Task[]>(KEY.tasks, []));
      setNotifications(readJson<InAppNotification[]>(KEY.notifs, []));
      seenRef.current = new Set(readJson<string[]>(KEY.seen, []));
      setLoaded(true);
      return;
    }
    if (!session) return;
    let cancelled = false;
    loadCloud()
      .then(() => !cancelled && setLoaded(true))
      .catch((e: Error) => {
        if (!cancelled) {
          notify(e.message, "error");
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authChecked, caps, session, loadCloud, notify]);

  // Persist demo data.
  useEffect(() => {
    if (mode === "demo" && loaded) writeJson(KEY.tasks, tasks);
  }, [tasks, mode, loaded]);
  useEffect(() => {
    if (mode === "demo" && loaded) writeJson(KEY.notifs, notifications.slice(0, 100));
  }, [notifications, mode, loaded]);
  useEffect(() => {
    if (mode === "demo" && loaded) writeJson(KEY.prefs, prefs);
  }, [prefs, mode, loaded]);

  const persistSeen = () => writeJson(KEY.seen, [...seenRef.current].slice(-500));

  /** Mark reminders that are already in the past as handled, so editing a task never fires a stale alert. */
  const silencePast = useCallback((list: Task[]) => {
    const r = collectDueInApp(list, prefsRef.current, new Date(), seenRef.current);
    // Keep "deadline reached" live: only offsets before the deadline are silenced.
    for (const k of r.newlySeen) if (!k.includes(":overdue:")) seenRef.current.add(k);
    persistSeen();
  }, []);

  // ---------- clock / reminders ----------
  const refresh = useCallback(async () => {
    if (modeRef.current !== "cloud") return;
    try {
      const [t, n] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks"),
        api<{ notifications: NotificationRow[] }>("/api/notifications"),
      ]);
      setTasks(t.tasks);
      setNotifications(n.notifications.map(rowToNotification));
    } catch {
      /* transient network error: keep showing what we have */
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let beat = 0;
    const tick = () => {
      const t = new Date();
      setNow(t);
      if (modeRef.current === "demo") {
        const r = tickLocal(tasksRef.current, prefsRef.current, t, seenRef.current);
        if (r.newlySeen.length) {
          r.newlySeen.forEach((k) => seenRef.current.add(k));
          persistSeen();
        }
        if (r.notifications.length) {
          setTasks(r.tasks);
          setNotifications((prev) => [...r.notifications, ...prev].slice(0, 100));
          for (const n of r.notifications) surfaceLocalAlert(n);
          notify(r.notifications[0].title);
        }
      } else if (++beat % 2 === 0 && document.visibilityState === "visible") {
        void refresh();
      }
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loaded, notify, refresh]);

  // ---------- actions ----------
  const parse = useCallback(async (text: string): Promise<ParseResult> => {
    return api<ParseResult>("/api/parse", {
      method: "POST",
      body: JSON.stringify({
        text,
        timezone: prefsRef.current.timezone,
        defaultOffsetsMinutes: prefsRef.current.defaultOffsetsMinutes,
      }),
    });
  }, []);

  const createTasks = useCallback(
    async (drafts: DraftTask[]) => {
      if (modeRef.current === "demo") {
        const created = drafts.map((d) => draftToTask(d, new Date()));
        silencePast(created);
        setTasks((prev) => [...prev, ...created]);
        return;
      }
      const res = await api<{ tasks: Task[] }>("/api/tasks", { method: "POST", body: JSON.stringify({ tasks: drafts.map(draftToInput) }) });
      setTasks((prev) => [...prev, ...res.tasks]);
    },
    [silencePast]
  );

  const updateTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      if (modeRef.current === "demo") {
        const timing = TIMING_FIELDS.some((k) => k in patch);
        const next = tasksRef.current.map((t) =>
          t.id === id
            ? { ...t, ...patch, ...(timing ? { snoozeCount: 0, nextFollowUpAt: null } : {}), updatedAt: new Date().toISOString() }
            : t
        );
        if (timing) silencePast(next.filter((t) => t.id === id));
        setTasks(next);
        return;
      }
      const body: Record<string, unknown> = {};
      for (const k of ["title", "description", "dueAt", "dueIsAllDay", "preferredTime", "preferredStartAt", "recurrence", "priority", "estimatedMinutes", "constraints", "reminders"] as const) {
        if (k in patch) body[k] = patch[k];
      }
      const res = await api<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setTasks((prev) => prev.map((t) => (t.id === id ? res.task : t)));
    },
    [silencePast]
  );

  const applyServerResult = (res: { task: Task; next?: Task }) =>
    setTasks((prev) => {
      const replaced = prev.map((t) => (t.id === res.task.id ? res.task : t));
      return res.next ? [...replaced, res.next] : replaced;
    });

  const completeTask = useCallback(async (id: string) => {
    if (modeRef.current === "demo") {
      setTasks((prev) => completeLocal(prev, id, new Date(), prefsRef.current.timezone));
      return;
    }
    applyServerResult(await api<{ task: Task; next?: Task }>(`/api/tasks/${id}/action`, { method: "POST", body: JSON.stringify({ action: "complete" }) }));
  }, []);

  const snoozeTask = useCallback(async (id: string) => {
    if (modeRef.current === "demo") {
      setTasks((prev) => snoozeLocal(prev, id, new Date(), prefsRef.current));
      return;
    }
    applyServerResult(await api<{ task: Task }>(`/api/tasks/${id}/action`, { method: "POST", body: JSON.stringify({ action: "snooze" }) }));
  }, []);

  const rescheduleTask = useCallback(
    async (id: string, due: Date, allDay = false) => {
      if (modeRef.current === "demo") {
        const next = rescheduleLocal(tasksRef.current, id, due, allDay, new Date());
        silencePast(next.filter((t) => t.id === id));
        setTasks(next);
        return;
      }
      applyServerResult(
        await api<{ task: Task }>(`/api/tasks/${id}/action`, {
          method: "POST",
          body: JSON.stringify({ action: "reschedule", dueAt: due.toISOString(), dueIsAllDay: allDay }),
        })
      );
    },
    [silencePast]
  );

  const deleteTask = useCallback(async (id: string) => {
    if (modeRef.current === "demo") {
      setTasks((prev) => deleteLocal(prev, id));
      return;
    }
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const savePrefs = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      if (modeRef.current === "demo") {
        setPrefs((p) => ({ ...p, ...patch }));
        return;
      }
      const res = await api<{ prefs: NotificationPrefs }>("/api/prefs", { method: "PUT", body: JSON.stringify(patch) });
      setPrefs(res.prefs);
      if (patch.timezone) setTzMismatch(patch.timezone === browserTimezone() ? null : browserTimezone());
      // The server re-plans reminders (and re-anchors all-day deadlines) when timezone or quiet hours change.
      if (patch.timezone || patch.quietHoursEnabled !== undefined || patch.quietStart || patch.quietEnd) await refresh();
    },
    [refresh]
  );

  const acceptTimezoneSwitch = useCallback(async () => {
    if (tzMismatch) await savePrefs({ timezone: tzMismatch });
  }, [tzMismatch, savePrefs]);

  const markRead = useCallback(async (ids?: string[]) => {
    setNotifications((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    if (modeRef.current === "cloud") {
      await api("/api/notifications", { method: "POST", body: JSON.stringify(ids ? { ids } : { all: true }) }).catch(() => undefined);
    }
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase()?.auth.signOut();
  }, []);

  const value = useMemo<LifePilotContextValue>(
    () => ({
      ready: Boolean(caps) && authChecked && (mode === "demo" ? loaded : !session || loaded),
      caps,
      mode,
      session,
      now,
      prefs,
      tasks,
      notifications,
      unread: notifications.filter((n) => !n.read).length,
      toast,
      focusTaskId,
      tzMismatch,
      clearFocus: () => setFocusTaskId(null),
      dismissToast: () => setToast(null),
      notify,
      parse,
      createTasks,
      updateTask,
      completeTask,
      snoozeTask,
      rescheduleTask,
      deleteTask,
      savePrefs,
      markRead,
      signOut,
      acceptTimezoneSwitch,
      refresh,
    }),
    [caps, authChecked, mode, loaded, session, now, prefs, tasks, notifications, toast, focusTaskId, tzMismatch, notify, parse, createTasks, updateTask, completeTask, snoozeTask, rescheduleTask, deleteTask, savePrefs, markRead, signOut, acceptTimezoneSwitch, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function rowToNotification(r: NotificationRow): InAppNotification {
  return {
    id: r.id,
    taskId: r.task_id ?? "",
    kind: r.kind,
    title: r.title,
    body: r.body,
    at: r.created_at,
    read: r.read_at !== null,
    pushStatus: r.push_status,
  };
}

/** Demo mode only: a system notification while the app is open and the user has allowed them. */
function surfaceLocalAlert(n: InAppNotification) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(n.title, { body: n.body, tag: `${n.taskId}:${n.kind}`, icon: "/icon.svg" });
    }
  } catch {
    /* some mobile browsers only allow notifications via a service worker; the in-app toast still shows */
  }
}
