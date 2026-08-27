import assert from "node:assert/strict";
import {
  analyticsConfigured,
  syncEnrollmentAnalytics,
  syncSessionAnalytics
} from "../netlify/functions/lib/supabase-analytics.mjs";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  url: process.env.SUPABASE_URL,
  secret: process.env.SUPABASE_SECRET_KEY,
  legacy: process.env.SUPABASE_SERVICE_ROLE_KEY
};
const requests = [];

try {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test_server_key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return new Response(null, { status: 204 });
  };

  assert.equal(analyticsConfigured(), true);
  const participant = {
    participantHash: "hashed-participant-1",
    prolificParticipantId: "PROLIFIC-RAW-ID",
    assignment: { communicationStyle: "transparent", sequence: "A" },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000
  };
  const waveRecord = {
    gameSessionId: "wf-hashed-participant-1-g1",
    wave: 1,
    studyId: "study-1",
    submissionId: "submission-1",
    status: "enrolled",
    enrolledAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000
  };
  const metadata = {
    participantHash: participant.participantHash,
    wave: 1,
    assignment: participant.assignment
  };
  const state = {
    id: waveRecord.gameSessionId,
    condition: "HH",
    communicationStyle: "transparent",
    study: { sequence: "A" },
    reliability: { helicopter: "high", drone: "high" },
    status: "running",
    _syncRevision: 4,
    tick: 12,
    paused: false,
    mission: { startedAt: 1_700_000_000_000, elapsedSeconds: 12, remainingSeconds: 1788, completed: false },
    metrics: { score: 9 },
    survey: { completed: true, completedAt: 1_700_000_020_000, responses: { trust_1: "6" } }
  };
  const event = { id: "event-1", at: 1_700_000_010_000, tick: 10, type: "move", text: "Moved" };
  const message = { id: "message-1", at: 1_700_000_011_000, role: "participant", author: "Commander", text: "Scout 20, 30" };

  await syncEnrollmentAnalytics({ participant, waveRecord, metadata, state });
  await syncSessionAnalytics({ metadata, state, events: [event], messages: [message] });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /wildfire_record_enrollment$/);
  assert.match(requests[1].url, /wildfire_ingest_session$/);
  assert.equal(requests[0].body.p_participant.prolific_pid, "PROLIFIC-RAW-ID");
  assert.equal(requests[1].body.p_summary.participant_key, "hashed-participant-1");
  assert.equal(requests[1].body.p_events[0].event_id, "event-1");
  assert.equal(requests[1].body.p_events[0].session_revision, 4);
  assert.equal(requests[1].body.p_messages[0].message_text, "Scout 20, 30");
  assert.equal(requests[1].body.p_messages[0].session_revision, 4);
  assert.equal(requests[1].body.p_survey_responses[0].response_text, "6");
  assert.equal(JSON.stringify(requests[1].body).includes("PROLIFIC-RAW-ID"), false);
  assert.equal(requests[0].options.headers.apikey, "sb_secret_test_server_key");
  assert.equal("Authorization" in requests[0].options.headers, false);

  process.env.SUPABASE_SECRET_KEY = "legacy-service-role-jwt";
  requests.length = 0;
  await syncSessionAnalytics({ metadata, state, events: [], messages: [] });
  assert.equal(requests[0].options.headers.Authorization, "Bearer legacy-service-role-jwt");

  console.log("Supabase analytics smoke test passed");
} finally {
  globalThis.fetch = originalFetch;
  restoreEnvironment("SUPABASE_URL", originalEnvironment.url);
  restoreEnvironment("SUPABASE_SECRET_KEY", originalEnvironment.secret);
  restoreEnvironment("SUPABASE_SERVICE_ROLE_KEY", originalEnvironment.legacy);
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
