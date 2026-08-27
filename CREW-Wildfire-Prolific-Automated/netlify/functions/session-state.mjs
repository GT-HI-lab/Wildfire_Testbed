import { getStore } from "@netlify/blobs";
import { reliabilityForStudy } from "../../shared/simulation.js";
import { isAdminAuthorized, isParticipantAuthorized } from "./lib/study-auth.mjs";
import { SESSION_STORE_NAME, STUDY_STORE_NAME } from "./lib/study-config.mjs";
import {
  safeAnalyticsSync,
  syncSessionAnalytics
} from "./lib/supabase-analytics.mjs";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export default async function sessionState(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("health") === "1") {
    return Response.json({ ok: true, backend: "netlify-blobs" }, responseOptions());
  }

  const sessionId = url.searchParams.get("sessionId") || "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return Response.json(
      { error: "Session ID must contain only letters, numbers, hyphens, or underscores" },
      responseOptions(400)
    );
  }

  if (!isParticipantAuthorized(request.headers, sessionId) && !isAdminAuthorized(request.headers)) {
    return Response.json({ error: "Session access is not authorized" }, responseOptions(401));
  }

  const sessions = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
  const studyStore = getStore({ name: STUDY_STORE_NAME, consistency: "strong" });
  const metadata = await studyStore.get(`study-session-${sessionId}`, { type: "json" });

  if (request.method === "GET") {
    const state = await sessions.get(sessionKey(sessionId), { type: "json" });
    return Response.json({ state }, responseOptions(state ? 200 : 404));
  }

  if (request.method === "PUT" || request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, responseOptions(400));
    }
    if (!body.state || body.state.id !== sessionId) {
      return Response.json({ error: "State and session ID do not match" }, responseOptions(400));
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const currentEntry = await sessions.getWithMetadata(sessionKey(sessionId), { type: "json" });
      const current = currentEntry?.data || null;
      const state = enforceStudyAssignment(mergeConcurrentState(current, body.state), metadata);
      const changedEvents = changedRecords(current?.events, state.events, eventSignature);
      const changedMessages = changedRecords(current?.messages, state.messages, messageSignature);
      state._syncRevision = Math.max(current?._syncRevision || 0, body.state._syncRevision || 0) + 1;
      state.updatedAt = Date.now();
      const writeCondition = currentEntry
        ? currentEntry.etag
          ? { onlyIfMatch: currentEntry.etag }
          : {}
        : { onlyIfNew: true };
      const result = await sessions.setJSON(sessionKey(sessionId), state, writeCondition);
      if (result.modified) {
        if (changedEvents.length || changedMessages.length || state.survey?.completed) {
          await safeAnalyticsSync("session update", () => syncSessionAnalytics({
            metadata,
            state,
            events: changedEvents,
            messages: changedMessages
          }));
        }
        return Response.json({ state }, responseOptions());
      }
    }
    return Response.json({ error: "Concurrent session update; retry the action" }, responseOptions(409));
  }

  return Response.json({ error: "Method not allowed" }, responseOptions(405));
}

function enforceStudyAssignment(state, metadata) {
  if (!metadata?.assignment) return state;
  const configuration = reliabilityForStudy(metadata.assignment.sequence, metadata.wave);
  state.study = { sequence: configuration.sequence, gameNumber: configuration.gameNumber };
  state.communicationStyle = metadata.assignment.communicationStyle;
  state.condition = configuration.code;
  state.reliability = { helicopter: configuration.helicopter, drone: configuration.drone };
  state.reliabilityCondition = {
    code: configuration.code,
    label: configuration.label,
    helicopter: configuration.helicopter,
    drone: configuration.drone
  };
  state.deployment = {
    edition: "prolific-automated",
    wave: metadata.wave
  };
  return state;
}

function sessionKey(sessionId) {
  return `session-${sessionId}`;
}

export function mergeConcurrentState(current, incoming) {
  if (!current || (incoming._syncRevision || 0) >= (current._syncRevision || 0)) return { ...incoming };
  const merged = { ...current, ...incoming };
  merged.tick = Math.max(current.tick || 0, incoming.tick || 0);
  merged.mission = {
    ...(current.mission || {}),
    ...(incoming.mission || {}),
    elapsedSeconds: Math.max(current.mission?.elapsedSeconds || 0, incoming.mission?.elapsedSeconds || 0),
    remainingSeconds: Math.min(
      current.mission?.remainingSeconds ?? Infinity,
      incoming.mission?.remainingSeconds ?? Infinity
    ),
    completed: Boolean(current.mission?.completed || incoming.mission?.completed)
  };
  merged.messages = mergeById(current.messages, incoming.messages, 120);
  merged.events = mergeById(current.events, incoming.events, 500).sort((a, b) => b.at - a.at);
  merged.pendingEvents = mergeById(current.pendingEvents, incoming.pendingEvents, 200);
  merged.metrics = mergeNumericMaximums(current.metrics, incoming.metrics);
  merged.clientKnowledge = mergeKnowledge(current.clientKnowledge, incoming.clientKnowledge);
  merged.droneKnowledge = mergeKnowledge(current.droneKnowledge, incoming.droneKnowledge);
  merged.extinguished = mergeSpatial(current.extinguished, incoming.extinguished, 240);
  merged.firebreaks = mergeSpatial(current.firebreaks, incoming.firebreaks, 160);
  merged.clearedTerrain = [...new Set([...(current.clearedTerrain || []), ...(incoming.clearedTerrain || [])])].slice(-6000);
  merged.detected = mergeSpatial(current.detected, incoming.detected, 120);
  const extinguished = new Set(merged.extinguished.map(coordinateKey));
  merged.fires = mergeSpatial(current.fires, incoming.fires, 120).filter((fire) => !extinguished.has(coordinateKey(fire)));
  merged.paused = current.paused;
  merged.pauseReason = current.pauseReason;
  merged.status = current.status;
  merged.condition = current.condition;
  merged.study = current.study;
  merged.communicationStyle = current.communicationStyle;
  merged.reliability = current.reliability;
  merged.reliabilityCondition = current.reliabilityCondition;
  merged.survey = incoming.survey?.completed ? incoming.survey : current.survey;

  if (current.agents && incoming.agents) {
    merged.agents = { ...current.agents, ...incoming.agents };
    for (const movingAgent of ["drone", "helicopter"]) {
      if (!current.agents[movingAgent] || !incoming.agents[movingAgent]) continue;
      merged.agents[movingAgent] = {
        ...current.agents[movingAgent],
        ...incoming.agents[movingAgent],
        x: current.agents[movingAgent].x,
        y: current.agents[movingAgent].y
      };
    }
  }
  return merged;
}

function mergeById(first = [], second = [], limit = 200) {
  const values = new Map();
  for (const item of [...first, ...second]) values.set(item.id || JSON.stringify(item), item);
  return [...values.values()].slice(-limit);
}

function changedRecords(previous = [], next = [], signature = JSON.stringify) {
  const known = new Map(previous.map((item) => [item.id || JSON.stringify(item), signature(item)]));
  return next.filter((item) => known.get(item.id || JSON.stringify(item)) !== signature(item));
}

function eventSignature(event = {}) {
  return JSON.stringify(event);
}

function messageSignature(message = {}) {
  return `${message.role || ""}:${message.author || ""}:${message.text || ""}:${message.at || ""}`;
}

function mergeNumericMaximums(first = {}, second = {}) {
  const merged = { ...first, ...second };
  for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) {
    if (typeof first[key] === "number" && typeof second[key] === "number") {
      merged[key] = Math.max(first[key], second[key]);
    }
  }
  return merged;
}

function mergeKnowledge(first = {}, second = {}) {
  return {
    ...first,
    ...second,
    discoveredCells: [...new Set([...(first.discoveredCells || []), ...(second.discoveredCells || [])])],
    detections: mergeById(first.detections, second.detections, 120),
    lastDroneDetections: mergeById(first.lastDroneDetections, second.lastDroneDetections, 12)
  };
}

function mergeSpatial(first = [], second = [], limit = 200) {
  const values = new Map();
  for (const item of [...first, ...second]) values.set(spatialKey(item), item);
  return [...values.values()].slice(-limit);
}

function spatialKey(item = {}) {
  return `${coordinateKey(item)},${item.kind || item.section || "point"}`;
}

function coordinateKey(item = {}) {
  return `${Math.round(item.x || 0)},${Math.round(item.y || 0)}`;
}

function responseOptions(status = 200) {
  return {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" }
  };
}
