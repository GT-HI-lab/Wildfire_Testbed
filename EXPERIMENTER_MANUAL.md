# CREW Wildfire Experimenter Manual

## 1. Purpose

This manual covers deployment, configuration, study preparation, live session operation, survey checkpoints, condition behavior, data export, and troubleshooting for the CREW Wildfire web testbed.

The system has two browser interfaces:

- `/server/` is the experimenter console. It owns the mission clock and simulation updates.
- `/client/` is the participant interface. It contains the firefighter view, minimap, controls, and AI communication panel.

For cross-device sessions, both interfaces must use the same deployed Netlify site, the same Supabase project, and the same session ID.

## 2. System Requirements

Prepare the following before deployment:

- A GitHub repository containing `wildfire-web`.
- A Netlify account and site.
- A Supabase project.
- A Gemini API key.
- A published Qualtrics survey with an anonymous distribution link.
- Current Chrome, Edge, Firefox, or Safari browsers on the experimenter and participant computers.

## 3. One-Time Deployment

### 3.1 Supabase

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run the complete contents of `supabase/schema.sql` once.
4. Open **Project Settings > API**.
5. Record the project URL and anon public key.
6. Do not expose the database password or service-role key.

The schema creates session, message, event, and survey-checkpoint tables and enables realtime updates.

### 3.2 Netlify

1. Import the GitHub repository into Netlify.
2. Set **Base directory** to `wildfire-web`.
3. Leave **Build command** empty.
4. Set **Publish directory** to `.`.
5. Confirm **Functions directory** is `netlify/functions`.
6. Open **Site configuration > Environment variables**.
7. Add the following variables:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your Gemini API key
GEMINI_MODEL=gemini-3.6-flash
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
QUALTRICS_SURVEY_URL=https://your-organization.qualtrics.com/jfe/form/SV_yourSurveyId
```

8. Trigger a new deployment after adding or changing variables.

### 3.3 Qualtrics Link Location

The experimenter inserts the survey link in the Netlify environment variable named:

```text
QUALTRICS_SURVEY_URL
```

Use the anonymous survey distribution URL supplied by Qualtrics. Do not use a Qualtrics editor or preview URL.

Until this variable is configured, the application uses:

```text
https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER
```

The server console displays **Survey link configured** when a non-placeholder URL is loaded. It displays **Placeholder survey link** otherwise.

When the participant opens the survey, the application adds these URL parameters:

```text
session_id=the current wildfire session ID
checkpoint=T1, T2, or T3
```

In Qualtrics, these may be defined as Embedded Data fields in the Survey Flow if the response dataset should store them.

## 4. Local Preview Versus Cross-Device Use

A local preview is suitable for interface testing on one computer. It is not sufficient for two computers at different locations unless both can reach the same host and Supabase is configured.

For a real cross-device session:

1. Open the deployed Netlify `/server/` URL on the experimenter computer.
2. Open the same deployment's `/client/` URL on the participant computer.
3. Confirm both pages display **Realtime connected**.
4. Use exactly the same session ID on both pages.

If either page displays **Local only**, cross-device synchronization is disabled. Check the Netlify Supabase variables, redeploy, and confirm that `supabase/schema.sql` was run in the same project.

## 5. Pre-Session Checklist

Complete this checklist before admitting the participant:

1. Confirm the latest Netlify deployment succeeded.
2. Open `/server/` and verify **Realtime connected**.
3. Verify the AI status displays **Gemini gemini-3.6-flash**.
4. Verify the survey status displays **Survey link configured**.
5. Choose a unique coded session ID that contains no participant name or email address.
6. Enter the session ID and select **Connect**.
7. Select **Reset** to create a fresh mission state.
8. Select the assigned helicopter condition.
9. Open `/client/` on the participant computer.
10. Enter the identical session ID and select **Join**.
11. Verify movement on the client appears on the server map.
12. Verify the participant and experimenter mission clocks match.
13. Send one test message to an AI and confirm a detailed response appears.
14. Remove the test session and use a new session ID for study data if the preflight test generated unwanted records.

## 6. Starting a Session

1. On the server, confirm the intended session ID and condition.
2. Select **Reset** only before the study begins. Reset replaces the current session state.
3. Confirm the participant has joined the same session.
4. Select **Resume** if the state is paused.
5. Keep the server tab open for the entire mission because it advances the simulation.

The mission lasts 30 minutes of active, unpaused time. Survey pauses shift the deadline so survey completion does not consume mission time.

## 7. Helicopter Conditions

The condition selector changes helicopter behavior only. Drone speed, patrol route, scan interval, detection accuracy, and confidence remain fixed across all conditions.

### High-High

- Helicopter commands and destinations are interpreted accurately.
- No hidden Mixed-condition diversion occurs.

### Mixed

- Helicopter behavior is accurate before the manipulation.
- After two fire sections are completed, one hidden helicopter route diversion can occur.
- The helicopter reports the intended assignment while traveling toward a different actual destination.
- Autonomous drone reconnaissance cannot reveal the diverted destination area before the participant requests a helicopter check.
- The participant can use **Drone: Locate Heli**, ask Drone AI to locate/check the helicopter, clarify the route in helicopter chat, or use **Reassign Heli**.

### Low-Low

- Helicopter movement commands are consistently offset from the requested destination from mission start.
- No delayed post-section trigger is required.
- Drone behavior remains identical to High-High and Mixed.

Do not change conditions during an active study session unless the protocol explicitly requires it. Condition changes are recorded in the event log.

## 8. Experimenter Console

### Session Controls

- **Connect** loads or creates the entered session ID.
- **Reset** creates a fresh 30-minute mission for that session ID.
- **Pause** stops mission advancement and disables participant actions.
- **Resume** continues a normal pause.
- **Export CSV** downloads analysis-friendly event rows.
- **Export JSON** downloads the complete state, messages, metrics, and event objects.

### Monitoring Areas

- **Mission remaining** shows active mission time.
- **Realtime status** confirms cross-device synchronization.
- **AI status** shows whether Gemini or deterministic fallback is responding.
- **Metrics** summarizes operational activity.
- **Agents** shows current coordinates and actions.
- **Experiment Debug** exposes condition and helicopter reported-versus-actual behavior for the experimenter only.
- **Event Log** shows recent participant, agent, pause, survey, and manipulation events.

The participant should not see the experimenter console because it exposes ground truth and hidden condition information.

## 9. Survey Checkpoint Procedure

Use T1, T2, and T3 according to the study protocol.

1. Select **Pause** on the server.
2. Confirm the server status reads **Paused** and the client displays the pause overlay.
3. Select **T1**, **T2**, or **T3** under **Survey Checkpoint**.
4. Confirm the client overlay changes to the selected checkpoint and displays **Open T1 Survey**, **Open T2 Survey**, or **Open T3 Survey**.
5. The participant selects the link and completes the survey in the new browser tab.
6. Verify survey submission using the study's Qualtrics procedure.
7. Select **End Survey & Resume** on the server.
8. Confirm the client survey overlay closes and the mission clock continues.

The application does not read Qualtrics completion status automatically. The experimenter controls when the checkpoint ends. Survey request and experimenter-cleared completion events are included in the wildfire event record.

Selecting a checkpoint also enforces pause state, but the recommended procedure is to select **Pause** first so the transition is visible and deliberate.

## 10. Participant Controls

The experimenter should provide only the instructions required by the approved study protocol.

### Firefighter

- Up arrow or `W`: move forward once.
- Down arrow or `S`: move backward once.
- Left arrow or `A`: turn left.
- Right arrow or `D`: turn right.
- **Spray**: use water against nearby fire.
- **Refill**: refill within 9 map units of a lake.
- **Cut**: create a nearby firefighter firebreak.

Holding a movement key does not create repeated high-speed movement. Each physical key press performs one movement or turn.

### Bulldozer

- `N`, `W`, `E`, and `S` move the bulldozer.
- **Firebreak** creates a bulldozer firebreak at its current location.

### AI Coordination

- The chat selector chooses Helicopter AI or Drone AI.
- **Drone: Locate Heli** requests visual verification of helicopter position and route.
- **Share Drone Intel** transfers confirmed drone observations to helicopter knowledge.
- **Reassign Heli** sends the helicopter to a confirmed fire coordinate.
- **Accept AI** and **Override** record participant responses to recommendations.

There are no in-app Trust, Neutral, or Distrust response buttons. Trust and distrust measurements are collected through the external Qualtrics survey.

## 11. AI Behavior and Knowledge Boundaries

The helicopter begins without ground-truth fire or water coordinates. It can learn coordinates only when the participant provides them or shares confirmed drone intelligence.

The drone reports only confirmed observations. During the Mixed-condition hidden diversion, it withholds autonomous discovery around the helicopter's actual destination until the participant explicitly requests a helicopter check.

When Gemini is unavailable, deterministic responses preserve simulation rules. A **Gemini fallback** or **Deterministic fallback** status should be documented in the session notes because dialogue quality may differ.

## 12. Ending and Exporting a Session

1. Pause the mission after the final task or allow the 30-minute timer to finish.
2. Complete the final external survey checkpoint if required.
3. Select **Export JSON** and retain the complete session record.
4. Select **Export CSV** for event-level analysis.
5. Record the session ID, assigned condition, Netlify deploy ID, model name, browser versions, and any deviations.
6. Close the participant page.
7. Close the server page only after exports and session notes are complete.

Use a new session ID for every participant. Reusing an ID may load or overwrite an earlier state.

## 13. Troubleshooting

### Different computers do not synchronize

- Confirm both pages use the same deployed Netlify site and identical session ID.
- Confirm both pages display **Realtime connected**.
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify.
- Verify `supabase/schema.sql` was run in that exact Supabase project.
- Redeploy after changing environment variables.

### Survey button shows the placeholder

- Set `QUALTRICS_SURVEY_URL` under Netlify environment variables.
- Use the Qualtrics anonymous distribution link.
- Redeploy the site.
- Reconnect or refresh both interfaces.
- Confirm the server displays **Survey link configured**.

### Survey link does not open

- Allow new tabs for the deployed site.
- Confirm the link begins with `https://`.
- Test the Qualtrics distribution URL directly.
- Check whether institutional network filtering blocks Qualtrics.

### Mission timer appears stopped

- Check whether the session is paused or a survey checkpoint is active.
- Keep the server console open.
- Confirm realtime status has not changed to an error.
- The clock catches up from its wall-clock deadline after short state-write delays.

### AI replies use fallback

- Verify `AI_PROVIDER=gemini`.
- Verify `GEMINI_API_KEY` and `GEMINI_MODEL` in Netlify.
- Redeploy after changes.
- Inspect Netlify function logs for `agent-ai` errors.

### Client communication panel is difficult to use

- Confirm the browser zoom is 100 percent.
- Refresh after deploying the latest client styles.
- On smaller screens, the context area and message history scroll independently while the composer remains available.

### Water will not refill

- Move the firefighter closer to a visible lake.
- Select **Refill** within 9 map units of the water source.
- Check the firefighter readout for the resulting status.

## 14. Data and Privacy Notes

- Use coded session IDs rather than names, emails, or student identifiers.
- The supplied Supabase policies are permissive for pilot testing.
- Replace them with authenticated or participant-code policies before collecting identifiable data.
- Gemini and Qualtrics are external services. Follow the approved consent, data-processing, and institutional review requirements.
- Do not place secret keys in browser code or committed files. Gemini keys remain in Netlify server-side environment variables.

## 15. Final Acceptance Check

Before data collection, verify all of the following:

- Netlify deployment succeeds.
- Supabase realtime synchronization works across two different computers.
- Server and client mission clocks match.
- Gemini produces multi-sentence replies for both AIs.
- Participant movement, turning, refill, spray, and chat work.
- The laptop communication panel keeps message history and the composer accessible.
- Drone patrol turns throughout the map and does not finish before 25 minutes.
- Drone behavior is identical in all helicopter conditions.
- Mixed-condition hidden destinations remain undiscovered until a participant drone-check request.
- T1, T2, and T3 pause the mission and show the external survey link.
- **End Survey & Resume** removes the link and continues the clock.
- JSON and CSV exports download successfully.
- The test session uses no real participant data.
