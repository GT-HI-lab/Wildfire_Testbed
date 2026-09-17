import { questionsForCheckpoint, scoredResponse, DOES_NOT_FIT } from "../../../shared/survey-config.js";
import { createHash } from "node:crypto";

const ANALYTICS_TIMEOUT_MS = 8000;

export function analyticsConfigured() {
  return Boolean(process.env.SUPABASE_URL && analyticsKey());
}

export async function syncEnrollmentAnalytics({ participant, waveRecord, metadata, state }) {
  if (!analyticsConfigured()) return { skipped: true };
  const participantKey = participant?.participantHash || metadata?.participantHash;
  if (!participantKey || !waveRecord?.gameSessionId) throw new Error("Enrollment analytics is missing its participant or session key");

  await callAnalyticsRpc("wildfire_record_enrollment", {
    p_participant: participantRow(participant),
    p_wave: waveRow(participantKey, waveRecord, state),
    p_summary: sessionSummaryRow(metadata, state)
  });
  return { saved: true };
}

export async function syncSessionAnalytics({ metadata, state, events = [], messages = [] }) {
  if (!analyticsConfigured()) return { skipped: true };
  if (!metadata?.participantHash || !state?.id) throw new Error("Session analytics is missing study metadata");

  await callAnalyticsRpc("wildfire_ingest_session", {
    p_summary: sessionSummaryRow(metadata, state),
    p_events: events.map((event, index) => eventRow(metadata, state, event, index)),
    p_messages: messages.map((message, index) => messageRow(metadata, state, message, index)),
    p_survey_responses: surveyRows(metadata, state)
  });
  return { saved: true, events: events.length, messages: messages.length };
}

export async function syncCompletionAnalytics({ participant, waveRecord, metadata, state }) {
  if (!analyticsConfigured()) return { skipped: true };
  await syncEnrollmentAnalytics({ participant, waveRecord, metadata, state });
  await syncSessionAnalytics({ metadata, state, events: [], messages: [] });
  return { saved: true };
}

export async function safeAnalyticsSync(label, operation) {
  if (!analyticsConfigured()) return { skipped: true };
  try {
    return await operation();
  } catch (error) {
    console.error(`Supabase analytics sync failed (${label})`, error);
    return { saved: false, error: error.message || "Analytics sync failed" };
  }
}

export async function callAnalyticsRpc(functionName, parameters) {
  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = analyticsKey();
  if (!baseUrl || !key) return { skipped: true };
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  };
  // Legacy service-role keys are JWTs. New sb_secret keys authenticate through
  // the apikey header and must not be presented as bearer JWTs.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(parameters),
    signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS)
  });
  if (response.ok) return { saved: true };
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`Supabase RPC ${functionName} failed (${response.status}): ${detail}`);
}

function analyticsKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function participantRow(participant = {}) {
  return {
    participant_key: participant.participantHash,
    prolific_pid: participant.prolificParticipantId,
    communication_style: participant.assignment?.communicationStyle || null,
    counterbalance_sequence: participant.assignment?.sequence || null,
    assigned_at: timestamp(participant.createdAt),
    updated_at: timestamp(participant.updatedAt) || new Date().toISOString()
  };
}

function waveRow(participantKey, waveRecord = {}, state = {}) {
  return {
    game_session_id: waveRecord.gameSessionId,
    participant_key: participantKey,
    wave: waveRecord.wave,
    study_id: waveRecord.studyId || null,
    submission_id: waveRecord.submissionId || null,
    reliability_code: state.condition || state.reliabilityCondition?.code || null,
    status: waveRecord.status || "enrolled",
    enrolled_at: timestamp(waveRecord.enrolledAt),
    completed_at: timestamp(waveRecord.completedAt),
    receipt_id: waveRecord.receiptId || null,
    final_score: numberOrNull(waveRecord.finalScore),
    final_tick: numberOrNull(waveRecord.finalTick),
    survey_response_count: numberOrNull(waveRecord.surveyResponseCount),
    updated_at: timestamp(waveRecord.updatedAt) || new Date().toISOString()
  };
}

function sessionSummaryRow(metadata = {}, state = {}) {
  const assignment = metadata.assignment || {};
  return {
    game_session_id: state.id,
    participant_key: metadata.participantHash,
    wave: metadata.wave,
    communication_style: assignment.communicationStyle || state.communicationStyle || null,
    counterbalance_sequence: assignment.sequence || state.study?.sequence || null,
    condition_code: state.condition || state.reliabilityCondition?.code || null,
    helicopter_reliability: state.reliability?.helicopter || null,
    drone_reliability: state.reliability?.drone || null,
    session_status: state.mission?.completed ? "mission_completed" : state.status || "ready",
    session_revision: numberOrNull(state._syncRevision),
    tick: numberOrNull(state.tick) || 0,
    paused: Boolean(state.paused),
    mission_started_at: timestamp(state.mission?.startedAt),
    mission_elapsed_seconds: numberOrNull(state.mission?.elapsedSeconds),
    mission_remaining_seconds: numberOrNull(state.mission?.remainingSeconds),
    mission_completed: Boolean(state.mission?.completed),
    metrics: state.metrics || {},
    survey_completed: Boolean(state.survey?.completed),
    survey_completed_at: timestamp(state.survey?.completedAt),
    synced_at: new Date().toISOString()
  };
}

function eventRow(metadata, state, event = {}, index) {
  return {
    event_id: event.id || stableId("event", state.id, event, index),
    game_session_id: state.id,
    participant_key: metadata.participantHash,
    wave: metadata.wave,
    session_revision: numberOrNull(state._syncRevision),
    tick: numberOrNull(event.tick),
    event_type: event.eventType || event.type || "unknown",
    event_text: event.text || "",
    happened_at: timestamp(event.at) || new Date().toISOString(),
    body: event
  };
}

function messageRow(metadata, state, message = {}, index) {
  return {
    message_id: message.id || stableId("message", state.id, message, index),
    game_session_id: state.id,
    participant_key: metadata.participantHash,
    wave: metadata.wave,
    session_revision: numberOrNull(state._syncRevision),
    role: message.role || "unknown",
    author: message.author || "",
    message_text: message.text || "",
    happened_at: timestamp(message.at) || new Date().toISOString(),
    body: message
  };
}

function surveyRows(metadata, state) {
  if (state.survey?.version === 2) {
    return Object.values(state.survey.history || {}).flatMap((entry) =>
      questionsForCheckpoint(entry.checkpoint).map((question) => {
        const raw = entry.responses[question.id];
        const missing = raw === DOES_NOT_FIT;
        return {
          game_session_id: state.id, participant_key: metadata.participantHash, wave: metadata.wave,
          question_id: `${entry.checkpoint}:${question.id}`, item_id: question.id,
          checkpoint: entry.checkpoint, measure: question.measure, target: question.target,
          subscale: question.subscale || null, response_text: String(raw),
          response_numeric: missing ? null : Number(raw), scored_value: scoredResponse(question, raw),
          does_not_fit: missing, survey_version: 2, trigger_reason: entry.trigger,
          submitted_at: timestamp(entry.completedAt)
        };
      })
    );
  }
  if (!state.survey?.completed) return [];
  return Object.entries(state.survey.responses || {}).map(([questionId, value]) => ({
    game_session_id: state.id, participant_key: metadata.participantHash, wave: metadata.wave,
    question_id: questionId, response_text: String(value ?? ""),
    submitted_at: timestamp(state.survey.completedAt) || new Date().toISOString()
  }));
}

function stableId(kind, sessionId, value, index) {
  return createHash("sha256")
    .update(`${kind}:${sessionId}:${index}:${JSON.stringify(value)}`)
    .digest("hex");
}

function timestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function syncDetectionAnalytics(metadata, sessionId, records) {
  if (!records.length || !analyticsConfigured()) return { skipped: true };
  return callAnalyticsRpc("wildfire_ingest_detection", { p_records: records.map((r) => ({
    ...r, game_session_id: sessionId, participant_key: metadata.participantHash, wave: metadata.wave
  })) });
}
