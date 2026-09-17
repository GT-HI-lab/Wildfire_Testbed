import assert from "node:assert/strict";
import { verifyProlificEntry } from "../netlify/functions/lib/prolific.mjs";
import { isStudyConfigured } from "../netlify/functions/lib/study-config.mjs";

const names = ["PROLIFIC_TEST_MODE", "PROLIFIC_API_TOKEN", "PROLIFIC_REQUIRE_SECURE_URL", "STUDY_ACCESS_SECRET", "PROLIFIC_STUDY_IDS", "PROLIFIC_COMPLETION_CODES"];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const entry = {
  prolificParticipantId: "a".repeat(24), studyId: "b".repeat(24), submissionId: "c".repeat(24),
  entryUrl: "https://example.com/client/?wave=1", requestOrigin: "https://example.com"
};
try {
  for (const name of names) delete process.env[name];
  process.env.STUDY_ACCESS_SECRET = "test-secret";
  process.env.PROLIFIC_STUDY_IDS = JSON.stringify({ 1: entry.studyId, 2: entry.studyId, 3: entry.studyId, 4: entry.studyId });
  process.env.PROLIFIC_COMPLETION_CODES = JSON.stringify({ 1: "one", 2: "two", 3: "three", 4: "four" });
  assert.equal(isStudyConfigured(), false);
  await assert.rejects(verifyProlificEntry(entry), /verification is not configured/);
  process.env.PROLIFIC_API_TOKEN = "test-token";
  assert.equal(isStudyConfigured(), true);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `https://api.prolific.com/api/v1/submissions/${entry.submissionId}/`);
    assert.equal(options.headers.Authorization, "Token test-token");
    return Response.json({ participant: entry.prolificParticipantId, study_id: entry.studyId });
  };
  assert.deepEqual(await verifyProlificEntry(entry), { method: "submission_api" });
  globalThis.fetch = async () => Response.json({ participant: "wrong", study_id: entry.studyId });
  await assert.rejects(verifyProlificEntry(entry), /does not match/);
  globalThis.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(verifyProlificEntry(entry), /could not verify/);
  delete process.env.PROLIFIC_API_TOKEN;
  process.env.PROLIFIC_REQUIRE_SECURE_URL = "true";
  assert.equal(isStudyConfigured(), true);
  await assert.rejects(verifyProlificEntry(entry), /missing or expired/);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "RS256", kid: "test" })}.${encode({ iss: "https://www.prolific.com" })}.signature`;
  await assert.rejects(verifyProlificEntry({ ...entry, prolificToken: token }), /expired/);
  process.env.PROLIFIC_TEST_MODE = "true";
  assert.deepEqual(await verifyProlificEntry(entry), { method: "test_mode" });
  console.log("Prolific production authentication smoke test passed (mocked API).");
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
