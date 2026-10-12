-- LifePilot schema. Run in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  preferred_time text,
  recurrence jsonb,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  estimated_minutes int,
  constraints text[] not null default '{}',
  reminder_offsets int[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','completed')),
  completed_at timestamptz,
  completed_on_time boolean,
  next_follow_up_at timestamptz,
  follow_up_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tasks_user_status on public.tasks (user_id, status, due_at);
create index if not exists tasks_followup on public.tasks (next_follow_up_at) where status = 'pending';

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fire_at timestamptz not null,
  offset_min int not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  delivery text,
  unique (task_id, fire_at)            -- duplicate protection
);
create index if not exists reminders_due on public.reminders (fire_at) where claimed_at is null;

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('reminder','followup')),
  title text not null,
  body text not null,
  dedupe_key text not null unique,     -- duplicate protection
  channel text not null default 'in-app',
  delivery text,                       -- in_app_only | push_accepted | push_failed  (never "delivered": we can't confirm that)
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

-- Row level security: users only ever see their own rows.
alter table public.tasks enable row level security;
alter table public.reminders enable row level security;
alter table public.settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

create policy "own tasks" on public.tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reminders" on public.reminders for all using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid())
);
create policy "own settings" on public.settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push subs" on public.push_subscriptions for select using (user_id = auth.uid());
create policy "own notifications read" on public.notifications for select using (user_id = auth.uid());
create policy "own notifications mark read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Atomically claim due reminders so overlapping cron runs can never send the same one twice.
create or replace function public.claim_due_reminders(batch_size int default 200)
returns setof public.reminders
language sql
security definer
set search_path = public
as $$
  update public.reminders r
     set claimed_at = now()
   where r.id in (
     select id from public.reminders
      where claimed_at is null and sent_at is null and fire_at <= now()
      order by fire_at
      limit batch_size
      for update skip locked
   )
  returning r.*;
$$;
revoke execute on function public.claim_due_reminders(int) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(int) to service_role;
