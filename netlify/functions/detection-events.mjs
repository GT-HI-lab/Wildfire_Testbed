import { getStore } from "@netlify/blobs";
import { isParticipantAuthorized, isAdminAuthorized } from "./lib/study-auth.mjs";
import { SESSION_STORE_NAME, STUDY_STORE_NAME, responseOptions } from "./lib/study-config.mjs";
import { safeAnalyticsSync, syncDetectionAnalytics } from "./lib/supabase-analytics.mjs";

export default async function detectionEvents(request) {
  const id = new URL(request.url).searchParams.get("sessionId") || "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return Response.json({ error: "Invalid session" }, responseOptions(400));
  if (!isParticipantAuthorized(request.headers, id) && !isAdminAuthorized(request.headers)) return Response.json({ error: "Unauthorized" }, responseOptions(401));
  const store = getStore({ name: SESSION_STORE_NAME, consistency: "strong" });
  const metadata = await getStore({ name: STUDY_STORE_NAME, consistency: "strong" }).get(`study-session-${id}`, { type: "json" });
  if (!metadata) return Response.json({ error: "Session not found" }, responseOptions(404));
  if (request.method === "GET") return Response.json({ records: (await store.get(`detection-${id}`, { type: "json" })) || [] }, responseOptions());
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, responseOptions(405));
  let records;
  try {
    records = (await request.json()).records;
    if (!Array.isArray(records) || !records.length || records.length > 100) throw new Error();
    for (const record of records) validateRecord(record);
  } catch { return Response.json({ error: "Invalid detection records" }, responseOptions(400)); }
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await store.getWithMetadata(`detection-${id}`, { type: "json" });
    const merged = mergeDetectionRecords(entry?.data || [], records);
    const result = await store.setJSON(`detection-${id}`, merged, entry ? (entry.etag ? { onlyIfMatch: entry.etag } : {}) : { onlyIfNew: true });
    if (!result.modified) continue;
    await safeAnalyticsSync("detection", () => syncDetectionAnalytics(metadata, id, records));
    return Response.json({ saved: true, count: records.length }, responseOptions());
  }
  return Response.json({ error: "Concurrent update; retry" }, responseOptions(409));
}
export function mergeDetectionRecords(existing, incoming) {
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) if ((byId.get(r.id)?.revision || 0) < r.revision) byId.set(r.id, r);
  return [...byId.values()];
}
export function validateRecord(r) {
  if (!r || !/^[\w-]{1,100}$/.test(r.id) || !Number.isInteger(r.revision) || r.revision < 1 || r.revision > 10) throw new Error();
  if (!["pending", "hit", "miss", "interrupted", "false_alarm"].includes(r.status)) throw new Error();
  if (!["probe", "false_alarm"].includes(r.kind)) throw new Error();
  for (const field of ["probe_onset_ms", "response_ms", "rt_ms", "lamp_off_ms"]) if (r[field] !== null && (!Number.isFinite(r[field]) || r[field] < 0)) throw new Error();
  if (!Number.isFinite(r.scenario_time_ms) || r.scenario_time_ms < 0) throw new Error();
  if (["hit", "miss", "false_alarm"].some((field) => typeof r[field] !== "boolean")) throw new Error();
  if (r.hit && (r.response_ms === null || r.rt_ms === null || r.rt_ms >= 3000 || r.miss)) throw new Error();
  if (r.kind === "false_alarm" && (!r.false_alarm || r.probe_onset_ms !== null || r.rt_ms !== null || r.status !== "false_alarm")) throw new Error();
  if (r.kind === "probe" && (r.probe_onset_ms === null || r.false_alarm)) throw new Error();
}
