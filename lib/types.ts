export type Priority = "low" | "medium" | "high";

export interface Recurrence {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  /** 0 = Sunday … 6 = Saturday */
  byWeekday?: number[];
  /** 1–31, or -1 for the last day of the month */
  byMonthDay?: number;
}

export type SlotStatus = "pending" | "shown" | "missed";

export interface ReminderSlot {
  id: string;
  fireAt: string; // ISO instant
  offsetMin: number;
  status: SlotStatus;
}

export interface TaskFields {
  title: string;
  description: string;
  dueAt: string | null;
  preferredTime: string | null;
  recurrence: Recurrence | null;
  priority: Priority;
  estimatedMinutes: number | null;
  constraints: string[];
  /** minutes before the deadline */
  reminderOffsetsMin: number[];
}

export interface Task extends TaskFields {
  id: string;
  status: "pending" | "completed";
  createdAt: string;
  completedAt: string | null;
  completedOnTime: boolean | null;
  /** When to next ask "Did you complete…?" */
  nextFollowUpAt: string | null;
  followUpCount: number;
  reminders: ReminderSlot[];
}

export interface ExtractedTask extends TaskFields {
  tempId: string;
  clarification: string | null;
  assumptions: string[];
  source: "ai" | "demo";
}

export interface Settings {
  timezone: string;
  quietEnabled: boolean;
  quietStart: string; // HH:mm
  quietEnd: string; // HH:mm
  defaultOffsets: number[];
  followUpIntervalMin: number;
  autoSave: boolean;
}

export interface AppNotification {
  id: string;
  taskId: string | null;
  kind: "reminder" | "followup";
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  dedupeKey: string;
  /** "in-app" = shown inside LifePilot; "browser" = also handed to the browser's notification API (not proof anyone saw it) */
  channel: "in-app" | "browser" | "push";
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: "UTC",
  quietEnabled: true,
  quietStart: "22:00",
  quietEnd: "07:00",
  defaultOffsets: [1440, 180, 60, 15],
  followUpIntervalMin: 60,
  autoSave: false,
};
