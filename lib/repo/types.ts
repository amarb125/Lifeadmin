import type { AppNotification, Settings, Task } from "../types";

export interface Snapshot {
  tasks: Task[];
  settings: Settings | null;
  notifications: AppNotification[];
}

export interface Repo {
  load(): Promise<Snapshot>;
  upsertTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  addNotifications(items: AppNotification[]): Promise<void>;
  markRead(ids: string[]): Promise<void>;
}
