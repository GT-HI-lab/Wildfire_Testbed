# CREW Wildfire Human-AI Teaming Environment

This folder contains two connected web applications for the wildfire trust/distrust study:

- `server/`: experimenter console with full map, pause/resume, helicopter condition control, survey checkpoints, metrics, and event log.
- `client/`: participant firefighter interface with first-person view, drone minimap, firefighter controls, participant-directed bulldozer controls, and selectable Helicopter AI/Drone AI chat.

See `EXPERIMENTER_MANUAL.md` for the complete setup and session operating guide.

The environment mirrors the CREW Embodied structure: perception/detection, communication, action translation, and action execution are separate. The 30-minute mission uses a 240 x 240 map and a paced drone sweep that takes about 28 minutes. Drone observations, participant observations, helicopter knowledge, and server ground truth are stored separately.

The helicopter starts without fire or water coordinates. It can use a location only after the participant provides coordinates or shares confirmed Drone AI intelligence. During the hidden distrust manipulation, the helicopter is routed into an area outside the drone's scanned cells. Autonomous drone reconnaissance withholds that destination area until the participant asks the drone to locate or check the helicopter.

## Local Preview

From this folder:

```powershell
python -m http.server 8888
```

Open:

- Server console: `http://localhost:8888/server/`
- Participant client: `http://localhost:8888/client/`

Participant movement is relative to the firefighter's current facing direction. Use the on-screen turn/forward/back controls or `W`/`A`/`S`/`D` and the arrow keys. Held movement keys trigger only once per press. The firefighter can refill with the **Refill** control while within 9 map units of a lake.

Without Supabase keys, both apps use `localStorage` and `BroadcastChannel`, so they connect only when opened in the same browser profile. Cross-device sessions require Supabase, and both pages must display `Realtime connected` before testing from different locations.

The plain Python preview does not run Netlify Functions, so both agents use their deterministic fallback dialogue there. Use Netlify Dev or a Netlify deployment to exercise Gemini-backed dialogue.

## AI Provider Setup

Both Drone AI and Helicopter AI call the server-side `netlify/functions/agent-ai.mjs` function. Gemini and OpenAI are supported. API keys are never sent to the browser.

For local Netlify development:

1. Copy `.env.example` to `.env` inside `wildfire-web`.
2. Put the key on the `OPENAI_API_KEY` line:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your-real-gemini-key
GEMINI_MODEL=gemini-3.6-flash
```

3. Run the site with Netlify Dev from this directory.

For a deployed site, set `AI_PROVIDER`, `GEMINI_API_KEY`, and optional `GEMINI_MODEL` in Netlify under **Site configuration > Environment variables**. Set `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL` to use OpenAI instead. Never put either provider's key in `shared/env.js`; that file is public browser configuration.

## Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Copy your project URL and anon public key.
4. For local static testing, copy `shared/env.example.js` to `shared/env.js` and fill in:

```js
window.WILDFIRE_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY",
  QUALTRICS_SURVEY_URL: "https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER"
};
```

Do not commit `shared/env.js`.

If either deployed page says `Local only`, cross-device play is disabled. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the Netlify site, run `supabase/schema.sql` in the matching Supabase project, redeploy, and confirm both pages say `Realtime connected`.

The SQL policies are permissive for a pilot study. Before collecting real participant data, replace them with participant-code or authenticated-user policies.

## Netlify Setup

Use this folder as the Netlify base directory:

- Base directory: `wildfire-web`
- Publish directory: `.`
- Functions directory: `netlify/functions`

Add these environment variables in Netlify:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AI_PROVIDER` (`gemini` or `openai`)
- `GEMINI_API_KEY` for Gemini
- Optional: `GEMINI_MODEL` (defaults to `gemini-3.6-flash`)
- `QUALTRICS_SURVEY_URL` (replace the placeholder with the anonymous Qualtrics distribution link)
- `OPENAI_API_KEY` for the OpenAI alternative
- Optional: `OPENAI_MODEL` (defaults to `gpt-5.4-mini`)

Routes after deploy:

- `/server/` experimenter console
- `/client/` participant client

If the selected provider key is absent, both agents use deterministic built-in replies. When configured, Gemini or OpenAI generates operational dialogue while world physics, detections, knowledge boundaries, and executable commands remain constrained by the simulator.

The AI badge shows the provider used for each reply. `Gemini fallback` means a Gemini request failed or returned an overly short response; hover the badge for the diagnostic, then inspect the matching Netlify function log.

## GitHub Flow

1. Create a new GitHub repository or use a branch in this CREW repo.
2. Commit `wildfire-web`.
3. Connect the repository to Netlify.
4. Set the Netlify base directory to `wildfire-web`.
5. Deploy once for a combined server/client site, or deploy the same repo twice if you want separate Netlify URLs for experimenter and participant access.

## Study Notes

- The server owns the simulation clock. Keep the server console open during a session.
- The mission ends after 30:00. A new or upgraded environment should be started with **Reset** so it receives the 240 x 240 map and fresh knowledge state.
- Pause stops participant action. Selecting T1, T2, or T3 displays the configured external Qualtrics survey link in the client pause overlay.
- The condition selector changes only helicopter behavior; drone speed, route, scan frequency, accuracy, and confidence stay constant:
  - `High-High`: accurate helicopter movement.
  - `Mixed`: one recoverable hidden helicopter navigation failure after two completed sections.
  - `Low-Low`: consistently offset helicopter navigation from mission start.
- During a hidden Mixed-condition diversion, the drone does not automatically detect or reveal the helicopter's destination area. The participant must use `Drone: Locate Heli` or ask Drone AI to locate/check the helicopter.
- Behavioral metrics tracked in state include chat count, helicopter commands, detections, firefighter water drops, helicopter water transfers, bulldozer actions, recommendation acceptance, overrides, and score.
