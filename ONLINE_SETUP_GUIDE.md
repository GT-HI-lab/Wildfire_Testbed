# CREW Wildfire: local setup and online deployment

Updated 15 September 2026. Start here when handing this project to a colleague.

## 1. What is ready, and what is still pending

The existing game platform has been tested locally: participant entry in test mode, gameplay, saved-state reload, four-wave sequencing, fixed assignment, completion receipts, and administrator access. The source package includes its browser assets, backend functions, helper modules, dependency lockfile, and Supabase SQL schema.

The supplied questionnaires are now implemented, including baseline, separate MDMT ratings for both AIs, four workload items, and midpoint/final pauses. Read `QUESTIONNAIRES.md` before deploying: the updated Supabase schema is required. The visual detection secondary task is implemented locally; read `SECONDARY_TASK.md` for its additional SQL migration, behavior and acceptance checks.

The present app uses **four separate Prolific waves**, one game per wave. It does not automatically run four games in one Prolific visit. Each game currently lasts 30 minutes and opens its final checkpoint when the timer expires. The app does not create, publish, schedule, or fund Prolific studies for you. Decide whether this four-wave arrangement matches your protocol before creating the production studies.

Your sequences are already implemented:

| Sequence | Game 1 | Game 2 | Game 3 | Game 4 |
|---|---|---|---|---|
| A | HH | HL | LH | LL |
| B | LL | HL | LH | HH |
| C | HH | LH | HL | LL |
| D | LL | LH | HL | HH |

The existing assignment also includes three between-participant communication styles, producing 12 assignment cells. Preserve this unless your protocol changes.

## 2. Understand the components

| Component | Purpose | Required setup |
|---|---|---|
| Netlify website | Serves `/client/` and `/server/` | Build and publish this source project |
| Netlify Functions | Enrollment, authorization, AI requests, saving, completion, administration | Deploy functions and configure runtime variables |
| Netlify Blobs | Authoritative participant assignments and game records | Provided through the deployed Netlify functions; no Supabase replacement needed |
| Supabase | Analysis tables and exports | Run the included SQL and supply server credentials |
| Prolific | Recruitment, identifiers, wave links and completion codes | Create four studies and configure their links |
| Gemini | Live AI communication | API key, working model access and generation quota |

The experimenter's computer and dashboard need not remain open. The participant's browser runs the simulation and must remain open during play. Netlify stores checkpoints; it does not continuously run the game when the participant closes the page. The stored mission deadline may cause elapsed time to catch up when the page is reopened.

## 3. Install and verify locally

1. Extract `CREW-Wildfire-Prolific-Verified-Source.zip` into a new folder. Keep the previous copy as a backup.
2. Open a terminal **inside the extracted `CREW-Wildfire-Prolific-Automated` folder**, the folder containing `package.json` and `netlify.toml`.
3. Install Node.js 24 from the [official Node.js site](https://nodejs.org/en/download). This version was used for local verification and is recorded in `.nvmrc`.
4. Install the pinned package manager if you do not have it:

```sh
npm install --global pnpm@11.19.0
```

5. Run these commands individually:

```sh
node --version
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
pnpm dev
```

Expected results: Node reports version 24; installation finishes; syntax checks pass; all ten test scripts pass; build reports 12 public files; the development server prints its local URL. Some tests deliberately simulate empty AI responses and quota errors, so error-looking log lines are expected if the final command exits successfully.

6. Open [the local participant preview](http://127.0.0.1:8888/client/?preview=1&wave=1). Use a desktop browser window at least 1000 × 600 pixels.
7. Move the bulldozer, watch the timer and reload. Saved state should return.
8. Open [the local dashboard](http://127.0.0.1:8888/server/) and enter `local-admin`. Inspect the participant and session.
9. Keep the server terminal open. Stop it with Control+C when finished. Local storage is temporary: restarting the server starts a fresh study. Browser reload and server restart are different tests.

No external credentials are required for this preview. Test mode permits deterministic AI fallback and disables the Prolific completion redirect. This does **not** test real Gemini, Prolific or Supabase access.

### Optional local testing with real Gemini and a test Supabase project

Create a file named `.env.local` in the project root using a text editor. It is ignored by Git. Include only the credentials you intend to test:

```dotenv
PROLIFIC_TEST_MODE=true
AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_REAL_KEY
GEMINI_MODEL=gemini-3.6-flash
SUPABASE_URL=https://YOUR_TEST_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_TEST_PROJECT_SERVER_SECRET
```

Run the Supabase schema first, as explained below. Then run `pnpm run dev:configured` instead of `pnpm dev`. This explicitly loads `.env.local`; plain `pnpm dev` does not load it. Omit Supabase variables if you do not want test records written externally. Do not copy the production Prolific study-ID mapping into local preview settings: preview uses synthetic study IDs.

## 4. Prepare test and production environments

Use a separate Netlify test site and a separate Supabase test project for synthetic testing. Preview enrollments affect assignment counts, so avoid mixing them into production. Do not use the production Supabase key in a publicly accessible test deployment.

You will need access to the intended Netlify project, Supabase project, Prolific researcher workspace, and Gemini API project. Keep credentials in those services or a password manager, not in source code or chat.

The current site is `https://gorgeous-profiterole-a6ede6.netlify.app`. On 15 September, its participant page and all three checked backend endpoints returned HTTP 401 with a Netlify login redirect. This must be resolved before external participants can use it; see Step 9.

## 5. Set up Supabase

1. Create or select the intended Supabase project. Use a fresh project for the first technical test.
2. Open **SQL Editor** and create a query.
3. Open `supabase/analytics-schema.sql` from this package. Paste the **entire file**, then run it. Do not run only the table declarations: functions, views and permissions are also required.
4. Confirm these six tables appear: `wildfire_participants`, `wildfire_waves`, `wildfire_session_summaries`, `wildfire_events`, `wildfire_messages`, `wildfire_survey_responses`.
5. Confirm the RPC functions `wildfire_record_enrollment` and `wildfire_ingest_session` exist.
6. Find the project URL and a server secret key in the project's API-key/Connect settings. Use an `sb_secret_...` key, not an anonymous or publishable key, project password, or Supabase management access token. Secret keys are for server components. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).
7. Store the URL and key for Netlify configuration in Step 7. The browser never needs a Supabase key or Supabase user login.

The schema enables row-level security and restricts access to the server role. Do not make the tables publicly writable to solve an authorization error. Diagnose the key and RPC configuration instead.

## 6. Prepare Prolific and Gemini

### Prolific

1. Create a longitudinal project and four draft studies, one per wave. Prolific supports this one-study-per-wave structure. [Longitudinal setup](https://docs.prolific.com/documentation/cookbooks/longitudinal-or-multi-part-studies).
2. Use these production base links if retaining your current Netlify site:

```text
https://gorgeous-profiterole-a6ede6.netlify.app/client/?wave=1
https://gorgeous-profiterole-a6ede6.netlify.app/client/?wave=2
https://gorgeous-profiterole-a6ede6.netlify.app/client/?wave=3
https://gorgeous-profiterole-a6ede6.netlify.app/client/?wave=4
```

3. Select Prolific's URL-parameter option and keep the names exactly `PROLIFIC_PID`, `STUDY_ID`, `SESSION_ID`. Let Prolific generate the placeholders; inspect the generated link to ensure it preserves `wave=N`. Do not use a literal example participant ID. [Prolific identifiers](https://researcher-help.prolific.com/en/articles/445133-what-are-prolific-ids-and-how-do-i-use-them).
4. Record each real study ID and its normal-completion code. The app expects a code value, not the entire completion URL.
5. Configure desktop participation and enough time for the 30-minute game plus instructions and the final checkpoint. Include time for the baseline and both questionnaires, and include the secondary-task instructions and practice.
6. Configure follow-up eligibility/scheduling in Prolific. The app blocks an incomplete previous wave, but it does not send invitations or manage recruitment.
7. Choose one authentication method:
   - **API verification:** supply `PROLIFIC_API_TOKEN` with access to the four studies and leave `PROLIFIC_REQUIRE_SECURE_URL=false`.
   - **Signed links:** enable Secure external URL for every wave and set `PROLIFIC_REQUIRE_SECURE_URL=true`. Fresh signed participant links must be tested end to end.
8. Do not publish the main study yet. A preview with synthetic identifiers cannot prove production authentication works.

### Gemini

Create an API key in the intended Google AI project and verify model access and available generation quota. The configured model is `gemini-3.6-flash`; change it only if necessary and validate its experimental behavior afterward. [Model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash).

## 7. Add Netlify environment variables

In the intended Netlify project, open **Project configuration → Environment variables**. Add the following. Give runtime variables **Functions** scope, or **All scopes**, and the appropriate deploy context. A test site's main deployment is still its **Production** context. Variables in `netlify.toml` are not a substitute for function runtime secrets. [Netlify function environment variables](https://docs.netlify.com/build/functions/environment-variables/).

| Variable | Test site | Production site |
|---|---|---|
| `AI_PROVIDER` | `gemini` | `gemini` |
| `GEMINI_API_KEY` | Real key if testing live AI; otherwise omit | Real key |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Validated model |
| `STUDY_ACCESS_SECRET` | Unique random secret | Different unique random secret |
| `STUDY_ADMIN_KEY` | Separate random dashboard key | Separate random dashboard key |
| `PROLIFIC_TEST_MODE` | `true` | `false` |
| `PROLIFIC_STUDY_IDS` | Omit for synthetic preview | Four real study IDs as JSON |
| `PROLIFIC_COMPLETION_CODES` | Omit for synthetic preview | Four completion codes as JSON |
| `PROLIFIC_API_TOKEN` | Omit for synthetic preview | Required if using API verification |
| `PROLIFIC_REQUIRE_SECURE_URL` | `false` | `true` only for the signed-link method |
| `SUPABASE_URL` | Test project's URL | Production project's URL |
| `SUPABASE_SECRET_KEY` | Test project's server key | Production project's server key |

Generate each of the two study secrets separately with `openssl rand -hex 32`, or your password manager. Save them securely. Keep `STUDY_ACCESS_SECRET` stable during collection: it affects participant hashes and access tokens. Changing it mid-study can break participant continuity.

Use valid JSON, with double quotes, for the mappings. Replace every placeholder:

```json
{"1":"REAL_STUDY_ID_1","2":"REAL_STUDY_ID_2","3":"REAL_STUDY_ID_3","4":"REAL_STUDY_ID_4"}
```

```json
{"1":"REAL_CODE_1","2":"REAL_CODE_2","3":"REAL_CODE_3","4":"REAL_CODE_4"}
```

Never upload `.env.local`. The example file contains placeholders only. Redeploy after changing variables.

## 8. Deploy the source, including functions

### Recommended: Git-connected deployment

1. Put the extracted project into a private Git repository. Include hidden configuration files, `pnpm-lock.yaml`, `netlify/functions/lib/`, and the SQL schema. Exclude `node_modules`, `.env.local`, `.netlify` and generated `dist`.
2. Connect that repository to the intended Netlify project. If the app is in a repository subfolder, set the **base directory** to that subfolder; otherwise use the repository root.
3. Confirm the settings below. They are already represented in `netlify.toml`:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | 24, from `.nvmrc` |

4. Deploy. The build log must show a successful dependency installation and build, followed by deployed functions. Netlify recognizes the pnpm lockfile and pinned package manager. [Dependency handling](https://docs.netlify.com/build/configure-builds/manage-dependencies/).
5. In the deployed Functions list, confirm `config`, `agent-ai`, `study-enrollment`, `session-state`, `study-complete`, and `study-admin` are present. Library files are helpers, not separate endpoints.
6. Do not drag just `dist` or the source ZIP into a static upload workflow: this app requires function bundling. [Function deployment](https://docs.netlify.com/build/functions/get-started/).

### Alternative: Netlify CLI

If you prefer not to use Git, install the Netlify CLI and run these from the project root:

```sh
npm install --global netlify-cli
netlify login
netlify link
netlify deploy --build
```

Choose the intended existing project when linking. The last command creates a draft deploy; test it with the appropriate draft-context variables. When ready to deliberately publish the configured production deployment:

```sh
netlify deploy --build --prod
```

Do not upload credentials or use a different site accidentally. Separate test sites are simpler than juggling draft-context credentials.

## 9. Resolve the current Netlify login gate

This is a settings change for the site owner to make when ready to expose the participant deployment.

1. Open the intended project in Netlify.
2. Find **Project visibility**. On current credit-based plans, set the participant production deployment to **Public**. On other plans, look under **Project configuration → Access & security → Visitor access → Password Protection** and ensure production does not require Netlify team login or a shared password.
3. Keep development previews restricted if desired. Exact options depend on the plan. [Netlify access protection](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/).
4. In a private browser window, open `/client/` and the config endpoint. Neither should ask for a Netlify login.

Public access exposes the game page. It does not remove the app's Prolific verification or administrator-key requirement. Do not remove those application controls. A bare production `/client/` URL can display a missing-study-link error; actual participants need the Prolific-generated wave link.

## 10. Check deployment reachability

From the local project folder, run:

```sh
pnpm run verify:site -- https://gorgeous-profiterole-a6ede6.netlify.app
```

This read-only script checks three browser resources and three function endpoints. For production, it expects all checks to pass. It intentionally fails when test mode is enabled.

You can also inspect these endpoints manually:

| Endpoint | Expected production result |
|---|---|
| `/.netlify/functions/config` | JSON: `AI_ENABLED`, `STUDY_CONFIGURED`, `ANALYTICS_CONFIGURED` are true; `STUDY_TEST_MODE` is false |
| `/.netlify/functions/study-enrollment` | JSON: `ok` and `configured` are true |
| `/.netlify/functions/session-state?health=1` | JSON: `ok` is true; backend is `netlify-blobs` |

These are preliminary checks. `ANALYTICS_CONFIGURED` checks variable presence, not database access. The storage health route reports its backend without doing a storage read/write. AI health checks model access, not a successful generation. Proceed to actual workflow tests.

## 11. Run the online acceptance test

First use a separate test site with `PROLIFIC_TEST_MODE=true`:

1. Open `/client/?preview=1&wave=1`. Complete the six baseline items and confirm the game loads.
2. Move, spray, use coordination controls and send chat. If using a real AI key, verify a successful request in function logs, since test mode can fall back.
3. Reload and check saved state. Briefly disconnect/reconnect and verify recovery without losing the last confirmed checkpoint.
4. Open `/server/`, enter the test administrator key, and verify the participant, assigned sequence and session.
5. Complete the midpoint questionnaire at the initial-fire threshold or 15-minute fallback; confirm the timer freezes and resumes after submission. Complete the game and submit the final checkpoint. Expect **Responses Saved** and a test receipt, with no Prolific redirect.
6. In the same browser tab, change to `?preview=1&wave=2`, then repeat through waves 3 and 4. Preview participant identity is stored in that tab's session storage. Confirm conditions follow the assigned sequence.
7. Try entering a later wave before completing its predecessor with a fresh test participant; it must be refused.
8. Check Supabase as described below, including **Sync Analytics** from the dashboard.

Next test the production path with a legitimate Prolific test/pilot submission and `PROLIFIC_TEST_MODE=false`. A generic researcher preview may not have a real verifiable submission; do not disable authentication to make synthetic IDs work. Verify that the actual link authenticates, AI responds, completion returns to the correct Prolific study, and its receipt appears in the dashboard and Supabase. Repeat the four-wave path with the same participant. Test the signed-link option separately if selecting it.

A main-study launch requires the secondary-task browser and live deployment acceptance checks first. A small technical pilot of the present platform is a separate decision.

## 12. Confirm records in Supabase

After an online test, run these read-only queries in the **test project's** SQL Editor:

```sql
select wave, status, reliability_code, receipt_id, survey_response_count
from public.wildfire_waves
order by enrolled_at desc
limit 20;

select wave, condition_code, tick, mission_completed, survey_completed
from public.wildfire_session_summaries
order by synced_at desc
limit 20;

select 'events' as record_type, count(*) from public.wildfire_events
union all
select 'messages', count(*) from public.wildfire_messages
union all
select 'survey_responses', count(*) from public.wildfire_survey_responses;
```

Expect four completed wave rows for a participant who finished all four games, with nonempty receipts, the correct condition order, and completed mission/survey flags. Events should be present; chat testing should add messages. **Expect 166 survey-response rows for a participant who completes all four games:** 6 baseline + 80 midpoint + 80 final. See `QUESTIONNAIRES.md` for the migration and detailed checks.

Use **Sync Analytics** in the administrator dashboard, then repeat it. Existing logical records should not duplicate. Inspect sync failures and function logs if data are missing. Backfill can recover retained session data; do not assume it can recover unlimited historical events after a long outage, because the live state caps its event/message history.

For routine export use the `*_deidentified` views; keep `wildfire_analysis_wave_summary_linkable` restricted for Prolific reconciliation. Review free-text messages before sharing exports: removing the dedicated Prolific ID field does not guarantee free text contains no identifiers.

## 13. Troubleshooting

| Symptom | What to check |
|---|---|
| HTTP 401 and Netlify login page | Step 9: project visibility/site protection |
| Function 404 | Correct project root and functions directory; deploy source with function bundling |
| Build fails or missing import | Extract complete ZIP; keep helper directories and lockfile; run clean installation |
| Study not configured | Both four-wave JSON maps, access secret, and one Prolific authentication method |
| Link rejected | Correct wave, exact study ID, genuine submission, token permissions or fresh signed URL |
| AI unavailable | Function-scoped key, model access, quota and provider logs; redeploy after changes |
| Dashboard unauthorized | Correct `STUDY_ADMIN_KEY` for this site and deploy context |
| Supabase configured but no rows | Entire SQL applied, correct project URL and server key, RPC logs; run Sync Analytics |
| Next wave refused | Previous wave needs mission completion, final checkpoint submission and saved receipt |
| No Prolific redirect | Test mode false, correct wave completion code, `study-complete` logs |
| Local port already in use | Stop the previous server, or use another PORT environment variable |
| Empty survey | Confirm updated assets deployed and test with a newly enrolled participant |

## 14. Launch and maintain

Before main recruitment, require a recorded pass for: public participant access; real Prolific verification; real AI generation; saved-state recovery; all four waves; correct completion redirect and receipt; real Supabase rows; export and backfill; the new questionnaire protocol; and the secondary-task protocol described in `SECONDARY_TASK.md`.

Preserve a known working source ZIP and deployment version. Pause new sessions through the dashboard before troubleshooting a major incident, and also manage recruitment availability in Prolific. The pause control gates enrollment requests, including re-entry through enrollment, while already connected games continue. Do not change the participant hashing secret or study mappings midway through collection without a migration plan.

After deployment changes, repeat the reachability check and a test participant flow. Monitor function errors, AI quota and actual analytics row growth. Avoid deploying experimental code during active sessions. Roll back a faulty Netlify deployment if needed, but remember rollback does not undo database changes or restore old environment-variable values.
