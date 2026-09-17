import { questionsForCheckpoint } from "../shared/survey-config.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { advanceSimulation, applyParticipantAction, submitSurvey, COUNTERBALANCE_SEQUENCES } from "../shared/simulation.js";

// Real HTTP and Blob storage, with no external credentials or research data.
const env = { ...process.env, PORT: "0", WILDFIRE_SERVE_DIST: "true", PROLIFIC_TEST_MODE: "true", STUDY_ACCESS_SECRET: "http-test-secret", STUDY_ADMIN_KEY: "http-test-admin" };
for (const name of Object.keys(env)) {
  if (/^(SUPABASE_|GEMINI_|OPENAI_|AI_PROVIDER|PROLIFIC_API_TOKEN|PROLIFIC_STUDY_IDS|PROLIFIC_COMPLETION_CODES|PROLIFIC_REQUIRE_SECURE_URL)/.test(name)) delete env[name];
}
const server = spawn(process.execPath, ["scripts/dev-server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
server.stderr.on("data", (data) => { stderr += data; });
try {
  const base = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 15000);
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    server.stdout.on("data", (data) => {
      output += data;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  async function call(path, options = {}) {
    const response = await fetch(`${base}${path}`, options);
    const body = await response.json();
    return { status: response.status, body };
  }
  const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const admin = { "X-Admin-Key": env.STUDY_ADMIN_KEY };
  for (const path of ["/client/", "/client/app.js", "/client/styles.css", "/server/", "/server/app.js", "/server/styles.css", "/shared/simulation.js", "/shared/realtime.js", "/shared/map-renderer.js", "/shared/survey-config.js", "/shared/wildfire-field.svg"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
  for (const path of ["/.env.example", "/package.json", "/supabase/analytics-schema.sql", "/netlify/functions/lib/study-auth.mjs"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, `Private file ${path}`);
  }
  assert.equal((await call("/.netlify/functions/config")).body.STUDY_TEST_MODE, true);
  assert.equal((await call("/.netlify/functions/study-admin")).status, 401);
  const participant = "http-participant";
  async function enroll(wave) {
    return call("/.netlify/functions/study-enrollment", json({ prolificParticipantId: participant, studyId: `test-study-wave-${wave}`, submissionId: `http-submission-${wave}`, wave, entryUrl: `${base}/client/?wave=${wave}` }));
  }
  assert.equal((await enroll(2)).status, 409, "Cannot start at wave 2");
  const conditions = [];
  let sequence;
  let style;
  for (let wave = 1; wave <= 4; wave++) {
    const enrollment = await enroll(wave);
    assert.equal(enrollment.status, 200);
    const { gameSessionId, accessToken } = enrollment.body;
    assert.equal((await enroll(wave)).body.gameSessionId, gameSessionId, "Resume same session");
    const auth = { Authorization: `Bearer ${accessToken}` };
    const detectionPath = `/.netlify/functions/detection-events?sessionId=${gameSessionId}`;
    assert.equal((await call(detectionPath)).status, 401);
    const probe = { id: `probe-${wave}`, revision: 2, kind: "probe", status: "hit", probe_onset_ms: 1700000000000,
      response_ms: 1700000000500, rt_ms: 500, hit: true, miss: false, false_alarm: false,
      scenario_time_ms: 20000, lamp_off_ms: 1700000003000, interruption_reason: null };
    assert.equal((await call(detectionPath, json({ records: [probe] }, auth))).status, 200);
    assert.equal((await call(detectionPath, json({ records: [probe] }, auth))).status, 200);
    const logged = (await call(detectionPath, { headers: auth })).body.records;
    assert.equal(logged.length, 1); assert.equal(logged[0].rt_ms, 500);
    assert.equal((await call(detectionPath, json({records:[{...probe,rt_ms:5000}]},auth))).status,400);
    const sessionPath = `/.netlify/functions/session-state?sessionId=${gameSessionId}`;
    assert.equal((await call(sessionPath)).status, 401);
    let { body: { state } } = await call(sessionPath, { headers: auth });
    sequence ||= state.study.sequence;
    style ||= state.communicationStyle;
    assert.equal(state.study.sequence, sequence);
    assert.equal(state.communicationStyle, style);
    conditions.push(state.condition);
    const answers = () => Object.fromEntries(questionsForCheckpoint(state.survey.checkpoint).map((q) => [q.id, String(q.min)]));
    if (wave === 1) {
      assert.equal(state.survey.checkpoint, "baseline");
      submitSurvey(state, answers());
      const baselineSaved = await call(sessionPath, { ...json({ state }, auth), method: "PUT" });
      assert.equal(baselineSaved.status, 200);
      state = baselineSaved.body.state;
    } else assert.equal(state.survey.active, false, "Baseline not repeated in later waves");
    assert.equal((await call("/.netlify/functions/study-complete", json({ sessionId: gameSessionId }, auth))).status, 409);
    applyParticipantAction(state, { type: "bulldozer_move", dx: 4, dy: 0 });
    state.condition = "tampered";
    let saved = await call(sessionPath, { ...json({ state }, auth), method: "PUT" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.state.condition, COUNTERBALANCE_SEQUENCES[sequence][wave - 1]);
    state = (await call(sessionPath, { headers: auth })).body.state;
    assert.equal(state._syncRevision, saved.body.state._syncRevision, "Saved revision reloads");
    // Fast-forward the genuine clock path without waiting 30 minutes per wave.
    advanceSimulation(state, Date.now());
    advanceSimulation(state, state.mission.deadlineAt + 1000);
    assert.equal(state.survey.checkpoint, "midpoint");
    assert.equal(state.survey.trigger, "15_minute_fallback");
    assert.equal(state.mission.completed, false);
    submitSurvey(state, answers());
    saved = await call(sessionPath, { ...json({ state }, auth), method: "PUT" });
    assert.equal(saved.status, 200);
    state = saved.body.state;
    advanceSimulation(state, state.mission.deadlineAt + 1000);
    assert.equal(state.mission.completed, true);
    assert.equal(state.survey.active, true);
    assert.equal(state.survey.checkpoint, "final");
    submitSurvey(state, answers());
    saved = await call(sessionPath, { ...json({ state }, auth), method: "PUT" });
    assert.equal(saved.status, 200);
    const completed = await call("/.netlify/functions/study-complete", json({ sessionId: gameSessionId }, auth));
    assert.equal(completed.status, 200);
    assert.ok(completed.body.receiptId);
    assert.equal(completed.body.completionUrl, null, "No real Prolific redirect in test mode");
    const retry = await call("/.netlify/functions/study-complete", json({ sessionId: gameSessionId }, auth));
    assert.equal(retry.body.receiptId, completed.body.receiptId, "Retry preserves receipt");
  }
  assert.deepEqual(conditions, COUNTERBALANCE_SEQUENCES[sequence]);
  const dashboard = await call("/.netlify/functions/study-admin", { headers: admin });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.participantCount, 1);
  assert.equal((await call("/.netlify/functions/study-admin", json({ action: "sync_analytics" }, admin))).status, 409, "Missing Supabase is reported");
  console.log(`HTTP end-to-end passed: 11 assets, private-file blocking, four waves (${conditions.join(", ")}), save/reload, assignment enforcement, completion retry, admin access.`);
} finally {
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
}
