import { getStore } from "@netlify/blobs";

const STORE_NAME = "wildfire-shared-sessions-v1";
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

  const sessions = getStore({ name: STORE_NAME, consistency: "strong" });

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
      const state = mergeConcurrentState(current, body.state);
      state._syncRevision = Math.max(current?._syncRevision || 0, body.state._syncRevision || 0) + 1;
      state.updatedAt = Date.now();
      const result = await sessions.setJSON(
        sessionKey(sessionId),
        state,
        currentEntry?.etag ? { onlyIfMatch: currentEntry.etag } : { onlyIfNew: true }
      );
      if (result.modified) return Response.json({ state }, responseOptions());
    }
    return Response.json({ error: "Concurrent session update; retry the action" }, responseOptions(409));
  }

  return Response.json({ error: "Method not allowed" }, responseOptions(405));
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
  merged.communicationStyle = current.communicationStyle;
  merged.reliability = current.reliability;
  merged.reliabilityPhase = current.reliabilityPhase;
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
