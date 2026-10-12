export const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function minutesOfDay(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Is `d` inside the quiet window (which may wrap past midnight) in timezone `tz`? */
export function inQuiet(d: Date, tz: string, start: string, end: string): boolean {
  const m = minutesOfDay(d, tz);
  const a = hhmmToMin(start);
  const b = hhmmToMin(end);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → value for <input type="datetime-local"> in the browser's zone */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO instant (interpreted in the browser's zone) */
export function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Local wall-clock string without offset, e.g. 2026-10-12T06:36 — what we hand to the LLM */
export const toLocalString = (d: Date) => toLocalInput(d.toISOString());

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dayDiff(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

export function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatWhen(iso: string | null, now = new Date()): string {
  if (!iso) return "No deadline";
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  if (sameDay(d, now)) return `Today · ${formatTime(d)}`;
  if (diff === 1) return `Tomorrow · ${formatTime(d)}`;
  if (diff === -1) return `Yesterday · ${formatTime(d)}`;
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${formatTime(d)}`;
}

export function relative(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const mins = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
  const abs = Math.abs(mins);
  const txt =
    abs < 60 ? `${abs}m` : abs < 1440 ? `${Math.floor(abs / 60)}h${abs % 60 ? ` ${abs % 60}m` : ""}` : `${Math.floor(abs / 1440)}d`;
  return mins >= 0 ? `in ${txt}` : `${txt} overdue`;
}

export function offsetLabel(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? "" : "s"} before`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"} before`;
  return `${min} min before`;
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
