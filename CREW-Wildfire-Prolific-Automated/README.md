# CREW Wildfire: Automated Prolific Edition

This is a separate unattended-study edition of the CREW Wildfire testbed. The earlier project at `/Users/shiwenzhou/Documents/GitHub/wildfire-web` is not modified by this edition.

## Deployment Shape

The experiment uses one participant website and one shared serverless backend, not 12 websites.

- `/client/`: the single Prolific participant entry and game interface.
- `/server/`: an optional administrator dashboard. It does not need to remain open.
- `netlify/functions/`: enrollment, assignment, session storage, AI, completion, and administration.
- Netlify Blobs: strongly consistent participant, condition, wave, and game-state storage.
- Supabase: optional server-side analysis warehouse with separate linkable and deidentified exports.

Netlify runs the backend functions on demand. No experimenter computer or always-on physical server is required.

## Experimental Assignment

Participants are assigned once across 12 cells:

- Communication style: transparency, explainability, or adaptability.
- Counterbalance sequence: A, B, C, or D.
- Reliability is within subjects across four complete games: HH, HL, LH, and LL.

Assignment is performed atomically on the backend and remains fixed across all waves. Participants cannot choose a condition by changing the URL.

## Automatic Flow

1. Prolific opens `/client/?wave=N` with `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID`.
2. The backend verifies the entry, assigns or resumes the participant, and creates the correct game.
3. Game state is checkpointed through authenticated serverless requests.
4. The in-game survey opens when the mission ends.
5. A completion receipt is stored before the participant is redirected to Prolific.

The production client refuses to start if the shared backend or Gemini is unavailable. Provider names, models, reliability conditions, and fallback status are not displayed in the participant interface.

## Analysis Data

Netlify Blobs remains the authoritative live-game store. When Supabase is configured, the backend also upserts normalized participant, wave, session-summary, event, message, and in-game survey tables. Retries do not duplicate rows.

Run `supabase/analytics-schema.sql` in a Supabase project, then set `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in Netlify. The administrator dashboard reports the connection and its **Sync Analytics** button backfills sessions that predate setup or were missed during a temporary outage.

Use `wildfire_analysis_wave_summary_deidentified` and the other `*_deidentified` views for normal analysis. Use `wildfire_analysis_wave_summary_linkable` only when reconciling records with Prolific.

## Development

```sh
pnpm install
pnpm run check
pnpm test
pnpm dev
```

The local server automatically enables test mode and uses the temporary dashboard key `local-admin`. Open:

```text
http://localhost:8888/client/?preview=1&wave=1
```

Do not enable test mode on the production deployment.

See `DEPLOYMENT.md` for deployment steps and `EXPERIMENTER_MANUAL.md` for the full operating and data-export guide. Add final survey questions in `shared/survey-config.js`.
