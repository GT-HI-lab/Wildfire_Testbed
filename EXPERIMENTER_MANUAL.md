# CREW Wildfire Experimenter Manual

## 1. System Overview

The testbed has two browser interfaces on one Netlify deployment:

- `/server/` is the experimenter console with the full map, timer, study controls, diagnostics, and exports.
- `/client/` is the participant interface with the firefighter view, movement controls, minimap, and AI chat.

The two pages synchronize through a shared backend. The built-in production backend is Netlify Blobs. Supabase remains supported and takes priority when its variables are configured. Browser local storage is used only for local development and cannot connect two computers.

## 2. Study Design

The implemented design is 3 communication styles between subjects by 4 reliability phases within a Mixed session.

### Between-subject communication style

Assign one style before resetting a participant session:

- **Transparency**: the AIs state what they know, what they are doing, the target, confidence, and limitations.
- **Explainability**: the AIs provide the transparent information plus causal reasons, evidence, and dependencies.
- **Adaptability**: the AIs provide detail when time allows and shorten communication to urgent action and risk during the final five minutes.

Do not change communication style during a participant session.

### Testbeds

- **High**: helicopter and drone remain high reliability for all 30 minutes.
- **Mixed**: four 7.5-minute phases run automatically.

Mixed phases:

| Phase | Active time | Helicopter | Drone |
|---|---:|---|---|
| R1 | 00:00-07:29 | High | High |
| R2 | 07:30-14:59 | Low | High |
| R3 | 15:00-22:29 | High | Low |
| R4 | 22:30-30:00 | Low | Low |

The helicopter remains the primary operational AI. Its low phase can route it inaccurately within drone-explored territory. During drone-low phases, reconnaissance scans are less frequent and below-confidence observations are not shared as confirmed intelligence.

## 3. One-Time Deployment

1. Import this GitHub repository into Netlify.
2. Leave the base directory empty when this repository is the site root.
3. Leave the build command empty.
4. Set the publish directory to `.`.
5. Confirm the functions directory is `netlify/functions`.
6. Deploy.

Netlify automatically installs `@netlify/blobs` and provisions the site-wide shared store. Supabase is no longer required for cross-computer operation.

### Gemini configuration

In **Netlify > Project configuration > Environment variables**, add:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your-real-key
GEMINI_MODEL=gemini-3.6-flash
```

Redeploy after changing variables. The participant interface intentionally says only **AI online** or **AI fallback**; it does not display the provider or model.

### Optional Supabase transport

To use Supabase instead of Netlify Blobs:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in its SQL editor.
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Netlify.
4. Redeploy.

Never expose a Supabase service-role key or Gemini key in browser code.

## 4. Cross-Computer Setup

Both computers must open pages from the same deployed Netlify domain. Do not run one computer from `localhost` and the other from the deployed site.

Example:

```text
Experimenter: https://YOUR-SITE.netlify.app/server/
Participant:  https://YOUR-SITE.netlify.app/client/
```

Condition-specific entry points are also available:

```text
High:  /high/server and /high/client
Mixed: /mixed/server and /mixed/client
```

1. Enter the same coded session ID on both computers.
2. Select **Connect** on the server.
3. Select **Join** on the client.
4. Confirm both pages display **Cross-device connected**.
5. Move once on the client and verify the firefighter moves on the server map within about one second.

The status tooltip identifies either `Supabase connected` or `Netlify shared session connected`. If a deployed page says **Cross-device unavailable**, the `session-state` Netlify Function did not deploy or cannot be reached.

## 5. Pre-Session Checklist

1. Confirm the latest Netlify deployment is published successfully.
2. Open server and client URLs on the two study computers.
3. Confirm **Cross-device connected** on both.
4. Confirm **AI online** on the client and server.
5. Choose a unique coded session ID containing only letters, numbers, hyphens, or underscores.
6. Select the assigned **High** or **Mixed** testbed.
7. Select the assigned communication style.
8. Select **Reset** to create a fresh state using those assignments.
9. Join that same ID from the participant computer.
10. Test one movement press and one AI message.
11. Use a new session ID for real data if the preflight produced unwanted records.

## 6. Running a Session

- **Connect** loads an existing session or creates a new one.
- **Reset** replaces the current session state using the selected testbed and communication style.
- **Pause** stops active mission time and participant actions.
- **Resume** continues the mission.
- **Export CSV** downloads event-level data.
- **Export JSON** downloads the complete state, messages, survey responses, and events.

The mission uses a wall-clock deadline. Either active page can advance stale simulation state, so background-tab throttling does not pause mission time. Keep the experimenter console open for monitoring.

Do not switch testbed or communication style after the session begins. Changes are logged, but they would compromise condition assignment.

## 7. Participant Controls

### Firefighter movement

- `W` or Up Arrow: one 1.25-unit forward step.
- `S` or Down Arrow: one 0.75-unit backward step.
- `A` or Left Arrow: turn left.
- `D` or Right Arrow: turn right.
- Holding a key or on-screen arrow does not repeat movement.
- Each step consumes stamina; stamina recovers with mission time.

### Trees and fire

- Forest and dense-tree cells block the firefighter.
- Attempting the blocked step selects the tree and displays cut progress.
- Select **Cut Tree** three times to clear that obstacle, then step through.
- **Spray** uses one water unit on nearby fire.
- **Refill** works only near a lake.

### Team controls

- Select Helicopter AI or Drone AI before sending chat.
- **Drone: Locate Heli** temporarily diverts the drone to verify the helicopter.
- **Share Drone Intel** gives confirmed drone coordinates to the helicopter.
- **Reassign Heli** assigns a confirmed fire coordinate.
- The helicopter can move only to cells previously explored by the drone.

The drone follows a multi-row serpentine patrol with horizontal, vertical, and diagonal variation. It does not automatically inspect the helicopter unless the participant requests it.

## 8. AI Communication

Both AIs use Gemini when the server-side key is configured. The simulation parses and enforces commands deterministically, so an LLM cannot bypass map knowledge, reliability, or drone-exploration rules.

The AIs can communicate with the participant and exchange operational messages with each other. When the drone confirms new fire or water intelligence, it shares the coordinate with the helicopter; the helicopter acknowledges receipt while waiting for participant assignment.

If Gemini fails or returns an overly short response, the application uses a multi-sentence deterministic response. Record **AI fallback** as a session deviation if it persists.

## 9. In-Game Final Survey

The survey opens automatically inside the participant interface when the 30-minute mission ends. No Qualtrics page, external tab, or separate survey computer is required.

Survey questions are intentionally blank. Insert them in:

```text
shared/survey-config.js
```

Supported question types are `scale`, `text`, and `choice`. Examples:

```js
export const SURVEY_QUESTIONS = [
  { id: "trust", label: "I trusted the AI team.", type: "scale", min: 1, max: 7 },
  { id: "reason", label: "Why?", type: "text" },
  { id: "style", label: "The communication was:", type: "choice", options: ["Too little", "Appropriate", "Too much"] }
];
```

After editing, commit and redeploy. Submitted responses are stored in `state.survey.responses` and included in **Export JSON**. The event log records survey opening and submission.

## 10. Data Export

At session end:

1. Confirm the server says **Final survey submitted**.
2. Select **Export JSON** for the canonical complete record.
3. Select **Export CSV** for event-level analysis.
4. Record session ID, testbed, communication style, deployment ID, browsers, and deviations.
5. Use a new session ID for the next participant.

JSON includes reliability phase, agent positions, reported and actual helicopter targets, detections, messages, stamina, tree cuts, survey responses, metrics, and events.

## 11. Troubleshooting

### Computers do not synchronize

1. Confirm both URLs use the identical Netlify domain and session ID.
2. Open `https://YOUR-SITE.netlify.app/.netlify/functions/session-state?health=1`.
3. A working deployment returns `{"ok":true,"backend":"netlify-blobs"}`.
4. If it returns 404/500, inspect the Netlify function deploy log and confirm `@netlify/blobs` installed.
5. Redeploy after checking that `netlify/functions/session-state.mjs` is present.

### AI fallback or short responses

1. Confirm the Netlify variables `AI_PROVIDER`, `GEMINI_API_KEY`, and `GEMINI_MODEL`.
2. Redeploy after changing them.
3. Check the `agent-ai` function log for quota, model, or authentication errors.
4. Never put the Gemini key in `shared/env.js`.

### Laptop communication panel is clipped

1. Use browser zoom at 100%.
2. Reload the current deployment rather than a cached older deploy.
3. The client switches to a vertical layout at 940px and reserves at least 300px for messages.

### Mission appears paused

1. Check the server status for an intentional experimenter pause.
2. Confirm at least one page remains connected.
3. Reload and reconnect the same session ID; wall-clock catch-up resumes automatically.

## 12. Privacy and Safety

- Use coded IDs, not names or email addresses.
- Treat exported chat and survey text as research data.
- Store exports according to the approved protocol.
- The participant must not see the experimenter console because it exposes reliability phases and ground truth.
