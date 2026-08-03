create extension if not exists pgcrypto;

create table if not exists public.wildfire_sessions (
  id text primary key,
  state jsonb not null,
  status text not null default 'ready',
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wildfire_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.wildfire_sessions(id) on delete cascade,
  role text not null,
  author text not null,
  text text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wildfire_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.wildfire_sessions(id) on delete cascade,
  tick integer not null default 0,
  event_type text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wildfire_survey_checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.wildfire_sessions(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists wildfire_messages_session_created_idx
  on public.wildfire_messages (session_id, created_at desc);

create index if not exists wildfire_events_session_created_idx
  on public.wildfire_events (session_id, created_at desc);

create index if not exists wildfire_surveys_session_created_idx
  on public.wildfire_survey_checkpoints (session_id, created_at desc);

alter table public.wildfire_sessions replica identity full;

alter table public.wildfire_sessions enable row level security;
alter table public.wildfire_messages enable row level security;
alter table public.wildfire_events enable row level security;
alter table public.wildfire_survey_checkpoints enable row level security;

drop policy if exists "pilot read sessions" on public.wildfire_sessions;
drop policy if exists "pilot write sessions" on public.wildfire_sessions;
drop policy if exists "pilot update sessions" on public.wildfire_sessions;
drop policy if exists "pilot read messages" on public.wildfire_messages;
drop policy if exists "pilot write messages" on public.wildfire_messages;
drop policy if exists "pilot read events" on public.wildfire_events;
drop policy if exists "pilot write events" on public.wildfire_events;
drop policy if exists "pilot read surveys" on public.wildfire_survey_checkpoints;
drop policy if exists "pilot write surveys" on public.wildfire_survey_checkpoints;
drop policy if exists "pilot update surveys" on public.wildfire_survey_checkpoints;

create policy "pilot read sessions" on public.wildfire_sessions for select using (true);
create policy "pilot write sessions" on public.wildfire_sessions for insert with check (true);
create policy "pilot update sessions" on public.wildfire_sessions for update using (true) with check (true);

create policy "pilot read messages" on public.wildfire_messages for select using (true);
create policy "pilot write messages" on public.wildfire_messages for insert with check (true);

create policy "pilot read events" on public.wildfire_events for select using (true);
create policy "pilot write events" on public.wildfire_events for insert with check (true);

create policy "pilot read surveys" on public.wildfire_survey_checkpoints for select using (true);
create policy "pilot write surveys" on public.wildfire_survey_checkpoints for insert with check (true);
create policy "pilot update surveys" on public.wildfire_survey_checkpoints for update using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wildfire_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.wildfire_sessions';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wildfire_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.wildfire_messages';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wildfire_events'
  ) then
    execute 'alter publication supabase_realtime add table public.wildfire_events';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wildfire_survey_checkpoints'
  ) then
    execute 'alter publication supabase_realtime add table public.wildfire_survey_checkpoints';
  end if;
end $$;
