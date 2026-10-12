# LifePilot

An AI life-admin assistant: say (or type) what needs doing, review what it understood, and LifePilot schedules reminders, checks in after deadlines, and reschedules what slips.

Next.js 14 · TypeScript · Tailwind · Supabase (Postgres + Auth) · Web Push · optional LLM + speech fallback.

## Run it (demo mode, no keys needed)

```bash
npm install
npm test          # parser, reminder planning, quiet hours, DST, dedupe, follow-up logic
npm run dev       # http://localhost:3000
```

With no environment variables LifePilot runs in **demo mode**: tasks are stored in your browser, text is parsed by a built-in rule-based parser, and reminders appear in-app (and as browser notifications) **only while the app is open**. The UI says so.

## Turn on the real thing

Copy `.env.example` to `.env.local` and fill in what you want. Each piece is independent.

| Capability | Variables | Notes |
|---|---|---|
| Smarter extraction | `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL` optional) | Server-only. Falls back to the built-in parser on any failure. |
| Accounts + storage | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Run `supabase/schema.sql` in the SQL editor. Enable Google under Auth → Providers; email uses magic links. Add your site URL to Auth redirect URLs. |
| Background reminders | `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Server-only. Something must call `GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` every minute. |
| Push to closed app | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys`. iPhone needs the site added to the Home Screen (iOS 16.4+). |
| Voice fallback | `OPENAI_API_KEY` | For browsers without the Web Speech API (e.g. Firefox). Chrome/Edge/Safari transcribe in the browser with no key. |

### Scheduling the cron job
`vercel.json` declares a per-minute cron. **Vercel Hobby only allows daily crons**, so on Hobby use one of: Supabase `pg_cron` + `pg_net` calling the route, a GitHub Actions schedule (5-minute minimum), or an external pinger. Reminder times are stored as exact instants, so a delayed run sends late, never twice.

## How the important parts work

- **Extraction** (`lib/parser.ts`, `app/api/extract`): splits one utterance into several tasks, resolves relative dates in the *browser's* time zone, pulls out preferred time ("after 7 PM today"), constraints, duration, priority and recurrence. Anything it had to assume ("evening" → 6 PM) is listed on the review screen. **If there's no date it asks instead of inventing one.** Nothing is saved before you confirm, unless you turn on "Save without reviewing", which still stops to ask when something is unclear.
- **Reminder planning** (`lib/reminders.ts`): defaults of 24h / 3h / 1h / 15m before the deadline, editable per task. Offsets already in the past are dropped rather than fired late; low priority gets fewer nudges, high gets a 5-minute last call; reminders are moved out of quiet hours; two never land in the same minute.
- **Server delivery** (`app/api/cron/reminders`, `supabase/schema.sql`): reminders are rows in Postgres, claimed atomically (`FOR UPDATE SKIP LOCKED`) so overlapping runs can't double-send; notifications have a unique `dedupe_key`; completing or deleting a task removes its reminders (delete cascades; completion clears unclaimed rows and the cron skips any stragglers).
- **Honest delivery status**: we record `in_app_only`, `push_accepted` (the push service took it) or `push_failed`. We never record "delivered", because a browser push service can't tell us that. The inbox shows which channel was used.
- **Follow-up**: after a deadline, a "Did you complete: …?" card offers *Yes, completed* / *Not yet — remind me later* (re-asks at your interval, default 1 h) / *Reschedule* (new deadline, reminders re-planned). Completing a recurring task schedules the next occurrence.
- **Time zones / DST**: reminder times are stored as UTC instants; recurrence is computed from local wall-clock parts so "9:00 every day" stays 9:00 across DST. If the device's zone differs from the saved one, the app offers to re-plan reminders.

## Layout

```
app/                 Next.js routes (page, manifest, api/extract|transcribe|cron/reminders|push/subscribe)
components/          Capture (mic), ConfirmSheet, TaskEditor, TaskCard, FollowUps, Settings/Inbox sheets, Login
lib/                 parser, reminders, recurrence, engine (demo-mode scheduler), repo/{local,supabase}, app-context
supabase/schema.sql  tables, RLS policies, claim_due_reminders()
public/sw.js         service worker for push
tests/               vitest suite (run with TZ=Asia/Kolkata via `npm test`)
```

## Known limits
- Demo-mode reminders need the tab open; real background delivery needs the Supabase + cron + VAPID setup above.
- The built-in parser is rule-based English only; use the LLM route for messier speech.
- Native mobile push is a later step: `push_subscriptions` and the cron job are the seam where APNs/FCM tokens would plug in.
