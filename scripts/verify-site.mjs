// Read-only deployment check. Never creates participants or sends credentials.
const input = process.argv[2];
if (!input) throw new Error("Usage: npm run verify:site -- https://YOUR-SITE.netlify.app");
const origin = new URL(input).origin;
let failed = false;
const checks = [
  ["/client/", null],
  ["/client/app.js", null],
  ["/shared/simulation.js", null],
  ["/.netlify/functions/config", (data) => data.AI_ENABLED === true && data.STUDY_CONFIGURED === true && data.ANALYTICS_CONFIGURED === true && data.STUDY_TEST_MODE === false],
  ["/.netlify/functions/study-enrollment", (data) => data.ok === true && data.configured === true],
  ["/.netlify/functions/session-state?health=1", (data) => data.ok === true && data.backend === "netlify-blobs"]
];
for (const [path, validate] of checks) {
  try {
    const response = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    let ok = response.status === 200;
    let detail = `HTTP ${response.status}`;
    if (ok && validate) {
      if (!(response.headers.get("content-type") || "").includes("application/json")) {
        ok = false;
        detail += "; expected JSON, received a page (possibly login protection)";
      } else {
        const data = await response.json();
        ok = validate(data);
        detail += ok ? "; expected flags present" : "; production readiness flags not satisfied";
        if (path.endsWith("/config")) detail += `; AI=${data.AI_ENABLED}, study=${data.STUDY_CONFIGURED}, analytics=${data.ANALYTICS_CONFIGURED}, testMode=${data.STUDY_TEST_MODE}`;
      }
    }
    console.log(`${ok ? "PASS" : "FAIL"} ${path}: ${detail}`);
    if (!ok) failed = true;
  } catch (error) {
    failed = true;
    console.log(`FAIL ${path}: ${error.message}`);
  }
}
console.log("These are reachability/configuration checks only. A real Prolific entry, AI reply, completion and Supabase row verification are still required.");
process.exitCode = failed ? 1 : 0;
