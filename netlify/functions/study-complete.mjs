import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { isParticipantAuthorized } from "../lib/study-auth.mjs";
import {
  completionCode,
  responseOptions,
  SESSION_STORE_NAME,
  STUDY_STORE_NAME
} from "../lib/study-config.mjs";
import {
  safeAnalyticsSync,
  syncCompletionAnalytics
} from "../lib/supabase-analytics.mjs";

export default async function studyComplete(request) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, responseOptions(405));
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, responseOptions(400));
  }
  const sessionId = String(body.sessionId || "");
  if (!sessionId || !isParticipantAuthorized(request.headers, sessionId)) {
    return Response.json({ error: "Session access is not authorized" }, responseOptions(401));
  }

  const studyStore = getStore({ name: STUDY_STORE_NAME, consistency: "strong" });
  const sessionStore = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
  const metadata = await studyStore.get(`study-session-${sessionId}`, { type: "json" });
  if (!metadata) return Response.json({ error: "Study session was not found" }, responseOptions(404));
  const state = await sessionStore.get(`session-${sessionId}`, { type: "json" });
  if (!state?.mission?.completed || !state?.survey?.completed) {
    return Response.json({ error: "The mission and final survey must be completed first" }, responseOptions(409));
  }

  try {
    const participant = await markWaveComplete(studyStore, metadata, state);
    const waveRecord = participant.waves[String(metadata.wave)];
    await safeAnalyticsSync("completion", () => syncCompletionAnalytics({
      participant,
      waveRecord,
      metadata,
      state
    }));
    const code = completionCode(metadata.wave);
    return Response.json({
      saved: true,
      receiptId: waveRecord.receiptId,
      completionUrl: code && process.env.PROLIFIC_TEST_MODE !== "true"
        ? `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(code)}`
        : null
    }, responseOptions());
  } catch (error) {
    console.error("Study completion failed", error);
    return Response.json({ error: "Completion could not be recorded; please retry" }, responseOptions(503));
  }
}

async function markWaveComplete(store, metadata, state) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const entry = await store.getWithMetadata(metadata.participantKey, { type: "json" });
    const participant = entry?.data;
    if (!participant) throw new Error("Participant record is missing");
    const existing = participant.waves[String(metadata.wave)];
    if (existing?.status === "completed") return participant;
    const now = Date.now();
    const next = {
      ...participant,
      waves: {
        ...participant.waves,
        [String(metadata.wave)]: {
          ...existing,
          status: "completed",
          completedAt: now,
          updatedAt: now,
          receiptId: randomUUID(),
          finalScore: state.metrics?.score ?? null,
          finalTick: state.tick,
          surveyResponseCount: Object.keys(state.survey?.responses || {}).length
        }
      },
      updatedAt: now
    };
    const result = await store.setJSON(metadata.participantKey, next, entry.etag
      ? { onlyIfMatch: entry.etag }
      : {});
    if (result.modified) return next;
  }
  throw new Error("Participant completion record is busy");
}

export { markWaveComplete };
