import { getStore } from "@netlify/blobs";
import { createInitialSession } from "../../shared/simulation.js";
import {
  isResumeAuthorized,
  participantHash,
  resumeCookie,
  sessionAccessToken,
  stableIndex
} from "../lib/study-auth.mjs";
import {
  expectedStudyId,
  isStudyConfigured,
  normalizeWave,
  responseOptions,
  SESSION_STORE_NAME,
  STUDY_CELLS,
  STUDY_STORE_NAME
} from "../lib/study-config.mjs";
import { verifyProlificEntry } from "../lib/prolific.mjs";
import {
  safeAnalyticsSync,
  syncEnrollmentAnalytics
} from "../lib/supabase-analytics.mjs";

const LEDGER_KEY = "allocation-ledger";
const SETTINGS_KEY = "study-settings";

export default async function studyEnrollment(request) {
  if (request.method === "GET") {
    return Response.json({ ok: true, configured: isStudyConfigured() }, responseOptions());
  }
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, responseOptions(405));
  if (!isStudyConfigured()) {
    return Response.json({ error: "The study deployment is not configured yet" }, responseOptions(503));
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, responseOptions(400));
  }

  const prolificParticipantId = String(body.prolificParticipantId || "").trim();
  const studyId = String(body.studyId || "").trim();
  const submissionId = String(body.submissionId || "").trim();
  const wave = normalizeWave(body.wave);
  if (!prolificParticipantId || !studyId || !submissionId || !wave) {
    return Response.json({ error: "The Prolific study link is missing required information" }, responseOptions(400));
  }
  const configuredStudyId = expectedStudyId(wave);
  if (configuredStudyId && configuredStudyId !== studyId) {
    return Response.json({ error: "This link does not belong to the expected study wave" }, responseOptions(403));
  }

  try {
    const hash = participantHash(prolificParticipantId);
    const resumeAuthorized = isResumeAuthorized(request.headers, hash, wave);
    const authenticity = resumeAuthorized
      ? { method: "resume_cookie" }
      : await verifyProlificEntry({
          prolificParticipantId,
          studyId,
          submissionId,
          prolificToken: String(body.prolificToken || ""),
          entryUrl: String(body.entryUrl || ""),
          requestOrigin: new URL(request.url).origin
        });
    const store = getStore({ name: STUDY_STORE_NAME, consistency: "strong" });
    const settings = await store.get(SETTINGS_KEY, { type: "json" });
    if (settings?.enrollmentPaused) {
      return Response.json({ error: settings.pauseMessage || "New sessions are temporarily paused" }, responseOptions(503));
    }

    const assignment = await assignStudyCell(store, hash);
    const participant = await enrollParticipant(store, {
      hash,
      prolificParticipantId,
      studyId,
      submissionId,
      wave,
      assignment,
      authenticity: authenticity.method
    });
    if (participant.error) return Response.json({ error: participant.error }, responseOptions(409));

    const waveRecord = participant.waves[String(wave)];
    const sessionMetadata = {
      participantKey: participantKey(hash),
      participantHash: hash,
      wave,
      studyId,
      submissionId,
      assignment,
      createdAt: waveRecord.enrolledAt
    };
    await store.setJSON(sessionMetadataKey(waveRecord.gameSessionId), sessionMetadata);
    const state = await createGameSession(waveRecord.gameSessionId, assignment, wave);
    await safeAnalyticsSync("enrollment", () => syncEnrollmentAnalytics({
      participant,
      waveRecord,
      metadata: sessionMetadata,
      state
    }));

    const options = responseOptions();
    options.headers["Set-Cookie"] = resumeCookie(hash, wave);
    return Response.json({
      gameSessionId: waveRecord.gameSessionId,
      accessToken: sessionAccessToken(waveRecord.gameSessionId),
      wave,
      status: waveRecord.status,
      resumed: waveRecord.enrolledAt !== waveRecord.updatedAt
    }, options);
  } catch (error) {
    console.error("Study enrollment failed", error);
    const status = /invalid|missing|match|expired|unexpected|signature|expected study/i.test(error.message) ? 403 : 503;
    return Response.json({ error: error.message || "Enrollment is temporarily unavailable" }, responseOptions(status));
  }
}

async function createGameSession(sessionId, assignment, wave) {
  const sessions = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
  const existing = await sessions.get(`session-${sessionId}`, { type: "json" });
  if (existing) return existing;
  const state = createInitialSession(sessionId, {
    sequence: assignment.sequence,
    gameNumber: wave,
    communicationStyle: assignment.communicationStyle
  });
  state.deployment = { edition: "prolific-automated", wave };
  state._syncRevision = 1;
  state.updatedAt = Date.now();
  await sessions.setJSON(`session-${sessionId}`, state, { onlyIfNew: true });
  return state;
}

async function assignStudyCell(store, hash) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entry = await store.getWithMetadata(LEDGER_KEY, { type: "json" });
    const ledger = entry?.data || { assignments: {}, counts: Object.fromEntries(STUDY_CELLS.map((cell) => [cell.id, 0])) };
    const assignedId = ledger.assignments?.[hash];
    if (assignedId) return STUDY_CELLS.find((cell) => cell.id === assignedId);

    const minimum = Math.min(...STUDY_CELLS.map((cell) => Number(ledger.counts?.[cell.id] || 0)));
    const candidates = STUDY_CELLS.filter((cell) => Number(ledger.counts?.[cell.id] || 0) === minimum);
    const selected = candidates[stableIndex(hash, candidates.length)];
    const next = {
      assignments: { ...(ledger.assignments || {}), [hash]: selected.id },
      counts: { ...(ledger.counts || {}), [selected.id]: Number(ledger.counts?.[selected.id] || 0) + 1 },
      updatedAt: Date.now()
    };
    const result = await store.setJSON(LEDGER_KEY, next, entry
      ? entry.etag ? { onlyIfMatch: entry.etag } : {}
      : { onlyIfNew: true });
    if (result.modified) return selected;
  }
  throw new Error("Condition assignment is busy; please try again");
}

async function enrollParticipant(store, details) {
  const key = participantKey(details.hash);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(key, { type: "json" });
    const current = entry?.data || {
      participantHash: details.hash,
      prolificParticipantId: details.prolificParticipantId,
      assignment: details.assignment,
      waves: {},
      createdAt: Date.now()
    };
    if (details.wave > 1 && current.waves[String(details.wave - 1)]?.status !== "completed") {
      return { error: `Wave ${details.wave - 1} must be completed before this wave can begin` };
    }

    const existing = current.waves[String(details.wave)];
    const now = Date.now();
    const waveRecord = existing
      ? {
          ...existing,
          studyId: details.studyId,
          submissionId: details.submissionId,
          submissionIds: [...new Set([...(existing.submissionIds || []), details.submissionId])],
          updatedAt: now
        }
      : {
          wave: details.wave,
          studyId: details.studyId,
          submissionId: details.submissionId,
          submissionIds: [details.submissionId],
          gameSessionId: `wf-${details.hash.slice(0, 20)}-g${details.wave}`,
          status: "enrolled",
          authenticity: details.authenticity,
          enrolledAt: now,
          updatedAt: now
        };
    const next = {
      ...current,
      assignment: details.assignment,
      waves: { ...current.waves, [String(details.wave)]: waveRecord },
      updatedAt: now
    };
    const result = await store.setJSON(key, next, entry
      ? entry.etag ? { onlyIfMatch: entry.etag } : {}
      : { onlyIfNew: true });
    if (result.modified) return next;
  }
  throw new Error("Participant enrollment is busy; please try again");
}

function participantKey(hash) {
  return `participant-${hash}`;
}

function sessionMetadataKey(sessionId) {
  return `study-session-${sessionId}`;
}

export { assignStudyCell, participantKey, sessionMetadataKey };
