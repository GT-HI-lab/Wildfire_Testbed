-- CREW Wildfire analysis warehouse for Supabase.
-- Run this entire file once in the Supabase SQL Editor.

create table if not exists public.wildfire_participants (
  participant_key text primary key,
  prolific_pid text not null,
  communication_style text,
  counterbalance_sequence text,
  assigned_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.wildfire_waves (
  game_session_id text primary key,
  participant_key text not null,
  wave smallint not null check (wave between 1 and 4),
  study_id text,
  submission_id text,
  reliability_code text,
  status text not null,
  enrolled_at timestamptz,
  completed_at timestamptz,
  receipt_id text,
  final_score numeric,
  final_tick integer,
  survey_response_count integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.wildfire_session_summaries (
  game_session_id text primary key,
  participant_key text not null,
  wave smallint not null check (wave between 1 and 4),
  communication_style text,
  counterbalance_sequence text,
  condition_code text,
  helicopter_reliability text,
  drone_reliability text,
  session_status text,
  session_revision integer,
  tick integer not null default 0,
  paused boolean not null default false,
  mission_started_at timestamptz,
  mission_elapsed_seconds integer,
  mission_remaining_seconds integer,
  mission_completed boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  survey_completed boolean not null default false,
  survey_completed_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.wildfire_events (
  event_id text primary key,
  game_session_id text not null,
  participant_key text not null,
  wave smallint not null check (wave between 1 and 4),
  session_revision integer,
  tick integer,
  event_type text not null,
  event_text text,
  happened_at timestamptz not null,
  body jsonb not null default '{}'::jsonb
);

create table if not exists public.wildfire_messages (
  message_id text primary key,
  game_session_id text not null,
  participant_key text not null,
  wave smallint not null check (wave between 1 and 4),
  session_revision integer,
  role text,
  author text,
  message_text text,
  happened_at timestamptz not null,
  body jsonb not null default '{}'::jsonb
);

create table if not exists public.wildfire_survey_responses (
  game_session_id text not null,
  participant_key text not null,
  wave smallint not null check (wave between 1 and 4),
  question_id text not null,
  response_text text,
  submitted_at timestamptz not null,
  primary key (game_session_id, question_id)
);

-- Additive survey v2 migration. Existing legacy rows retain null metadata.
alter table public.wildfire_survey_responses add column if not exists item_id text;
alter table public.wildfire_survey_responses add column if not exists checkpoint text;
alter table public.wildfire_survey_responses add column if not exists measure text;
alter table public.wildfire_survey_responses add column if not exists target text;
alter table public.wildfire_survey_responses add column if not exists subscale text;
alter table public.wildfire_survey_responses add column if not exists response_numeric numeric;
alter table public.wildfire_survey_responses add column if not exists scored_value numeric;
alter table public.wildfire_survey_responses add column if not exists does_not_fit boolean;
alter table public.wildfire_survey_responses add column if not exists survey_version integer;
alter table public.wildfire_survey_responses add column if not exists trigger_reason text;

alter table public.wildfire_events add column if not exists session_revision integer;
alter table public.wildfire_messages add column if not exists session_revision integer;

create index if not exists wildfire_waves_participant_idx on public.wildfire_waves (participant_key, wave);
create index if not exists wildfire_events_session_time_idx on public.wildfire_events (game_session_id, happened_at);
create index if not exists wildfire_events_type_idx on public.wildfire_events (event_type);
create index if not exists wildfire_messages_session_time_idx on public.wildfire_messages (game_session_id, happened_at);
create index if not exists wildfire_survey_participant_idx on public.wildfire_survey_responses (participant_key, wave);

alter table public.wildfire_participants enable row level security;
alter table public.wildfire_waves enable row level security;
alter table public.wildfire_session_summaries enable row level security;
alter table public.wildfire_events enable row level security;
alter table public.wildfire_messages enable row level security;
alter table public.wildfire_survey_responses enable row level security;

revoke all on table public.wildfire_participants from anon, authenticated;
revoke all on table public.wildfire_waves from anon, authenticated;
revoke all on table public.wildfire_session_summaries from anon, authenticated;
revoke all on table public.wildfire_events from anon, authenticated;
revoke all on table public.wildfire_messages from anon, authenticated;
revoke all on table public.wildfire_survey_responses from anon, authenticated;

grant select, insert, update, delete on table public.wildfire_participants to service_role;
grant select, insert, update, delete on table public.wildfire_waves to service_role;
grant select, insert, update, delete on table public.wildfire_session_summaries to service_role;
grant select, insert, update, delete on table public.wildfire_events to service_role;
grant select, insert, update, delete on table public.wildfire_messages to service_role;
grant select, insert, update, delete on table public.wildfire_survey_responses to service_role;

create or replace function public.wildfire_ingest_session(
  p_summary jsonb,
  p_events jsonb default '[]'::jsonb,
  p_messages jsonb default '[]'::jsonb,
  p_survey_responses jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wildfire_session_summaries (
    game_session_id, participant_key, wave, communication_style, counterbalance_sequence,
    condition_code, helicopter_reliability, drone_reliability, session_status,
    session_revision, tick, paused, mission_started_at, mission_elapsed_seconds,
    mission_remaining_seconds, mission_completed, metrics, survey_completed,
    survey_completed_at, synced_at
  ) values (
    p_summary->>'game_session_id', p_summary->>'participant_key', (p_summary->>'wave')::smallint,
    p_summary->>'communication_style', p_summary->>'counterbalance_sequence',
    p_summary->>'condition_code', p_summary->>'helicopter_reliability', p_summary->>'drone_reliability',
    p_summary->>'session_status', nullif(p_summary->>'session_revision', '')::integer,
    coalesce(nullif(p_summary->>'tick', '')::integer, 0), coalesce((p_summary->>'paused')::boolean, false),
    nullif(p_summary->>'mission_started_at', '')::timestamptz,
    nullif(p_summary->>'mission_elapsed_seconds', '')::integer,
    nullif(p_summary->>'mission_remaining_seconds', '')::integer,
    coalesce((p_summary->>'mission_completed')::boolean, false),
    coalesce(p_summary->'metrics', '{}'::jsonb),
    coalesce((p_summary->>'survey_completed')::boolean, false),
    nullif(p_summary->>'survey_completed_at', '')::timestamptz,
    coalesce(nullif(p_summary->>'synced_at', '')::timestamptz, now())
  )
  on conflict (game_session_id) do update set
    communication_style = excluded.communication_style,
    counterbalance_sequence = excluded.counterbalance_sequence,
    condition_code = excluded.condition_code,
    helicopter_reliability = excluded.helicopter_reliability,
    drone_reliability = excluded.drone_reliability,
    session_status = excluded.session_status,
    session_revision = excluded.session_revision,
    tick = excluded.tick,
    paused = excluded.paused,
    mission_started_at = excluded.mission_started_at,
    mission_elapsed_seconds = excluded.mission_elapsed_seconds,
    mission_remaining_seconds = excluded.mission_remaining_seconds,
    mission_completed = excluded.mission_completed,
    metrics = excluded.metrics,
    survey_completed = excluded.survey_completed,
    survey_completed_at = excluded.survey_completed_at,
    synced_at = excluded.synced_at
  where coalesce(excluded.session_revision, -1) >= coalesce(public.wildfire_session_summaries.session_revision, -1);

  insert into public.wildfire_events (
    event_id, game_session_id, participant_key, wave, session_revision, tick,
    event_type, event_text, happened_at, body
  )
  select event_id, game_session_id, participant_key, wave, session_revision, tick, event_type, event_text,
    happened_at::timestamptz, body
  from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as event_rows(
    event_id text, game_session_id text, participant_key text, wave smallint,
    session_revision integer, tick integer, event_type text, event_text text,
    happened_at text, body jsonb
  )
  on conflict (event_id) do update set
    session_revision = excluded.session_revision,
    tick = excluded.tick,
    event_type = excluded.event_type,
    event_text = excluded.event_text,
    happened_at = excluded.happened_at,
    body = excluded.body
  where coalesce(excluded.session_revision, -1) >= coalesce(public.wildfire_events.session_revision, -1);

  insert into public.wildfire_messages (
    message_id, game_session_id, participant_key, wave, session_revision,
    role, author, message_text, happened_at, body
  )
  select message_id, game_session_id, participant_key, wave, session_revision, role, author, message_text,
    happened_at::timestamptz, body
  from jsonb_to_recordset(coalesce(p_messages, '[]'::jsonb)) as message_rows(
    message_id text, game_session_id text, participant_key text, wave smallint,
    session_revision integer, role text, author text, message_text text,
    happened_at text, body jsonb
  )
  on conflict (message_id) do update set
    session_revision = excluded.session_revision,
    role = excluded.role,
    author = excluded.author,
    message_text = excluded.message_text,
    happened_at = excluded.happened_at,
    body = excluded.body
  where coalesce(excluded.session_revision, -1) >= coalesce(public.wildfire_messages.session_revision, -1);

  insert into public.wildfire_survey_responses (
    game_session_id, participant_key, wave, question_id, response_text, submitted_at,
    item_id, checkpoint, measure, target, subscale, response_numeric, scored_value,
    does_not_fit, survey_version, trigger_reason
  )
  select game_session_id, participant_key, wave, question_id, response_text, submitted_at::timestamptz,
    item_id, checkpoint, measure, target, subscale, response_numeric, scored_value,
    does_not_fit, survey_version, trigger_reason
  from jsonb_to_recordset(coalesce(p_survey_responses, '[]'::jsonb)) as survey_rows(
    game_session_id text, participant_key text, wave smallint, question_id text,
    response_text text, submitted_at text, item_id text, checkpoint text, measure text,
    target text, subscale text, response_numeric numeric, scored_value numeric,
    does_not_fit boolean, survey_version integer, trigger_reason text
  )
  on conflict (game_session_id, question_id) do update set
    response_text = excluded.response_text, submitted_at = excluded.submitted_at,
    item_id = excluded.item_id, checkpoint = excluded.checkpoint, measure = excluded.measure,
    target = excluded.target, subscale = excluded.subscale, response_numeric = excluded.response_numeric,
    scored_value = excluded.scored_value, does_not_fit = excluded.does_not_fit,
    survey_version = excluded.survey_version, trigger_reason = excluded.trigger_reason
  where excluded.submitted_at >= public.wildfire_survey_responses.submitted_at;
end;
$$;

create or replace function public.wildfire_record_enrollment(
  p_participant jsonb,
  p_wave jsonb,
  p_summary jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wildfire_participants (
    participant_key, prolific_pid, communication_style, counterbalance_sequence, assigned_at, updated_at
  ) values (
    p_participant->>'participant_key', p_participant->>'prolific_pid',
    p_participant->>'communication_style', p_participant->>'counterbalance_sequence',
    nullif(p_participant->>'assigned_at', '')::timestamptz,
    coalesce(nullif(p_participant->>'updated_at', '')::timestamptz, now())
  )
  on conflict (participant_key) do update set
    prolific_pid = excluded.prolific_pid,
    communication_style = excluded.communication_style,
    counterbalance_sequence = excluded.counterbalance_sequence,
    updated_at = excluded.updated_at
  where excluded.updated_at >= public.wildfire_participants.updated_at;

  insert into public.wildfire_waves (
    game_session_id, participant_key, wave, study_id, submission_id, reliability_code,
    status, enrolled_at, completed_at, receipt_id, final_score, final_tick,
    survey_response_count, updated_at
  ) values (
    p_wave->>'game_session_id', p_wave->>'participant_key', (p_wave->>'wave')::smallint,
    p_wave->>'study_id', p_wave->>'submission_id', p_wave->>'reliability_code', p_wave->>'status',
    nullif(p_wave->>'enrolled_at', '')::timestamptz,
    nullif(p_wave->>'completed_at', '')::timestamptz,
    p_wave->>'receipt_id', nullif(p_wave->>'final_score', '')::numeric,
    nullif(p_wave->>'final_tick', '')::integer,
    nullif(p_wave->>'survey_response_count', '')::integer,
    coalesce(nullif(p_wave->>'updated_at', '')::timestamptz, now())
  )
  on conflict (game_session_id) do update set
    study_id = excluded.study_id,
    submission_id = excluded.submission_id,
    reliability_code = excluded.reliability_code,
    status = excluded.status,
    completed_at = excluded.completed_at,
    receipt_id = excluded.receipt_id,
    final_score = excluded.final_score,
    final_tick = excluded.final_tick,
    survey_response_count = excluded.survey_response_count,
    updated_at = excluded.updated_at
  where excluded.updated_at >= public.wildfire_waves.updated_at;

  perform public.wildfire_ingest_session(p_summary, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
end;
$$;

-- The identifiable view is only for Prolific reconciliation. The deidentified
-- views are the default exports for statistical analysis.
create or replace view public.wildfire_analysis_wave_summary_deidentified
with (security_invoker = true) as
select
  w.participant_key,
  p.communication_style,
  p.counterbalance_sequence,
  w.wave,
  w.game_session_id,
  w.reliability_code,
  w.status,
  w.enrolled_at,
  w.completed_at,
  w.final_score,
  w.final_tick,
  w.survey_response_count,
  s.metrics,
  s.session_status,
  s.mission_started_at,
  s.mission_elapsed_seconds,
  s.survey_completed,
  s.survey_completed_at,
  nullif(s.metrics->>'score', '')::numeric as score,
  nullif(s.metrics->>'acceptedRecommendations', '')::integer as accepted_recommendations,
  nullif(s.metrics->>'overrides', '')::integer as overrides,
  nullif(s.metrics->>'helicopterCommands', '')::integer as helicopter_commands,
  nullif(s.metrics->>'droneDetections', '')::integer as drone_detections,
  nullif(s.metrics->>'chatMessages', '')::integer as chat_messages,
  nullif(s.metrics->>'waterDrops', '')::integer as water_drops,
  nullif(s.metrics->>'firefighterRefills', '')::integer as firefighter_refills,
  nullif(s.metrics->>'firefighterCuts', '')::integer as firefighter_cuts,
  nullif(s.metrics->>'waterTransfers', '')::integer as water_transfers,
  nullif(s.metrics->>'bulldozerActions', '')::integer as bulldozer_actions,
  s.metrics->'responseTimes' as response_times
from public.wildfire_waves w
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_session_summaries s using (game_session_id);

create or replace view public.wildfire_analysis_wave_summary_linkable
with (security_invoker = true) as
select
  p.prolific_pid,
  w.study_id,
  w.submission_id,
  d.*,
  w.receipt_id
from public.wildfire_analysis_wave_summary_deidentified d
join public.wildfire_waves w using (game_session_id, participant_key, wave)
join public.wildfire_participants p using (participant_key);

create or replace view public.wildfire_analysis_events_deidentified
with (security_invoker = true) as
select
  e.participant_key, e.wave, e.game_session_id, p.communication_style,
  p.counterbalance_sequence, w.reliability_code, e.event_id, e.happened_at,
  e.tick, e.event_type, e.event_text, e.body
from public.wildfire_events e
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_waves w using (game_session_id);

create or replace view public.wildfire_analysis_messages_deidentified
with (security_invoker = true) as
select
  m.participant_key, m.wave, m.game_session_id, p.communication_style,
  p.counterbalance_sequence, w.reliability_code, m.message_id, m.happened_at,
  m.role, m.author, m.message_text
from public.wildfire_messages m
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_waves w using (game_session_id);

create or replace view public.wildfire_analysis_survey_deidentified
with (security_invoker = true) as
select
  r.participant_key, r.wave, r.game_session_id, p.communication_style,
  p.counterbalance_sequence, w.reliability_code, r.question_id,
  r.response_text, r.submitted_at,
  r.item_id, r.checkpoint, r.measure, r.target, r.subscale, r.response_numeric,
  r.scored_value, r.does_not_fit, r.survey_version, r.trigger_reason
from public.wildfire_survey_responses r
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_waves w using (game_session_id);

revoke all on function public.wildfire_record_enrollment(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.wildfire_ingest_session(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.wildfire_record_enrollment(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.wildfire_ingest_session(jsonb, jsonb, jsonb, jsonb) to service_role;

revoke all on table public.wildfire_analysis_wave_summary_deidentified from anon, authenticated;
revoke all on table public.wildfire_analysis_wave_summary_linkable from anon, authenticated;
revoke all on table public.wildfire_analysis_events_deidentified from anon, authenticated;
revoke all on table public.wildfire_analysis_messages_deidentified from anon, authenticated;
revoke all on table public.wildfire_analysis_survey_deidentified from anon, authenticated;
grant select on table public.wildfire_analysis_wave_summary_deidentified to service_role;
grant select on table public.wildfire_analysis_wave_summary_linkable to service_role;
grant select on table public.wildfire_analysis_events_deidentified to service_role;
grant select on table public.wildfire_analysis_messages_deidentified to service_role;
grant select on table public.wildfire_analysis_survey_deidentified to service_role;

-- Visual detection task: independently saved from game-state checkpoints.
create table if not exists public.wildfire_detection_events (
  id text primary key, game_session_id text not null, participant_key text not null,
  wave smallint not null, revision integer not null, kind text not null, status text not null,
  probe_onset_ms double precision, response_ms double precision, rt_ms double precision,
  hit boolean not null, miss boolean not null, false_alarm boolean not null,
  scenario_time_ms double precision not null, lamp_off_ms double precision,
  interruption_reason text, text_focus_at_onset boolean, text_focus_during_probe boolean
);
alter table public.wildfire_detection_events enable row level security;
revoke all on public.wildfire_detection_events from anon, authenticated;
grant select, insert, update on public.wildfire_detection_events to service_role;
create index if not exists wildfire_detection_session_idx on public.wildfire_detection_events(game_session_id);
create or replace function public.wildfire_ingest_detection(p_records jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.wildfire_detection_events
  select * from jsonb_populate_recordset(null::public.wildfire_detection_events, p_records)
  on conflict (id) do update set
    revision = excluded.revision, status = excluded.status, response_ms = excluded.response_ms,
    rt_ms = excluded.rt_ms, hit = excluded.hit, miss = excluded.miss,
    lamp_off_ms = excluded.lamp_off_ms, interruption_reason = excluded.interruption_reason,
    text_focus_during_probe = excluded.text_focus_during_probe
  where excluded.revision > public.wildfire_detection_events.revision;
$$;
revoke all on function public.wildfire_ingest_detection(jsonb) from public, anon, authenticated;
grant execute on function public.wildfire_ingest_detection(jsonb) to service_role;
create or replace view public.wildfire_detection_deidentified with (security_invoker = true) as
select d.*, p.communication_style, p.counterbalance_sequence, w.reliability_code
from public.wildfire_detection_events d
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_waves w using (game_session_id);
create or replace view public.wildfire_detection_linkable with (security_invoker = true) as
select d.*, p.prolific_pid, w.study_id, w.submission_id as session_id
from public.wildfire_detection_events d
left join public.wildfire_participants p using (participant_key)
left join public.wildfire_waves w using (game_session_id);
revoke all on public.wildfire_detection_deidentified, public.wildfire_detection_linkable from anon, authenticated;
grant select on public.wildfire_detection_deidentified, public.wildfire_detection_linkable to service_role;
