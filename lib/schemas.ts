import { z } from "zod";

/** Request validation shared by API routes. Every client-supplied field is bounded. */

const isoOrNull = z.string().datetime({ offset: true }).nullable();

export const RecurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional(),
});

export const ReminderOffsetSchema = z.object({
  id: z.string().min(1).max(80),
  minutesBefore: z.number().int().min(1).max(60 * 24 * 60),
  enabled: z.boolean(),
});

export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const TaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  dueAt: isoOrNull.default(null),
  dueIsAllDay: z.boolean().default(false),
  preferredTime: z.string().max(200).nullable().default(null),
  preferredStartAt: isoOrNull.default(null),
  recurrence: RecurrenceSchema.nullable().default(null),
  priority: PrioritySchema.default("medium"),
  estimatedMinutes: z.number().int().min(1).max(10080).nullable().default(null),
  constraints: z.array(z.string().max(200)).max(20).default([]),
  reminders: z.array(ReminderOffsetSchema).max(12).default([]),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const CreateTasksSchema = z.object({
  tasks: z.array(TaskInputSchema).min(1).max(25),
});

export const TaskPatchSchema = TaskInputSchema.partial();

export const TaskActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("snooze") }),
  z.object({ action: z.literal("reschedule"), dueAt: z.string().datetime({ offset: true }), dueIsAllDay: z.boolean().optional() }),
]);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const PrefsSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    quietHoursEnabled: z.boolean(),
    quietStart: hhmm,
    quietEnd: hhmm,
    defaultOffsetsMinutes: z.array(z.number().int().min(1).max(60 * 24 * 60)).max(8),
    followUpIntervalMinutes: z.number().int().min(5).max(24 * 60),
    maxFollowUps: z.number().int().min(0).max(50),
    saveImmediately: z.boolean(),
    pushEnabled: z.boolean(),
  })
  .partial();

export const ParseRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  timezone: z.string().min(1).max(64),
  defaultOffsetsMinutes: z.array(z.number().int().min(1).max(60 * 24 * 60)).max(8).optional(),
});

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

export const MarkReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  all: z.boolean().optional(),
});
