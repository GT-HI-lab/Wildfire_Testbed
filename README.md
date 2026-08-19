# CREW Wildfire Web Testbed

Browser-based human-AI wildfire teaming experiment with an experimenter server console and participant client.

## Interfaces

- `/server/`: experimenter map, study assignment, timer, diagnostics, and export.
- `/client/`: firefighter first-person view, controls, AI communication, and final in-game survey.

## Study Conditions

- Between subjects: transparency, explainability, or adaptability communication.
- High testbed: both AIs remain high reliability.
- Mixed testbed: four within-session phases, High/High, Low/High, High/Low, and Low/Low.

## Cross-Device Transport

Production uses strongly consistent Netlify Blobs by default. Supabase is optional. Local browser storage is used only during local development.

## AI

Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.6-flash` in Netlify. Provider and model details are hidden in the participant UI. Deterministic fallbacks preserve command and knowledge constraints.

## Development

```sh
npm install
npm run check
npm test
netlify dev
```

Open `http://localhost:8888/server/` and `http://localhost:8888/client/`.

See `EXPERIMENTER_MANUAL.md` for deployment and complete operating instructions. Configure final survey questions in `shared/survey-config.js`.
