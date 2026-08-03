# Wildfire Web Deployment

This deployment uses one GitHub repository, one Netlify site, and one Supabase project.

## 1. GitHub

Commit the complete `wildfire-web` directory and `.github/workflows/wildfire-web-checks.yml`.
The workflow runs the JavaScript syntax checks and both smoke tests on pushes and pull requests that affect the web environment.

Do not commit `.env` or `shared/env.js`. Both are excluded by `wildfire-web/.gitignore`.

## 2. Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste `supabase/schema.sql`, and run it once.
3. In **Project Settings > API**, copy the project URL and anon public key.
4. Keep the database password and service-role key private; this application does not need either value.

The supplied row-level security policies are intentionally permissive for coded pilot sessions. Before storing names, contact information, or other identifiable research data, replace them with authenticated or participant-code policies.

## 3. Netlify

1. Import the GitHub repository into Netlify.
2. Set **Base directory** to `wildfire-web`.
3. Leave **Build command** empty.
4. Set **Publish directory** to `.`.
5. Set **Functions directory** to `netlify/functions` if Netlify does not read it from `netlify.toml`.
6. Add these environment variables:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your Gemini API key
GEMINI_MODEL=gemini-3.6-flash
SUPABASE_URL=your Supabase project URL
SUPABASE_ANON_KEY=your Supabase anon public key
QUALTRICS_SURVEY_URL=https://your-organization.qualtrics.com/jfe/form/SV_yourSurveyId
```

7. Deploy the site.

`QUALTRICS_SURVEY_URL` is the place to insert the participant survey link. Use the anonymous Qualtrics distribution link. The client appends `session_id` and `checkpoint` query parameters when the participant opens it.

## 4. Verify

1. Open `/server/`, enter a unique session ID, and select **Connect**.
2. Select **Reset** once to create a fresh 240 x 240 mission.
3. Open `/client/` in another browser or device and join the same session ID.
4. Confirm that the countdown changes, participant movement appears on the server, and the client minimap remains partially hidden.
5. Confirm both pages read `Realtime connected`.
6. Confirm the AI status reads `Gemini gemini-3.6-flash`. If it reads `Deterministic fallback` or `Gemini fallback`, check the Netlify environment variables and function logs.
7. Select a survey checkpoint and confirm the client pause overlay displays an external-survey button. Until `QUALTRICS_SURVEY_URL` is configured, it uses `https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER`.

The server page must stay open because it owns the one-second simulation clock.
