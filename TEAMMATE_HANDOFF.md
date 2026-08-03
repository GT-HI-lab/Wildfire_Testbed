# CREW Wildfire Human-AI Teaming Environment

## Teammate Handoff and Test Guide

This package contains a browser-based wildfire teaming environment with four operational roles:

- Human participant controlling a firefighter and participant-directed bulldozer.
- Drone AI performing paced reconnaissance for fire and water.
- Helicopter AI performing routing, refill, pickup, drop-off, and water-delivery support.
- Experimenter server controlling mission state, timing, condition, pauses, surveys, and data export.

The environment is designed for a 30-minute human-AI teaming session and a hidden trust/distrust manipulation. It can use Gemini or OpenAI for agent dialogue. The recommended configuration for this handoff is Gemini.

Use `EXPERIMENTER_MANUAL.md` as the complete experimenter setup and operating guide.

## Important Design Principle

The language model does not directly modify ground truth or invent executable actions. The model produces constrained operational dialogue. The simulator owns:

- Fire and water ground truth.
- Drone sensing range and discovery timing.
- Participant visibility and fog-of-war.
- Helicopter knowledge.
- Movement and action execution.
- The hidden distrust manipulation.
- Mission timing and event logging.

This hybrid design makes the agents model-backed while keeping experimental behavior reproducible and auditable.

## Implemented Requirements

### 1. Larger map and paced drone reconnaissance

- New sessions use a 240 x 240 map.
- The drone follows a 40-waypoint serpentine sweep with visible course changes throughout each map row.
- A full first sweep takes approximately 28 minutes in every condition.
- The automated test confirms the first sweep is not complete at 25:00.
- The drone detects both fire and water only when they enter sensing range.
- Detected objects carry a source, type, confidence, and detection tick.

### 2. Helicopter knowledge boundary

The helicopter begins with empty fire and water knowledge arrays. It does not receive the server's ground-truth `fires` or `waterSources` collections.

The helicopter can learn a location from:

- A participant message containing explicit coordinates.
- The participant selecting **Share Drone Intel** after the drone confirms detections.
- A direct participant reassignment based on previously confirmed information.

If asked to fly to a fire before information is shared, the expected reply is:

> I do not have that location. Share Drone AI intelligence or send me explicit coordinates.

### 3. Distrust manipulation and recovery choices

The hidden malfunction is active in the **Mixed** reliability condition after two fire sections are completed.

During the malfunction:

- The helicopter reports the intended assignment.
- Its actual destination is changed to an area outside the drone's discovered cells.
- Autonomous drone scanning and map reveal are blocked around that destination until the participant requests a helicopter check.
- The server records intended and actual targets separately.
- The participant is not directly told that a malfunction started.

Participant recovery options are:

- **Drone: Locate Heli**: authorizes and temporarily diverts the drone to verify helicopter position and route. A natural-language locate/check request to Drone AI does the same.
- **Share Drone Intel**: transfers confirmed drone fire/water observations into helicopter knowledge.
- **Reassign Heli**: directly sends the helicopter to a confirmed fire coordinate and resolves the hidden navigation inconsistency.
- Natural-language clarification or correction in helicopter chat.

### 4. Larger participant minimap

- The minimap is up to 360 x 360 pixels on desktop.
- It displays only firefighter-visible and drone-discovered areas.
- Undiscovered areas remain black.
- The server map always retains complete ground truth.

### 5. Mission countdown

- Every new mission starts at 30:00.
- The displayed countdown follows a shared wall-clock deadline, so delayed network writes do not make it pause or rewind.
- The server advances the simulation once per second.
- Pause and survey checkpoints stop simulation advancement. Checkpoints show the configured external Qualtrics link on the participant client.
- At 00:00 the mission becomes complete and cannot be resumed without resetting.

### 6. Gemini and OpenAI agent providers

Both agents use `netlify/functions/agent-ai.mjs`.

Recommended Gemini variables:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your Gemini API key
GEMINI_MODEL=gemini-3.6-flash
```

Optional OpenAI variables:

```text
AI_PROVIDER=openai
OPENAI_API_KEY=your OpenAI API key
OPENAI_MODEL=gpt-5.4-mini
```

If no valid provider key is present, the application continues with deterministic fallback dialogue. The UI clearly reports the active provider or fallback mode.

API keys remain inside Netlify Functions. They must never be placed in browser files such as `shared/env.js`.

### 7. First-person environment

The participant view uses a procedural perspective renderer informed by the existing CREW Unity wildfire project:

- Dirt-colored ground.
- Layered conifer trees using the Unity forest palette.
- Perspective water surfaces.
- Layered flames and smoke.
- Distance-scaled drone, helicopter, and bulldozer objects.
- Heading-relative forward/back movement, explicit turning, and firefighter lake refill controls.

### 8. Agent identification

The firefighter, drone, helicopter, and bulldozer use different colors and vector silhouettes on the server map and participant view. Chat and server diagnostics also use `FF`, `DR`, `HE`, and `DZ` identity badges.

## Package Structure

```text
wildfire-web/
  client/                         Participant interface
  server/                         Experimenter interface
  shared/                         Simulation, rendering, and realtime state
  netlify/functions/              Gemini/OpenAI server-side functions
  supabase/schema.sql             Database, RLS, indexes, and realtime setup
  tests/                          Simulation and provider smoke tests
  .env.example                    Environment variable template
  netlify.toml                    Netlify build/functions configuration
  DEPLOYMENT.md                   Concise deployment checklist
  TEAMMATE_HANDOFF.md             This document
  README.md                       Project overview
```

The package root also contains `.github/workflows/wildfire-web-checks.yml` for GitHub validation.

## Required Accounts and Tools

The teammate needs:

- A GitHub account.
- A Netlify account.
- A Supabase account.
- A Gemini API key from Google AI Studio.
- Git and Node.js 22 or newer for local validation.

No JavaScript dependencies need to be installed for the automated smoke tests.

## Step 1: Run Automated Tests

From `wildfire-web`:

```bash
npm run check
npm test
```

Expected results include:

- `mapSize: 240`
- `missionSeconds: 1800`
- `completedSweeps: 0` after the simulated 25-minute checkpoint
- A malfunction false target outside drone coverage
- `geminiProvider: "gemini"`
- `geminiModel: "gemini-3.6-flash"`

The Gemini provider test uses a local mock and does not consume API quota.

## Step 2: Create the Supabase Project

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Paste the complete contents of `supabase/schema.sql`.
4. Run the script.
5. Open **Project Settings > API**.
6. Record the project URL and anon public key.

Do not use the service-role key in this application.

The schema creates:

- `wildfire_sessions`
- `wildfire_messages`
- `wildfire_events`
- `wildfire_survey_checkpoints`
- Realtime publication entries
- Session/time indexes
- Pilot row-level security policies

The supplied policies allow anonymous pilot access. They are not appropriate for identifiable participant data. Add authenticated or participant-code policies before a real data collection containing personal information.

## Step 3: Create the GitHub Repository

Create an empty repository, then from the uncompressed package root run:

```bash
git init
git add .
git commit -m "Add CREW wildfire teaming environment"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

After the push, open the repository's **Actions** tab. The **Wildfire Web Checks** workflow should pass.

## Step 4: Deploy to Netlify

1. In Netlify, select **Add new site > Import an existing project**.
2. Select the GitHub repository.
3. Set **Base directory** to `wildfire-web`.
4. Leave **Build command** empty.
5. Set **Publish directory** to `.`.
6. Confirm **Functions directory** is `netlify/functions`.
7. Add the environment variables below.

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your Gemini API key
GEMINI_MODEL=gemini-3.6-flash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your anon public key
QUALTRICS_SURVEY_URL=https://your-organization.qualtrics.com/jfe/form/SV_yourSurveyId
```

8. Deploy the site.
9. Trigger one additional deploy after saving environment variables if Netlify does not automatically redeploy.

Expected routes:

- `https://YOUR-SITE.netlify.app/server/`
- `https://YOUR-SITE.netlify.app/client/`
- `https://YOUR-SITE.netlify.app/.netlify/functions/config`

The config endpoint should report `AI_ENABLED: true`, `AI_PROVIDER: "gemini"`, and the selected model. It never returns the API key. Both application pages should also display `Realtime connected`; `Local only` cannot synchronize separate computers.

## Step 5: Cross-Device Realtime Test

Use two browser windows or two devices.

### Experimenter device

1. Open `/server/`.
2. Enter a unique session ID such as `pilot-test-001`.
3. Select **Connect**.
4. Select **Reset** once.
5. Confirm the status is Running and the clock decreases from 30:00.

### Participant device

1. Open `/client/`.
2. Enter the identical session ID.
3. Select **Join**.
4. Confirm the participant clock matches the server.
5. Move east once.

Expected result: the firefighter position changes on both devices without reloading either page.

If synchronization works only in two tabs on the same browser but not across devices, the application is using local fallback instead of Supabase. Recheck `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and whether `schema.sql` was run.

## Step 6: Knowledge-Boundary Test

Run this immediately after a fresh reset, before sharing drone intelligence.

1. In participant chat, send `Fly to the nearest fire`.
2. Observe the helicopter reply.
3. Check the server helicopter position and target.

Expected result:

- The helicopter says it lacks the location.
- It does not receive a movement target.
- It does not move toward server ground truth.

Then send `Fly to 180, 60`.

Expected result:

- The helicopter acknowledges coordinates.
- The human-provided coordinate is stored in helicopter knowledge.
- The server shows an intended destination.

## Step 7: Drone and Fog-of-War Test

1. Start a fresh mission.
2. Observe the participant minimap during the first several minutes.
3. Compare it with the server map.

Expected result:

- Server map shows the full terrain, fires, water, and all agents.
- Participant minimap shows only a narrow drone sweep plus firefighter-local visibility.
- The entire map must not appear at once.
- Fire and water markers appear only after discovery.

Select **Share Drone Intel** before any detections.

Expected result: Drone AI reports that no confirmed coordinates are available.

Select it again after confirmed detections.

Expected result: the drone states how many fire and water coordinates were shared, and helicopter knowledge updates.

## Step 8: Distrust-Manipulation Test

The live manipulation is intentionally hidden and requires the **Mixed** condition plus two completed fire sections.

1. Select **Mixed** on the server.
2. Suppress enough fire for two sections to become complete.
3. Assign the helicopter to a known fire coordinate.
4. Compare the server's `reportedAction`, `actualAction`, `intendedTarget`, and `actualTarget` fields.

Expected result:

- The intended target reflects the participant assignment.
- The actual target is in a different, drone-unscanned area.
- The participant is not directly notified that the manipulation started.

Then select **Drone: Locate Heli**.

Expected result: the drone diverts from its sweep and reports whether the helicopter route is inconsistent.

Finally select **Reassign Heli**.

Expected result:

- The hidden malfunction recovers.
- The helicopter routes to a confirmed destination.
- The event log records participant-driven recovery.

The automated smoke test also verifies that the false destination is outside drone-discovered cells.

## Step 9: Pause and Survey Test

1. On the server, select **Pause**.
2. Select **T1**.
3. Confirm the client displays the T1 pause overlay and an **Open T1 Survey** link.
4. Confirm participant controls stop changing state.
5. Open the link and verify it uses the configured Qualtrics survey URL with `session_id` and `checkpoint` parameters.
6. Select **End Survey & Resume**.
7. Confirm the overlay disappears and the countdown resumes.

Repeat for T2 and T3 as required by the study protocol.

## Step 10: Data Export Test

From the server, select:

- **Export JSON** for the complete state and event objects.
- **Export CSV** for analysis-friendly event rows.

Verify that exported records include:

- Session ID and tick.
- Human actions and chat.
- Drone detections and reports.
- Survey checkpoint requests and experimenter-cleared completions.
- Helicopter reported and actual actions.
- Intended and actual targets.
- Malfunction onset and recovery.
- Survey pauses.
- Scores and operational metrics.

## Reliability Conditions

### High-High

- Accurate helicopter command interpretation.
- No hidden Mixed-condition malfunction.

### Mixed

- Accurate helicopter operation before the manipulation.
- Hidden helicopter route corruption after two completed sections.
- The diverted destination stays outside autonomous drone detection until the participant requests a helicopter check.
- Participant detection and recovery are measurable.

### Low-Low

- Consistently offset helicopter navigation from mission start.
- No hidden post-section trigger is required for degraded behavior.

Drone speed, patrol route, scan interval, detection accuracy, and confidence are identical in all three conditions. Distrust-spread manipulation changes only helicopter behavior.

## Troubleshooting

### AI status says Deterministic fallback

- Confirm `AI_PROVIDER=gemini`.
- Confirm `GEMINI_API_KEY` is set in Netlify, not in browser code.
- Confirm `GEMINI_MODEL=gemini-3.6-flash`.
- Redeploy after changing environment variables.
- Check Netlify function logs for `agent-ai`.

### Server and client do not synchronize across devices

- Confirm both use the same session ID, including capitalization.
- Confirm Supabase variables are set in Netlify.
- Run `supabase/schema.sql` again; it is idempotent.
- Confirm Supabase Realtime is enabled for the four wildfire tables.

### Timer stops

- The server page owns the simulation clock and must remain open.
- Confirm the session is not paused at a survey checkpoint.
- Confirm the browser has not suspended the server tab.

### Old 140 x 140 session appears

- Select **Reset** once after connecting. Existing browser storage may contain an earlier session version.
- Use a new session ID for every independent test.

### Gemini returns an error

- Confirm the key is valid and restricted for the Gemini API.
- Confirm the model is available to the teammate's Google project.
- Check account quota and billing.
- The simulator will continue with deterministic dialogue if the API fails.

## Known Limitations

- The server browser tab is the authoritative clock; there is no scheduled backend simulation worker.
- The current Supabase policy is suitable only for non-identifiable pilot sessions.
- Model-generated language is intentionally constrained; models do not directly control physics.
- The first-person renderer is procedural Canvas, not the Unity WebGL build.
- The local Python static server cannot run Netlify Functions. Use Netlify Dev or a deployed Netlify site to test Gemini.

## Final Acceptance Checklist

- Automated checks pass.
- GitHub Actions passes.
- Netlify deployment succeeds.
- Supabase cross-device synchronization succeeds.
- UI reports Gemini as active.
- Helicopter refuses unknown fire locations.
- Drone does not reveal the full map early.
- Full drone sweep is not complete at 25 minutes.
- Mission ends at 30 minutes.
- Hidden route corruption uses an unscanned destination.
- The drone cannot reveal that destination until the participant requests a helicopter check.
- Participant recovery controls work.
- JSON and CSV exports contain expected records.

When all items pass, record the Git commit hash, Netlify deploy ID, Supabase project ID, browser versions, model name, and test session IDs used for the validation run.
