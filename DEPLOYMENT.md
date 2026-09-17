# Automated Prolific Deployment

For the full numbered walkthrough, including the current Netlify login gate, see [ONLINE_SETUP_GUIDE.md](ONLINE_SETUP_GUIDE.md).

## 1. Create an Independent Netlify Site

Deploy this folder as a new Netlify project. Do not point the deployment at the earlier `wildfire-web` folder.

- Base directory: repository root
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

Use a Git-connected Netlify build, or the Netlify CLI from this project root. Do not drag only the static folder or ZIP into Netlify Drop: this app also requires bundled serverless functions. See [Netlify function deployment](https://docs.netlify.com/build/functions/get-started/).

Use Node.js 22 or newer. For a local checkout:

```sh
npm install
npm run check
npm test
npm run build
```

With the Netlify CLI installed and signed in, use `netlify deploy --build` for a draft deployment and verify it before choosing to publish production. The generated `dist` contains only browser assets; backend sources and SQL remain in the project for function bundling and database setup. Keep `.env.example`, `netlify/functions/lib/`, and `supabase/analytics-schema.sql` when sharing the source project. Install dependencies after extracting; do not rely on copied `node_modules`.

## 2. Configure Environment Variables

Copy the names from `.env.example` into Netlify under **Project configuration > Environment variables**. Give them **Functions** or **All scopes** and include the Production deploy context.

Required for production:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
STUDY_ACCESS_SECRET=...
STUDY_ADMIN_KEY=...
PROLIFIC_STUDY_IDS={"1":"...","2":"...","3":"...","4":"..."}
PROLIFIC_COMPLETION_CODES={"1":"...","2":"...","3":"...","4":"..."}
PROLIFIC_TEST_MODE=false
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Generate `STUDY_ACCESS_SECRET` and `STUDY_ADMIN_KEY` separately:

```sh
openssl rand -hex 32
```

For participant authenticity, configure at least one of these:

- Recommended general option: `PROLIFIC_API_TOKEN`, which validates `SESSION_ID` against Prolific.
- Secure External URL option: enable it in Prolific and set `PROLIFIC_REQUIRE_SECURE_URL=true`. The backend validates Prolific's RS256 JWT and identifiers.

Production enrollment now refuses to start without one of these verification methods. Identifier formatting alone is not authentication.

Never place the Gemini key, Prolific API token, access secret, admin key, or Supabase Secret key in client-side JavaScript.

Redeploy after changing any variable.

## 3. Configure Supabase Analytics

1. Create one Supabase project for this experiment.
2. Open **SQL Editor**, paste all of `supabase/analytics-schema.sql`, and run it.
3. In **Project Settings > API**, copy the project URL and the server-side Secret key beginning with `sb_secret_`.
4. Add them to Netlify as `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, scoped to Functions or All scopes and Production.
5. Redeploy, then verify `ANALYTICS_CONFIGURED` is `true` at the config endpoint.

Do not use the publishable or anonymous key. The SQL enables row-level security, removes browser-role access, and grants the server role only. Netlify Blobs remains the live-game source of truth if Supabase is temporarily unavailable.

## 4. Create Four Prolific Waves

Create all four studies in one Prolific longitudinal project before publishing Wave 1. Use one URL per wave:

```text
https://YOUR-SITE.netlify.app/client/?wave=1
https://YOUR-SITE.netlify.app/client/?wave=2
https://YOUR-SITE.netlify.app/client/?wave=3
https://YOUR-SITE.netlify.app/client/?wave=4
```

For every wave, select Prolific's URL-parameter recording option so it appends:

```text
PROLIFIC_PID={{%PROLIFIC_PID%}}
STUDY_ID={{%STUDY_ID%}}
SESSION_ID={{%SESSION_ID%}}
```

Create a separate normal-completion code for each wave. Enter the four real study IDs and codes in `PROLIFIC_STUDY_IDS` and `PROLIFIC_COMPLETION_CODES`, then redeploy.

Set device compatibility to desktop. The game requires a browser viewport of at least 1000 by 600 pixels.

## 5. Verify the Deployment

Open these endpoints:

```text
https://YOUR-SITE.netlify.app/.netlify/functions/config
https://YOUR-SITE.netlify.app/.netlify/functions/study-enrollment
https://YOUR-SITE.netlify.app/.netlify/functions/session-state?health=1
```

Required results:

- Config: `AI_ENABLED`, `STUDY_CONFIGURED`, and `ANALYTICS_CONFIGURED` are all `true`.
- Enrollment health: `ok` and `configured` are both `true`.
- Session health: `ok` is `true` and backend is `netlify-blobs`.

`ANALYTICS_CONFIGURED` only checks that environment variables exist; it does not verify the database schema, credentials, or successful writes. Verify **Sync Analytics** and inspect actual test rows in Supabase. Likewise, the AI health check verifies model access, while a real chat request is needed to verify generation quota.

The participant page must never display a model name, local-only state, reliability code, or AI fallback label.

## 6. Test Before Launch

1. Use a separate Netlify test deployment with `PROLIFIC_TEST_MODE=true`.
2. Open `/client/?preview=1&wave=1` and complete the technical flow.
3. Run Prolific's end-to-end participant test for each wave.
4. Confirm the dashboard at `/server/` shows the participant and completion.
5. Select **Sync Analytics**, then confirm the participant appears in the Supabase deidentified summary view.
6. Confirm Wave 2 is refused before Wave 1 completes and accepted afterward.
7. Test reload, duplicate tab, offline recovery, Gemini outage, Supabase outage, and completion redirect.
8. Turn off test mode and run a small paid pilot before the main release.

## 7. Export Analysis Data

In Supabase, open **Table Editor**, choose a view, and select **Export data > CSV**. Recommended exports are:

- `wildfire_analysis_wave_summary_deidentified`: one row per full game.
- `wildfire_analysis_events_deidentified`: long behavioral event data.
- `wildfire_analysis_messages_deidentified`: long participant and AI chat data.
- `wildfire_analysis_survey_deidentified`: long in-game survey responses.
- `wildfire_analysis_wave_summary_linkable`: restricted Prolific reconciliation only.

The raw `wildfire_participants` table contains `PROLIFIC_PID`. Store that export separately from the deidentified analysis files.

## Survey Location

The final survey remains inside the game. Add or edit questions in:

```text
shared/survey-config.js
```

The questionnaire definitions now include the user-supplied measures. Follow `QUESTIONNAIRES.md` and run the updated SQL before deploying this edition.
