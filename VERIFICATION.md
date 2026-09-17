# Step 1 verification — 15 September 2026

## Verdict

The local application starts and its automated checks pass. The supplied live site, `https://gorgeous-profiterole-a6ede6.netlify.app`, returned HTTP 401 Netlify login redirects on 15 September 2026. Its Prolific–Netlify–Supabase integration remains **unverified**. This is not a production launch sign-off. Follow `ONLINE_SETUP_GUIDE.md` to configure and test the online deployment.

## Verified

- `npm run check`: syntax checks pass, including the previously omitted authentication/configuration helpers.
- `npm run build`: 11 public assets copied into `dist`; local browser dependencies resolve.
- `npm test`: all nine test scripts pass. These exercise simulation, AI success/failure with mocked provider responses, realtime behavior, concurrent updates, the local Netlify Blobs emulator, enrollment/completion, mocked Supabase RPC payloads, and production Prolific authentication with a mocked API.
- Local participant preview opens in the browser, the mission timer advances, a bulldozer movement updates coordinates, and reload preserves the saved movement and timer.
- The existing integration test enrolls 24 simulated participants evenly across 12 cells, resumes an enrollment, rejects unauthorized session access, records completion, allows the next wave after completion, and rejects an early next wave.
- All four counterbalance sequences match the requested A–D order.
- Local JavaScript import audit found no missing modules. The original ZIP includes `.env.example`, the Supabase schema, and all four backend helper modules. No absent reference file was recovered or invented.

- A fresh temporary copy installed from `pnpm-lock.yaml` without copied `node_modules`, then passed syntax checks, all nine test scripts and build using Node 24 and pnpm 11.19.0. Dependencies were available through the package-manager cache; installation did not rely on the old project dependency folder.
- The new HTTP end-to-end test serves the built assets through the actual local server, completes all four games using the simulation clock, checks assignment enforcement, rejects early completion, and verifies idempotent receipts and administrator authorization. External APIs are not contacted.
- `verify:site` correctly reports the supplied live site as failing: all six checked resources/endpoints return HTTP 401.

## Changes made

1. Added a build script that checks public asset references and creates a dedicated `dist` directory. Netlify now builds and publishes that directory instead of publishing the entire source tree.
2. Documented installing dependencies and deploying functions through Netlify Git builds or CLI. A static-only upload is insufficient for this application. See https://docs.netlify.com/build/functions/get-started/.
3. Production enrollment now requires Prolific API verification or required signed URLs; it no longer falls back to accepting identifier format alone. Signed tokens without a finite expiration are rejected.
4. Added authentication regression coverage and clarified the limits of configuration health flags.
5. Added the four-wave HTTP test, local configured startup, Node/package-manager pins, and a read-only deployment checker. Restricted the local static server to browser directories and ignored local environment files.
6. Added `ONLINE_SETUP_GUIDE.md` with the full installation and deployment walkthrough.

The new source ZIP excludes `node_modules`, generated build output, credentials, and macOS metadata. Extract it, install dependencies, and follow `DEPLOYMENT.md`. It is a source handoff package, not a static Netlify Drop upload.

## Remaining live checks

Resolve the Netlify visitor login gate on the participant deployment and configure credentials in Netlify. Do not paste secret keys into chat.

1. Check deployed functions and production configuration, with test mode disabled.
2. Run a genuine Prolific test entry and verify participant/submission authentication.
3. Send an actual AI chat request; the current model metadata health check does not prove generation quota.
4. Complete a test game and confirm its durable receipt and correct Prolific completion destination.
5. Confirm real rows in Supabase and exercise analytics retry/backfill. `ANALYTICS_CONFIGURED` only indicates environment variable presence. No real database writes or SQL execution were tested here.
6. Repeat across all four waves and confirm sequencing and reload behavior on the deployed site.

## Later steps

The midpoint freeze and supplied MDMT, workload and baseline questionnaires are now implemented as described in `QUESTIONNAIRES.md`. The visual detection secondary task is now implemented locally; see `SECONDARY_TASK.md`. The existing workflow uses four separate Prolific waves; whether all four games should instead run within one Prolific visit needs to be settled before changing that flow.


## Questionnaire update

The supplied questionnaire protocol is now implemented. All eleven test scripts and the 14-asset build pass. The four-wave HTTP test includes baseline once and midpoint/final questionnaires. Browser verification completed baseline, midpoint, and final with a durable test receipt. A local PGlite database test also verified upgrading the old SQL schema, repeatable migration, 166 distinct response rows, legacy preservation, missing values and reverse coding. See `QUESTIONNAIRES.md` for current protocol details and deployment requirements; the earlier blank-survey limitation below is superseded. Live service verification and complete browser acceptance testing remain outstanding; see `SECONDARY_TASK.md`.
