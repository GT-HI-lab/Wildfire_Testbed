import { getStore } from "@netlify/blobs";
import { isAdminAuthorized } from "./lib/study-auth.mjs";
import {
  responseOptions,
  SESSION_STORE_NAME,
  STUDY_CELLS,
  STUDY_STORE_NAME
} from "./lib/study-config.mjs";
import {
  analyticsConfigured,
  safeAnalyticsSync,
  syncEnrollmentAnalytics,
  syncSessionAnalytics,
  syncDetectionAnalytics
} from "./lib/supabase-analytics.mjs";

const ANALYTICS_BACKFILL_BATCH_SIZE = 2;

export default async function studyAdmin(request) {
  if (!isAdminAuthorized(request.headers)) {
    return Response.json({ error: "Administrator access is not authorized" }, responseOptions(401));
  }
  const store = getStore({ name: STUDY_STORE_NAME, consistency: "strong" });
  if (request.method === "POST") return handleAdminAction(request, store);
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, responseOptions(405));

  const listing = await store.list({ prefix: "participant-" });
  const participants = (await Promise.all(
    listing.blobs.map((blob) => store.get(blob.key, { type: "json" }))
  )).filter(Boolean);
  const settings = await store.get("study-settings", { type: "json" }) || { enrollmentPaused: false };
  const cells = Object.fromEntries(STUDY_CELLS.map((cell) => [cell.id, {
    communicationStyle: cell.communicationStyle,
    sequence: cell.sequence,
    assigned: 0,
    completedWaves: [0, 0, 0, 0]
  }]));
  for (const participant of participants) {
    const cell = cells[participant.assignment?.id];
    if (!cell) continue;
    cell.assigned += 1;
    for (let wave = 1; wave <= 4; wave += 1) {
      if (participant.waves?.[String(wave)]?.status === "completed") cell.completedWaves[wave - 1] += 1;
    }
  }
  return Response.json({
    settings,
    analyticsConfigured: analyticsConfigured(),
    participantCount: participants.length,
    cells,
    participants: participants
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((participant) => ({
        prolificParticipantId: participant.prolificParticipantId,
        participantHash: participant.participantHash,
        assignment: participant.assignment,
        waves: participant.waves,
        updatedAt: participant.updatedAt
      }))
  }, responseOptions());
}

async function handleAdminAction(request, store) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, responseOptions(400));
  }
  if (body.action === "sync_analytics") return backfillAnalytics(store, body);
  if (!["pause", "resume"].includes(body.action)) {
    return Response.json({ error: "Action must be pause, resume, or sync_analytics" }, responseOptions(400));
  }
  const settings = {
    enrollmentPaused: body.action === "pause",
    pauseMessage: String(body.message || "New sessions are temporarily paused for maintenance").slice(0, 240),
    updatedAt: Date.now()
  };
  await store.setJSON("study-settings", settings);
  return Response.json({ settings }, responseOptions());
}

async function backfillAnalytics(studyStore, body) {
  if (!analyticsConfigured()) {
    return Response.json({ error: "Supabase analytics is not configured" }, responseOptions(409));
  }
  const offset = Math.max(0, Number.parseInt(body.offset, 10) || 0);
  const listing = await studyStore.list({ prefix: "participant-" });
  const selected = listing.blobs.slice(offset, offset + ANALYTICS_BACKFILL_BATCH_SIZE);
  const participants = (await Promise.all(
    selected.map((blob) => studyStore.get(blob.key, { type: "json" }))
  )).filter(Boolean);
  const sessionStore = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
  let sessionCount = 0;
  let failureCount = 0;

  for (const participant of participants) {
    for (const waveRecord of Object.values(participant.waves || {})) {
      const sessionId = waveRecord.gameSessionId;
      const metadata = await studyStore.get(`study-session-${sessionId}`, { type: "json" });
      const state = await sessionStore.get(`session-${sessionId}`, { type: "json" });
      if (!metadata || !state) {
        failureCount += 1;
        continue;
      }
      const enrollmentResult = await safeAnalyticsSync("admin enrollment backfill", () => syncEnrollmentAnalytics({
        participant,
        waveRecord,
        metadata,
        state
      }));
      const sessionResult = await safeAnalyticsSync("admin session backfill", () => syncSessionAnalytics({
        metadata,
        state,
        events: state.events || [],
        messages: state.messages || []
      }));
      const detectionRows = await sessionStore.get(`detection-${sessionId}`, { type: "json" }) || [];
      const detectionResult = await safeAnalyticsSync("detection backfill", () => syncDetectionAnalytics(metadata, sessionId, detectionRows));
      if (!enrollmentResult.saved || !sessionResult.saved || (detectionRows.length && !detectionResult.saved)) failureCount += 1;
      sessionCount += 1;
    }
  }

  const nextOffset = offset + selected.length;
  return Response.json({
    processedParticipants: selected.length,
    processedSessions: sessionCount,
    failures: failureCount,
    nextOffset,
    totalParticipants: listing.blobs.length,
    done: nextOffset >= listing.blobs.length
  }, responseOptions(failureCount ? 207 : 200));
}
