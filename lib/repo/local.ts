import type { AppNotification, Settings, Task } from "../types";
import type { Repo, Snapshot } from "./types";

const KEY = "lifepilot:v1";
let memory: Snapshot = { tasks: [], settings: null, notifications: [] };

function read(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = { tasks: [], settings: null, notifications: [], ...JSON.parse(raw) };
  } catch {
    /* storage blocked — fall back to in-memory */
  }
  return memory;
}

function write(s: Snapshot) {
  memory = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore: private mode / quota */
  }
}

/** Demo-mode storage: everything stays in this browser. */
export const localRepo: Repo = {
  async load() {
    return read();
  },
  async upsertTask(task: Task) {
    const s = read();
    const i = s.tasks.findIndex((t) => t.id === task.id);
    write({ ...s, tasks: i >= 0 ? s.tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...s.tasks] });
  },
  async deleteTask(id: string) {
    const s = read();
    write({ ...s, tasks: s.tasks.filter((t) => t.id !== id) });
  },
  async saveSettings(settings: Settings) {
    write({ ...read(), settings });
  },
  async addNotifications(items: AppNotification[]) {
    const s = read();
    write({ ...s, notifications: [...items, ...s.notifications].slice(0, 200) });
  },
  async markRead(ids: string[]) {
    const s = read();
    const now = new Date().toISOString();
    write({ ...s, notifications: s.notifications.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)) });
  },
};
