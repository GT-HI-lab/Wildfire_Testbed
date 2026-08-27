import { mergeConcurrentState } from "../netlify/functions/session-state.mjs";

const current = {
  id: "merge-test",
  _syncRevision: 4,
  tick: 20,
  mission: { elapsedSeconds: 20, remainingSeconds: 1780, completed: false },
  messages: [{ id: "existing", at: 1, text: "Existing" }],
  events: [],
  pendingEvents: [],
  metrics: { chatMessages: 1 },
  agents: { drone: { x: 20, y: 30 }, helicopter: { x: 40, y: 50 } },
  droneKnowledge: { discoveredCells: ["20,30"], detections: [] },
  fires: [{ x: 30, y: 30, intensity: 1 }],
  extinguished: [],
  paused: true,
  pauseReason: "Experimenter paused",
  status: "paused"
};
const staleParticipant = {
  ...current,
  _syncRevision: 3,
  tick: 19,
  mission: { elapsedSeconds: 19, remainingSeconds: 1781, completed: false },
  messages: [...current.messages, { id: "new-chat", at: 2, text: "Participant message" }],
  metrics: { chatMessages: 2 },
  agents: { drone: { x: 18, y: 28 }, helicopter: { x: 38, y: 48 } },
  droneKnowledge: { discoveredCells: ["18,28"], detections: [] },
  fires: [],
  extinguished: [{ x: 30, y: 30, kind: "water" }],
  paused: false,
  pauseReason: "",
  status: "running"
};
const merged = mergeConcurrentState(current, staleParticipant);

assert(merged.tick === 20, "stale write does not rewind tick");
assert(merged.mission.elapsedSeconds === 20 && merged.mission.remainingSeconds === 1780, "stale write does not rewind clock");
assert(merged.messages.some((message) => message.id === "new-chat"), "new chat survives concurrent clock update");
assert(merged.agents.drone.x === 20 && merged.agents.helicopter.x === 40, "autonomous agent positions do not rewind");
assert(merged.droneKnowledge.discoveredCells.includes("20,30") && merged.droneKnowledge.discoveredCells.includes("18,28"), "exploration knowledge merges");
assert(merged.fires.length === 0 && merged.extinguished.length === 1, "participant extinguishing survives concurrent fire updates");
assert(merged.paused && merged.pauseReason === "Experimenter paused", "stale participant write cannot undo experimenter pause");

console.log(JSON.stringify({ tick: merged.tick, messages: merged.messages.length, explored: merged.droneKnowledge.discoveredCells.length }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(`Concurrency smoke test failed: ${message}`);
}
