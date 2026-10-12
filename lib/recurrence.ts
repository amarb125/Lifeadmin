import type { Recurrence } from "./types";

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

function monthDate(y: number, m: number, byMonthDay: number, h: number, min: number) {
  const dim = daysInMonth(y, m);
  const day = byMonthDay === -1 ? dim : Math.min(byMonthDay, dim);
  return new Date(y, m, day, h, min, 0, 0);
}

/** First occurrence strictly after `after`, at wall-clock h:min in the browser's zone (DST-safe: built from local parts). */
export function firstOccurrence(rule: Recurrence, after: Date, h: number, min: number, anchor?: Date): Date | null {
  const y = after.getFullYear();
  const mo = after.getMonth();
  const d = after.getDate();
  switch (rule.freq) {
    case "daily": {
      for (let i = 0; i < 3; i++) {
        const c = new Date(y, mo, d + i, h, min);
        if (c > after) return c;
      }
      return null;
    }
    case "weekly": {
      const days = rule.byWeekday?.length ? rule.byWeekday : anchor ? [anchor.getDay()] : null;
      if (!days) return null;
      for (let i = 0; i < 8; i++) {
        const c = new Date(y, mo, d + i, h, min);
        if (days.includes(c.getDay()) && c > after) return c;
      }
      return null;
    }
    case "monthly": {
      const bmd = rule.byMonthDay ?? anchor?.getDate();
      if (bmd == null) return null;
      for (let i = 0; i < 3; i++) {
        const c = monthDate(y, mo + i, bmd, h, min);
        if (c > after) return c;
      }
      return null;
    }
    case "yearly": {
      if (!anchor) return null;
      for (let i = 0; i < 3; i++) {
        const c = new Date(y + i, anchor.getMonth(), anchor.getDate(), h, min);
        if (c > after) return c;
      }
      return null;
    }
  }
}

/** The occurrence after `due` — used when a recurring task is completed. */
export function nextDue(due: Date, rule: Recurrence): Date {
  const n = Math.max(1, rule.interval || 1);
  const h = due.getHours();
  const min = due.getMinutes();
  switch (rule.freq) {
    case "daily":
      return new Date(due.getFullYear(), due.getMonth(), due.getDate() + n, h, min);
    case "weekly": {
      const days = (rule.byWeekday?.length ? rule.byWeekday : [due.getDay()]).slice().sort();
      if (n === 1) {
        for (let i = 1; i <= 7; i++) {
          const c = new Date(due.getFullYear(), due.getMonth(), due.getDate() + i, h, min);
          if (days.includes(c.getDay())) return c;
        }
      }
      return new Date(due.getFullYear(), due.getMonth(), due.getDate() + 7 * n, h, min);
    }
    case "monthly": {
      const bmd = rule.byMonthDay ?? due.getDate();
      return monthDate(due.getFullYear(), due.getMonth() + n, bmd, h, min);
    }
    case "yearly":
      return new Date(due.getFullYear() + n, due.getMonth(), due.getDate(), h, min);
  }
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ord = (n: number) => (n === -1 ? "last day" : `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`);

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return "";
  const every = r.interval > 1 ? `Every ${r.interval} ` : "Every ";
  switch (r.freq) {
    case "daily":
      return r.interval > 1 ? `${every}days` : "Daily";
    case "weekly":
      return r.byWeekday?.length ? `${every.trim()} ${r.byWeekday.map((d) => WD[d]).join(", ")}`.replace("Every  ", "Every ") : r.interval > 1 ? `${every}weeks` : "Weekly";
    case "monthly":
      return r.byMonthDay ? `Monthly on the ${ord(r.byMonthDay)}` : "Monthly";
    case "yearly":
      return "Yearly";
  }
}
