# CREW Wildfire Web Prototype

This folder contains two connected web applications for the wildfire trust/distrust study:

- `server/`: experimenter console with full map, pause/resume, reliability pairing, survey checkpoints, metrics, and event log.
- `client/`: participant firefighter interface with first-person view, drone minimap, action controls, and helicopter AI chat.

The prototype mirrors the edited CREW Embodied structure: perception/detection, communication, action translation, and action execution are separate. Chat messages to the helicopter are translated into structured commands, then applied to the shared simulation state so the helicopter can move, refill, deploy water, pick up, and drop off the firefighter.

## Local Preview

From this folder:

```powershell
python -m http.server 8888
```

Open:

- Server console: `http://localhost:8888/server/`
- Participant client: `http://localhost:8888/client/`

Without Supabase keys, both apps use `localStorage` and `BroadcastChannel`, so they connect when opened in the same browser profile.

## Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Copy your project URL and anon public key.
4. For local static testing, copy `shared/env.example.js` to `shared/env.js` and fill in:

```js
window.WILDFIRE_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-SUPABASE-ANON-KEY"
};
```

Do not commit `shared/env.js`.

The SQL policies are permissive for a pilot study. Before collecting real participant data, replace them with participant-code or authenticated-user policies.

## Netlify Setup

Use this folder as the Netlify base directory:

- Base directory: `wildfire-web`
- Publish directory: `.`
- Functions directory: `netlify/functions`

Add these environment variables in Netlify:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- Optional: `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL`, for example `gpt-4.1-mini`

Routes after deploy:

- `/server/` experimenter console
- `/client/` participant client

If `OPENAI_API_KEY` is absent, the helicopter uses the deterministic built-in agent. If it is present, the Netlify function asks OpenAI for the reply text while keeping command translation constrained to the allowed CREW helicopter action types.

## GitHub Flow

1. Create a new GitHub repository or use a branch in this CREW repo.
2. Commit `wildfire-web`.
3. Connect the repository to Netlify.
4. Set the Netlify base directory to `wildfire-web`.
5. Deploy once for a combined server/client site, or deploy the same repo twice if you want separate Netlify URLs for experimenter and participant access.

## Study Notes

- The server owns the simulation clock. Keep the server console open during a session.
- Pause stops participant action and displays the survey checkpoint overlay in the client.
- Reliability pairing controls helicopter/drone behavior:
  - `High-High`: accurate helicopter movement and drone detections.
  - `Mixed`: accurate drone detections, degraded helicopter interpretation.
  - `Low-Low`: degraded helicopter movement and noisier drone detections.
- Behavioral metrics tracked in state include chat count, helicopter commands, detections, water drops, recommendation acceptance, overrides, and score.
