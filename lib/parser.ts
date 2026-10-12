/**
 * Offline natural-language task extractor ("demo engine").
 * Rule-based on top of chrono-node. It runs in the browser so relative dates resolve in the user's own time zone.
 * When ANTHROPIC_API_KEY is configured the app uses the LLM route instead and falls back to this if that fails.
 */
import * as chrono from "chrono-node";
import type { ExtractedTask, Priority, Recurrence } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { suggestOffsets } from "./reminders";
import { firstOccurrence } from "./recurrence";
import { formatTime, uid } from "./time";

const LEAD =
  /^(?:(?:hey|ok|okay|so|also|and|then|um|uh)[, ]+)*(?:i\s+(?:need|have|want|got|must|should)\s+to|i\s+gotta|gotta|remind\s+me\s+(?:to|about|that)|don'?t\s+(?:let\s+me\s+)?forget\s+to|make\s+sure\s+(?:i|to)|please|need\s+to|have\s+to|remember\s+to)\s+/i;

const ACTION_CUES =
  "(?:i\\s+(?:need|have|must|should|want)\\s+to|remind|to\\s|buy|pay|submit|call|send|book|renew|pick|finish|email|schedule|clean|return|order|file|write|visit|meet|collect|get|take|prepare|complete|check|drop|fix|water|cancel|review|update|upload|print|register|apply)\\b";
const SPLIT_CONJ = new RegExp(`,?\\s+(?:and|also|plus|then)\\s+(?=${ACTION_CUES})`, "i");
const CONTINUATION = /^(?:i\s+can(?:'t|not)?(?:\s+only)?|i\s+could|only\b|but\b|it\b|it's\b|that\b|that's\b|this\b|its\b|the deadline|deadline)/i;

const WORD_NUM: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, tenth: 10, fifteenth: 15, twentieth: 20, last: -1 };
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

interface Segment {
  main: string;
  extras: string[];
}

export function splitTasks(text: string): Segment[] {
  const sentences = text
    .replace(/\r/g, "")
    .split(/[\n;]+/)
    .flatMap((s) => s.replace(/([.!?])\s+/g, "$1\u0000").split("\u0000"))
    .map((s) => s.trim())
    .filter((s) => s.replace(/[.!?]/g, "").trim().length > 0);

  const segs: Segment[] = [];
  for (const s of sentences) {
    const parts = s.split(SPLIT_CONJ).map((p) => p.trim()).filter(Boolean);
    parts.forEach((p, i) => {
      if (i === 0 && segs.length && CONTINUATION.test(p)) segs[segs.length - 1].extras.push(p);
      else segs.push({ main: p, extras: [] });
    });
  }
  return segs;
}

interface RecMatch {
  rule: Recurrence;
  matched: string;
  needsDay?: boolean;
}

export function detectRecurrence(text: string): RecMatch | null {
  let m = text.match(/\b(?:on\s+)?the\s+(first|second|third|fourth|fifth|tenth|fifteenth|twentieth|last|\d{1,2}(?:st|nd|rd|th)?)(?:\s+(?:day\s+)?of)?\s+(?:every|each)\s+month\b/i);
  if (m) {
    const raw = m[1].toLowerCase();
    const n = WORD_NUM[raw] ?? parseInt(raw, 10);
    return { rule: { freq: "monthly", interval: 1, byMonthDay: n }, matched: m[0] };
  }
  m = text.match(/\b(?:every|each)\s+(sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?s?\b/i);
  if (m) {
    const key = m[1].toLowerCase().slice(0, 3);
    return { rule: { freq: "weekly", interval: 1, byWeekday: [WEEKDAYS[key]] }, matched: m[0] };
  }
  m = text.match(/\b(?:every\s*day|each\s+day|daily)\b/i);
  if (m) return { rule: { freq: "daily", interval: 1 }, matched: m[0] };
  m = text.match(/\b(?:every|each)\s+(\d+)\s+(days|weeks|months)\b/i);
  if (m) {
    const interval = parseInt(m[1], 10);
    const freq = m[2].toLowerCase() === "days" ? "daily" : m[2].toLowerCase() === "weeks" ? "weekly" : "monthly";
    return { rule: { freq, interval }, matched: m[0], needsDay: freq !== "daily" };
  }
  m = text.match(/\b(?:every|each)\s+month\b|\bmonthly\b/i);
  if (m) return { rule: { freq: "monthly", interval: 1 }, matched: m[0], needsDay: true };
  m = text.match(/\b(?:every|each)\s+week\b|\bweekly\b/i);
  if (m) return { rule: { freq: "weekly", interval: 1 }, matched: m[0], needsDay: true };
  m = text.match(/\b(?:every|each)\s+year\b|\byearly\b|\bannually\b/i);
  if (m) return { rule: { freq: "yearly", interval: 1 }, matched: m[0], needsDay: true };
  return null;
}

function dayWord(d: Date, now: Date) {
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function impliedHour(text: string): number | null {
  if (/\bmorning\b/i.test(text)) return 9;
  if (/\bnoon|lunch/i.test(text)) return 12;
  if (/\bafternoon\b/i.test(text)) return 15;
  if (/\bevening\b/i.test(text)) return 18;
  if (/\bnight\b|\btonight\b/i.test(text)) return 21;
  return null;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseSegment(seg: Segment, now: Date): ExtractedTask {
  const assumptions: string[] = [];
  const constraints: string[] = [];
  const full = [seg.main, ...seg.extras].join(" ");

  // 1. recurrence (removed from the text before date parsing so "every month" doesn't confuse chrono)
  const rec = detectRecurrence(full);
  const parts = [seg.main, ...seg.extras].map((p) => (rec ? p.replace(rec.matched, " ") : p));

  // 2. dates: "after 7 PM" is a preferred start time, anything else is the deadline
  type Hit = { part: number; res: chrono.ParsedResult; kind: "due" | "pref"; before: string };
  const hits: Hit[] = [];
  parts.forEach((p, i) => {
    for (const res of chrono.parse(p, now, { forwardDate: true })) {
      const before = p.slice(Math.max(0, res.index - 16), res.index).toLowerCase();
      const kind = /\b(?:after|from|starting)\s*$/.test(before) ? "pref" : "due";
      hits.push({ part: i, res, kind, before });
    }
  });
  const dueHit = hits.find((h) => h.kind === "due");
  const prefHit = hits.find((h) => h.kind === "pref");

  let due: Date | null = null;
  if (dueHit) {
    const s = dueHit.res.start;
    due = s.date();
    if (!s.isCertain("hour")) {
      const hr = impliedHour(parts[dueHit.part]) ?? 18;
      due = new Date(due.getFullYear(), due.getMonth(), due.getDate(), hr, 0, 0);
      const why = impliedHour(parts[dueHit.part]) !== null ? "that part of the day" : "no time given";
      assumptions.push(`No exact time given — I used ${formatTime(due)} (${why}). Change it if that's wrong.`);
    }
    if (/\bbefore\s*$/.test(dueHit.before) && !s.isCertain("hour")) {
      const prev = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 18, 0, 0);
      if (prev > now) {
        due = prev;
        assumptions.push(`"Before ${dayWord(s.date(), now)}" → I set the deadline for the day before at ${formatTime(prev)}.`);
      }
    }
  }

  if (rec && !rec.needsDay) {
    const chronoHour = dueHit && dueHit.res.start.isCertain("hour") ? dueHit.res.start.get("hour")! : null;
    const h = chronoHour ?? 9;
    const min = chronoHour != null ? dueHit!.res.start.get("minute") ?? 0 : 0;
    if (chronoHour == null) assumptions.push("No time given for the repeat — I used 9:00 AM.");
    due = firstOccurrence(rec.rule, now, h, min, due ?? undefined) ?? due;
  } else if (rec?.needsDay && due) {
    // e.g. "every week" + "on Friday": take the weekday / day-of-month from the date that was spoken
    if (rec.rule.freq === "weekly") rec.rule.byWeekday = [due.getDay()];
    if (rec.rule.freq === "monthly") rec.rule.byMonthDay = due.getDate();
  }

  // 3. preferred execution time + constraints
  let preferredTime: string | null = null;
  if (prefHit) {
    const d = prefHit.res.start.date();
    preferredTime = `After ${formatTime(d)} ${dayWord(d, now)}`;
  }
  const cons: [RegExp, string][] = [
    [/\bafter\s+(?:the\s+)?(?:office|work)(?:\s+hours)?\b/i, "After office hours"],
    [/\bonly\s+(?:on\s+)?(?:the\s+)?weekends?\b/i, "Weekends only"],
    [/\bonly\s+(?:on\s+)?weekdays?\b/i, "Weekdays only"],
    [/\bbefore\s+leaving\s+(?:home|the house)\b/i, "Before leaving home"],
    [/\bon\s+my\s+way\s+(?:home|to work)\b/i, "On the way"],
    [/\bwhile\s+(?:i'?m\s+)?(?:at|in)\s+the\s+office\b/i, "While at the office"],
  ];
  for (const [re, label] of cons) if (re.test(full)) constraints.push(label);

  // 4. priority & duration
  let priority: Priority = "medium";
  if (/\b(urgent|asap|important|critical|immediately|right away)\b/i.test(full)) priority = "high";
  else if (/\b(no rush|whenever|someday|low priority|not urgent)\b/i.test(full)) priority = "low";
  else if (due && due.getTime() - now.getTime() < 24 * 3600000) priority = "high";

  let estimatedMinutes: number | null = null;
  const dm = full.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (dm) estimatedMinutes = Math.round(parseFloat(dm[1]) * (/^h/i.test(dm[2]) ? 60 : 1));
  else if (/\bhalf an hour\b/i.test(full)) estimatedMinutes = 30;
  else if (/\ban hour\b/i.test(full) && !/\bin an hour\b/i.test(full)) estimatedMinutes = 60;

  // 5. title: strip lead-ins, the date phrase, recurrence and constraint wording from the main clause
  let title = parts[0];
  const mainHits = hits.filter((h) => h.part === 0).sort((a, b) => b.res.index - a.res.index);
  for (const h of mainHits) {
    let start = h.res.index;
    const pre = title.slice(0, start).match(/\b(?:by|before|on|at|until|till|for|due|this|after|from|in)\s+$/i);
    if (pre) start -= pre[0].length;
    title = title.slice(0, start) + " " + title.slice(h.res.index + h.res.text.length);
  }
  for (const [re] of cons) title = title.replace(re, " ");
  title = title.replace(/\bevery\b|\beach\b/gi, " ");
  title = title.replace(LEAD, "").replace(LEAD, "");
  title = title.replace(/\s+/g, " ").replace(/(?:\s+(?:and|but|then|by|on|at|for|in))*[\s,.;:!-]*$/i, "").replace(/^[\s,.;:!-]+/, "").trim();
  if (!title) title = cap(seg.main.replace(LEAD, "").replace(/[.!?]+$/, "").trim()) || "New task";
  title = cap(title);

  const description = [seg.main, ...seg.extras].join(" ").trim();

  // 6. clarification — never invent a deadline
  let clarification: string | null = null;
  if (!due && !rec) clarification = `When should "${title}" be done by? I haven't set a deadline — leave it blank if there isn't one.`;
  else if (!due && rec?.needsDay) {
    clarification =
      rec.rule.freq === "monthly" ? `Which day of the month should "${title}" repeat on?` : rec.rule.freq === "weekly" ? `Which day of the week should "${title}" repeat on?` : `Which date should "${title}" repeat on?`;
  }

  const dueAt = due ? due.toISOString() : null;
  return {
    tempId: uid(),
    title,
    description: description === title ? "" : description,
    dueAt,
    preferredTime,
    recurrence: rec ? rec.rule : null,
    priority,
    estimatedMinutes,
    constraints,
    reminderOffsetsMin: due ? suggestOffsets(due, now, DEFAULT_SETTINGS.defaultOffsets, priority) : [],
    clarification,
    assumptions,
    source: "demo",
  };
}

export function parseLocal(text: string, now: Date = new Date()): ExtractedTask[] {
  return splitTasks(text).map((s) => parseSegment(s, now));
}
