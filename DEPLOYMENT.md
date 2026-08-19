# Wildfire Web Deployment

1. Import this repository into Netlify.
2. Set publish directory to `.` and functions directory to `netlify/functions`.
3. Leave the build command empty.
4. Add `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL=gemini-3.6-flash`.
5. Deploy. Netlify installs `@netlify/blobs` and provisions the shared session store automatically.

Verify these URLs:

```text
https://YOUR-SITE.netlify.app/server/
https://YOUR-SITE.netlify.app/client/
https://YOUR-SITE.netlify.app/.netlify/functions/session-state?health=1
```

The health URL must return `{"ok":true,"backend":"netlify-blobs"}`. Join the same unique session ID on two devices and confirm **Cross-device connected** on both.

Supabase is optional. To use it, run `supabase/schema.sql` and add `SUPABASE_URL` plus `SUPABASE_ANON_KEY`; otherwise the zero-configuration Netlify shared backend is used.

Final survey questions belong in `shared/survey-config.js`. No external Qualtrics URL is used.
