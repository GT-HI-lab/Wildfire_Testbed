# Experimenter Manual: Automated Prolific Edition

## 1. What Runs Automatically

The participant website and serverless backend remain available through Netlify. The experimenter dashboard does not need to stay open.

The system automatically:

- Reads Prolific participant, study, and submission identifiers.
- Verifies signed Prolific URLs or submission records when configured.
- Assigns participants evenly across 3 communication styles by 4 sequences.
- Preserves the same assignment across four waves.
- Prevents participants from skipping an incomplete prior wave.
- Creates and resumes the correct full-game reliability condition.
- Saves game state and behavioral events throughout the mission.
- Opens the in-game final survey at mission end.
- Stores a completion receipt before redirecting to Prolific.
- Mirrors normalized analysis records to Supabase when configured.

## 2. Study Design Encoded in the Testbed

Communication style is between subjects:

- Transparency
- Explainability
- Adaptability

Reliability is within subjects. Codes are Helicopter-Drone:

- HH: High-High
- HL: High-Low
- LH: Low-High
- LL: Low-Low

Counterbalance sequences:

- A: HH, HL, LH, LL
- B: LL, HL, LH, HH
- C: HH, LH, HL, LL
- D: LL, LH, HL, HH

The assignment service balances all 12 communication-style by sequence cells. The participant receives the same communication style and sequence in every wave.

## 3. Interfaces

### Participant

```text
https://YOUR-SITE.netlify.app/client/?wave=N
```

There is no manual session ID. The participant cannot select a communication style, sequence, or reliability condition.

### Administrator dashboard

```text
https://YOUR-SITE.netlify.app/server/
```

Enter `STUDY_ADMIN_KEY` to load the dashboard. It shows:

- Enrollment open or paused.
- Assigned participant count.
- Assignment and completion counts for all 12 cells.
- Recent participant waves and their status.
- A session selector for map, timer, event, and survey inspection.
- Registry and per-session exports.
- Supabase status and a repair/backfill control.

The dashboard is optional. Closing it does not stop timers, AI, saving, enrollment, or completion.

## 4. Before Publishing

1. Complete the independent Netlify deployment in `DEPLOYMENT.md`.
2. Create all four Prolific longitudinal waves before publishing Wave 1.
3. Configure a normal completion code for each wave.
4. Enter all study IDs and completion codes in Netlify.
5. Confirm `AI_ENABLED=true` and `STUDY_CONFIGURED=true` at the config endpoint.
6. Run `supabase/analytics-schema.sql`, configure the two Supabase Netlify variables, and confirm `ANALYTICS_CONFIGURED=true`.
7. Add the final survey questions in `shared/survey-config.js` or formally document that the survey checkpoint is intentionally blank.
8. Decide and preregister the treatment of technical failures and AI outages.
9. Run the complete test suite and a paid pilot.

## 5. Recommended Prolific Settings

- Use a longitudinal project with four studies.
- Restrict device compatibility to desktop.
- Record IDs through URL parameters.
- Use one normal completion code per wave.
- During the pilot, manually review submissions.
- Enable automatic approval only after validating the complete save and redirect flow.
- Do not automatically reject a participant for a technical failure.

Wave access should be scheduled according to the protocol. The testbed also requires the preceding local wave record to be complete.

## 6. Participant Flow

1. Participant reserves a Prolific place.
2. Prolific opens the correct wave URL with identifiers.
3. The client checks screen size, backend configuration, and Gemini availability.
4. The backend verifies the entry and resumes or creates the participant record.
5. Wave 1 creates the permanent 12-cell assignment. Later waves reuse it.
6. The assigned game loads from Netlify Blobs.
7. The participant completes the mission and embedded survey.
8. The backend validates the saved mission and survey state.
9. A receipt is stored and the participant is redirected to the wave's completion code.

If a participant reloads, the same Prolific link returns them to the same session. A duplicate tab cannot create a second assignment.

## 7. Daily Unattended Operation

The experimenter does not need to be present continuously. Check once or twice daily:

1. Prolific participant messages and technical submissions.
2. Netlify function errors and usage.
3. Gemini quota, billing, and API availability.
4. Dashboard counts across all 12 cells.
5. Sessions that enrolled but did not complete.
6. Supabase row growth, completion redirects, and survey response counts.
7. Approval of completed waves when manual review is enabled.

Export the Supabase deidentified views regularly. Keep the restricted Prolific registry export separate. Export individual session JSON only for detailed incident review or raw-state recovery.

## 8. Pausing the Study Remotely

At `/server/`, select **Pause New Sessions**. This blocks new enrollment while allowing already active sessions to continue. Select **Resume** when the problem is resolved.

Use the pause switch when:

- Gemini is unavailable or at quota.
- Netlify reports elevated function or storage errors.
- A deployment regression is detected.
- Prolific study IDs or completion codes need correction.

The participant client independently blocks new game entry when Gemini or study configuration is unhealthy.

## 9. AI Behavior and Failure Policy

Gemini credentials exist only in Netlify Functions. The participant interface does not display the provider, model, key status, or fallback mode.

In production:

- The game does not start while Gemini health verification fails.
- Chat requests retry once after a failure.
- A persistent chat failure blocks further interaction and asks the participant to retry connectivity.
- Deterministic fallback dialogue is not silently presented as experimental LLM communication.

In `PROLIFIC_TEST_MODE=true`, deterministic replies are permitted for local technical testing. Never enable this setting for data collection.

## 10. Condition Security

The backend, not the URL, chooses the assignment. Session state requests require a server-generated HMAC access token. Protected condition fields are rewritten from server-side metadata on every save.

Administrator data requires `STUDY_ADMIN_KEY`. Keep that key separate from `STUDY_ACCESS_SECRET`. Rotate and redeploy immediately if either value is exposed.

The registry contains Prolific IDs and must be treated as research data. Do not publish exports or commit them to source control.

The Supabase Secret key bypasses row-level security and belongs only in Netlify Functions. Never add it to `client/`, a participant URL, or a public repository.

## 11. Data Produced

The participant registry contains:

- Prolific participant ID.
- Participant pseudonymous hash.
- Communication-style and sequence assignment.
- Study and submission IDs for each wave.
- Enrollment and completion timestamps.
- Completion receipt and summary measures.

Each game session contains:

- Full fixed reliability configuration.
- Mission clock, positions, knowledge, detections, fires, and actions.
- Participant and AI messages.
- Tree cutting, movement, water, coordination, and override events.
- Survey responses and completion state.
- Deployment edition and wave.

Supabase normalizes these records into participant, wave, session summary, event, message, and survey-response tables. The Prolific ID is confined to `wildfire_participants`; behavioral tables use the one-way participant key.

## 12. Supabase Export and Recovery

For routine analysis, export these views as CSV from the Supabase Table Editor:

- `wildfire_analysis_wave_summary_deidentified`
- `wildfire_analysis_events_deidentified`
- `wildfire_analysis_messages_deidentified`
- `wildfire_analysis_survey_deidentified`

Use `wildfire_analysis_wave_summary_linkable` only for payment, withdrawal, and Prolific reconciliation. It contains `PROLIFIC_PID`, study ID, and submission ID.

If Supabase was added after pilot sessions or had an outage, open `/server/`, load the study with `STUDY_ADMIN_KEY`, and select **Sync Analytics**. The dashboard imports existing Netlify Blob sessions in small batches. This operation is idempotent and can be repeated.

Never delete the Netlify Blob records immediately after export. They are the authoritative recovery copy and contain the full game state.

## 13. Survey Editing

Edit `shared/survey-config.js`. Supported item types are:

- `scale`
- `choice`
- `text`

Keep question IDs stable after data collection begins. A blank `SURVEY_QUESTIONS` array produces an empty final checkpoint with a submit button.

## 14. Troubleshooting

### Session Unavailable before the game

Check the config endpoint. Both `AI_ENABLED` and `STUDY_CONFIGURED` must be true. Confirm the participant URL includes a valid wave number and Prolific URL parameters.

### Prolific link rejected

Confirm the Wave N Prolific study ID matches `PROLIFIC_STUDY_IDS`. When secure URLs are required, a signed link expires quickly and the participant should reopen the study through Prolific.

### Participant cannot enter the next wave

Confirm the prior wave shows `completed` in the dashboard. A mission without a submitted final checkpoint is intentionally incomplete.

### Completion does not redirect

Confirm the correct wave code in `PROLIFIC_COMPLETION_CODES`, redeploy, and inspect the `study-complete` function log. The participant can select **Retry Completion** without replaying the game.

### Chat stops

Check the `agent-ai` function log, Gemini key scope, model access, quota, and billing. Pause new enrollment until health returns.

### Dashboard cannot load

Confirm `STUDY_ADMIN_KEY` exactly matches the Netlify variable and that the latest deployment includes `study-admin.mjs`.

### Supabase analytics is not configured

Run `supabase/analytics-schema.sql`, confirm `SUPABASE_URL` and `SUPABASE_SECRET_KEY` have Functions scope in the Production deploy context, and redeploy. Then select **Sync Analytics** to repair earlier records.

### Supabase sync reports failures

Inspect the `study-admin` or `session-state` Function logs and Supabase API logs. Confirm both RPC functions exist and the configured key is a server Secret key. Participant games remain saved in Netlify Blobs; fix the configuration and run **Sync Analytics** again.

## 15. End-of-Study Procedure

1. Pause new enrollment.
2. Allow active participants to finish or handle them under the approved technical-failure policy.
3. Run **Sync Analytics** and confirm that it finishes without failures.
4. Export all deidentified Supabase analysis views.
5. Export the restricted linkable view separately and reconcile completion receipts with Prolific submissions.
6. Review missing waves, duplicate submissions, AI incidents, and protocol deviations.
7. Back up research data in the approved institutional location.
8. Stop the Prolific studies and restrict or remove the production admin and Supabase keys.
