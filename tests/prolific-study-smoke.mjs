import { questionsForCheckpoint } from "../shared/survey-config.js";
import { openSurvey, submitCheckpoint } from "../shared/surveys.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import studyAdmin from "../netlify/functions/study-admin.mjs";
import studyComplete from "../netlify/functions/study-complete.mjs";
import studyEnrollment from "../netlify/functions/study-enrollment.mjs";
import sessionState from "../netlify/functions/session-state.mjs";

process.env.STUDY_ACCESS_SECRET = "automated-study-test-secret";
process.env.STUDY_ADMIN_KEY = "automated-study-admin";
process.env.PROLIFIC_TEST_MODE = "true";

const directory = await mkdtemp(join(tmpdir(), "wildfire-prolific-blobs-"));
const token = "local-prolific-token";
const siteID = "wildfire-prolific-test-site";
const blobs = new BlobsServer({ directory, port: 0, token });

try {
  const { address } = await blobs.start();
  setEnvironmentContext({ edgeURL: address, uncachedEdgeURL: address, token, siteID });

  const enrollments = [];
  for (let index = 0; index < 24; index += 1) {
    enrollments.push(await enroll(index, 1));
  }
  assert(enrollments.every((result) => result.response.status === 200), "all Wave 1 enrollments succeed");
  assert(enrollments.every((result) => !("sequence" in result.body) && !("communicationStyle" in result.body)), "assignment is not returned to the participant entry page");

  const dashboard = await adminGet();
  assert(dashboard.participantCount === 24, "administrator sees every enrolled participant");
  assert(Object.values(dashboard.cells).every((cell) => cell.assigned === 2), "24 participants balance exactly across 12 cells");

  const first = enrollments[0].body;
  const duplicate = await enroll(0, 1);
  assert(duplicate.body.gameSessionId === first.gameSessionId, "reopening a Prolific link resumes the same game");

  const sessionUrl = `http://localhost/.netlify/functions/session-state?sessionId=${first.gameSessionId}`;
  const unauthorized = await sessionState(new Request(sessionUrl));
  assert(unauthorized.status === 401, "assigned game state rejects unauthenticated access");
  const authorized = await sessionState(new Request(sessionUrl, { headers: auth(first.accessToken) }));
  assert(authorized.status === 200, "participant access token loads the assigned game state");
  const state = (await authorized.json()).state;
  for (const checkpoint of ["baseline", "midpoint", "final"]) {
    if (!state.survey.active) openSurvey(state, checkpoint, "test");
    submitCheckpoint(state, Object.fromEntries(questionsForCheckpoint(checkpoint).map((q) => [q.id, String(q.min)])));
  }
  state.mission.completed = true;
  const saved = await sessionState(new Request(sessionUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth(first.accessToken) },
    body: JSON.stringify({ state })
  }));
  assert(saved.status === 200, "completed game state saves with participant authorization");

  const completed = await studyComplete(new Request("http://localhost/.netlify/functions/study-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(first.accessToken) },
    body: JSON.stringify({ sessionId: first.gameSessionId })
  }));
  const completion = await completed.json();
  assert(completed.status === 200 && completion.receiptId, "completion creates a durable receipt");
  assert(completion.completionUrl === null, "test mode does not redirect into Prolific");

  const waveTwo = await enroll(0, 2);
  assert(waveTwo.response.status === 200, "completed participant can enter Wave 2");
  const earlyWaveTwo = await enroll(1, 2);
  assert(earlyWaveTwo.response.status === 409, "participant cannot skip an incomplete prior wave");

  await adminPost("pause");
  const pausedEnrollment = await enroll(90, 1);
  assert(pausedEnrollment.response.status === 503, "administrator pause blocks only new enrollment");
  await adminPost("resume");
  const resumedEnrollment = await enroll(90, 1);
  assert(resumedEnrollment.response.status === 200, "administrator can resume unattended enrollment");

  console.log(JSON.stringify({
    participants: dashboard.participantCount,
    cells: Object.keys(dashboard.cells).length,
    perCell: Object.values(dashboard.cells)[0].assigned,
    completionReceipt: completion.receiptId
  }, null, 2));
} finally {
  await blobs.stop();
  await rm(directory, { recursive: true, force: true });
  delete process.env.STUDY_ACCESS_SECRET;
  delete process.env.STUDY_ADMIN_KEY;
  delete process.env.PROLIFIC_TEST_MODE;
}

async function enroll(index, wave) {
  const response = await studyEnrollment(new Request("http://localhost/.netlify/functions/study-enrollment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prolificParticipantId: `participant-${String(index).padStart(3, "0")}`,
      studyId: `test-study-wave-${wave}`,
      submissionId: `submission-${String(index).padStart(3, "0")}-wave-${wave}`,
      wave,
      entryUrl: `http://localhost/client/?wave=${wave}`
    })
  }));
  return { response, body: await response.json() };
}

async function adminGet() {
  const response = await studyAdmin(new Request("http://localhost/.netlify/functions/study-admin", {
    headers: { "X-Admin-Key": process.env.STUDY_ADMIN_KEY }
  }));
  assert(response.status === 200, "administrator dashboard request succeeds");
  return response.json();
}

async function adminPost(action) {
  return studyAdmin(new Request("http://localhost/.netlify/functions/study-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": process.env.STUDY_ADMIN_KEY },
    body: JSON.stringify({ action })
  }));
}

function auth(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Prolific study smoke test failed: ${message}`);
}
