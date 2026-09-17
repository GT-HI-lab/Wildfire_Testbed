# Visual detection secondary task

Implemented locally for newly enrolled game sessions. Existing sessions retain their original protocol. This update has not been deployed or verified against live Netlify, Prolific or Supabase services.

## Participant flow

Before each round, the participant sees:

> Your main job is the wildfire task. If the amber lamp turns on, press Space as quickly as you can without neglecting the fire.

The baseline questionnaire comes first in game 1. Clicking Start round enables the game and detection task. A fixed strip above the map contains a dim circle that turns bright amber. It does not cover the map or animate.

The lamp stays on for 3 seconds even after a hit. The next randomly selected off period is 17–20 seconds, measured from lamp offset. This small adjustment from the proposed 15–20 seconds keeps uninterrupted cycles at approximately 2.6–3 probes/minute. The interval is configurable in `shared/detection-task.js`. Pilot this setting before recruitment; it is an experimental design choice, not a validated workload threshold.

Only the first Space press during a probe counts as its response. No response within 3 seconds produces a miss. Space while the lamp is off produces a separate false-alarm record. Held-key repeats do not create additional responses.

Space inside a text field remains normal typing and is excluded from detection responses. The lamp continues while typing. Records flag text focus at onset and during the probe so these trials can be identified during analysis. This implements the proposed chat-conflict handling: participants must leave the text field to respond. Include this explanation in participant training; typing-overlap trials should not be interpreted as pure visual-detection failures.

Questionnaires, inactive browser tabs/windows and completion suspend detection. An active probe becomes `interrupted`, not a miss. Resuming starts a fresh random delay. A rendering gap exceeding 250 ms also interrupts the probe and restarts the delay. Interrupted records can retain a prior hit, so filter by `status` for valid-trial analyses. This browser implementation does not calibrate physical display or keyboard latency.

## Recorded data

- `probe_onset_ms`, `response_ms`, `lamp_off_ms`: epoch milliseconds derived from the browser performance clock. Missing values are null.
- `rt_ms`: response minus onset using the monotonic performance clock.
- `hit`, `miss`, `false_alarm`, plus `status`: pending, hit, miss, false_alarm or interrupted.
- `scenario_time_ms`: elapsed wildfire-round time at probe onset, or at a false alarm; questionnaire time is excluded.
- `text_focus_at_onset`, `text_focus_during_probe`, `interruption_reason`.
- Record ID and revision support retries without duplicate trials or stale overwrites.
- Server-assigned game session, participant key, wave and game identifiers link the data to the study.

The Supabase view `wildfire_detection_linkable` includes `prolific_pid`, `study_id`, and `session_id` (the Prolific submission/session ID). `wildfire_detection_deidentified` excludes these direct Prolific identifiers and includes study condition information. Both views require server-side access. Pending/interrupted trials are not ordinary misses.

## Persistence and deployment

Browser local storage queues records, with uploads attempted every 2 seconds. Completion waits for the queue to save successfully; connection failures allow retry. Reload marks queued unfinished probes as interrupted. A browser lock prevents two tabs from running the same session's detection task simultaneously. Participants must use a current desktop browser with local storage and Web Locks support.

1. Back up the existing Supabase database.
2. Run the complete updated `supabase/analytics-schema.sql` in Supabase SQL Editor. It adds the detection table, ingestion RPC, restricted views and permissions while preserving prior data.
3. Deploy the complete project via the Netlify Git build described in `ONLINE_SETUP_GUIDE.md`; include the new `detection-events` function and the rebuilt client/shared files. Uploading static files alone is insufficient.
4. Keep the Supabase service-role key in Netlify environment variables only.
5. Start a new test participant/session. Confirm instructions appear every round, lamp behavior, Space hit/miss/false alarms, chat typing, questionnaire pause/resume, reload, and completion.
6. Verify actual rows in both detection views and correct Prolific identifiers. The administrator backfill now includes detection records if Supabase ingestion temporarily fails. Primary records remain in Netlify Blobs under each session's detection key.
7. Complete a small human pilot and the online acceptance checklist before recruiting participants.

Authenticated GET `/.netlify/functions/detection-events?sessionId=<game-session-id>` returns that game's saved records. Participant tokens access their own game; administrators can inspect authorized study sessions.

## Verification

Automated timing tests cover onset/offset scheduling, a fixed on duration after a hit, misses, false alarms, repeat and text-field exclusions, focus flags, and interruptions. Real local HTTP tests cover authentication, saving and duplicate retry handling across four waves. A local PostgreSQL-compatible PGlite test executes the actual SQL migration and RPC, verifies stale-revision protection and the Prolific identity view. The full test suite and 14-file production build pass.

A browser inspection confirmed the lamp strip is present, but the embedded browser's viewport was below the required desktop size and the tab subsequently became unavailable. A complete real-browser lamp/Space trial remains an acceptance check; automated engine/API tests do not replace that check. Live deployment remains unverified.
