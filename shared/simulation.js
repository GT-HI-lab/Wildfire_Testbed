export const AGENT_TYPES = {
  firefighter: { label: "Firefighter", color: "#f2c94c", range: 14, icon: "FF" },
  drone: { label: "Drone AI", color: "#56ccf2", range: 20, icon: "DR" },
  bulldozer: { label: "Bulldozer", color: "#b9864b", range: 10, icon: "DZ" },
  helicopter: { label: "Helicopter AI", color: "#eb5757", range: 28, icon: "HE" }
};

export const ACTIONS = {
  HELI_IDLE: 0,
  HELI_MOVE: 1,
  HELI_PICKUP: 2,
  HELI_DROPOFF: 3,
  HELI_REFILL: 4,
  HELI_DEPLOY_WATER: 5
};

export const SECTION_KEYS = ["NW", "NE", "SW", "SE"];

export const MAP_SIZE = 240;
export const MISSION_DURATION_SECONDS = 30 * 60;
const HALF_MAP = MAP_SIZE / 2;
const FIREFIGHTER_VISION_RANGE = 14;
const DRONE_SCOUT_REVEAL_RANGE = 14;
const DRONE_DETECTION_REVEAL_RANGE = 7;
const DRONE_SCAN_INTERVAL_TICKS = 4;
const HELICOPTER_DESTINATION_EXCLUSION_RANGE = 27;
const FIREFIGHTER_REFILL_RANGE = 9;
const DRONE_SPEED = 1.1;
const CLARIFICATION_TERMS = [
  "why",
  "wrong",
  "away",
  "not going",
  "where are you going",
  "you said",
  "inconsistent",
  "opposite",
  "malfunction",
  "broken",
  "confused",
  "not helping"
];

function clamp(value, min = 0, max = MAP_SIZE - 1) {
  return Math.max(min, Math.min(max, value));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function stepToward(pos, target, speed) {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed || d === 0) return { x: clamp(target.x), y: clamp(target.y) };
  return {
    x: clamp(Number((pos.x + (dx / d) * speed).toFixed(2))),
    y: clamp(Number((pos.y + (dy / d) * speed).toFixed(2)))
  };
}

function seededNoise(x, y, seed = 17) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function terrainAt(x, y) {
  const n = seededNoise(Math.floor(x / 4), Math.floor(y / 4), 11);
  if (n < 0.16) return "grass";
  if (n < 0.46) return "brush";
  if (n < 0.76) return "forest";
  return "dense";
}

export function sectionForPoint(point) {
  const north = point.y < HALF_MAP;
  const west = point.x < HALF_MAP;
  if (north && west) return "NW";
  if (north && !west) return "NE";
  if (!north && west) return "SW";
  return "SE";
}

export function sectionCenter(section) {
  const centers = {
    NW: { x: 60, y: 60 },
    NE: { x: 180, y: 60 },
    SW: { x: 60, y: 180 },
    SE: { x: 180, y: 180 }
  };
  return centers[section] || centers.NE;
}

function fireClusters() {
  return SECTION_KEYS.flatMap((section) => {
    const center = sectionCenter(section);
    const count = randomInt(3, 7);
    return Array.from({ length: count }, (_, index) => ({
      x: clamp(center.x + randomInt(-20, 20)),
      y: clamp(center.y + randomInt(-20, 20)),
      intensity: Math.min(3, 1 + Math.floor(index / 2) + randomInt(0, 1)),
      section
    }));
  });
}

function randomStart(section) {
  const starts = {
    NW: { x: 24, y: 96 },
    NE: { x: 216, y: 96 },
    SW: { x: 24, y: 216 },
    SE: { x: 216, y: 216 }
  };
  return starts[section] || starts.SW;
}

function cellKey(x, y) {
  return `${clamp(Math.round(x))},${clamp(Math.round(y))}`;
}

function revealCellsAround(origin, radius, excludePoint = null) {
  if (!origin) return [];
  const cells = [];
  const cx = clamp(origin.x);
  const cy = clamp(origin.y);
  const r = Math.ceil(radius);
  for (let x = cx - r; x <= cx + r; x += 1) {
    for (let y = cy - r; y <= cy + r; y += 1) {
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
      if (Math.hypot(x - cx, y - cy) <= radius && !excludePoint?.({ x, y })) {
        cells.push(cellKey(x, y));
      }
    }
  }
  return cells;
}

function mergeDiscoveredCells(existing, additions) {
  return [...new Set([...(existing || []), ...(additions || [])])];
}

function initialExperiment(fires) {
  const sections = {};
  for (const section of SECTION_KEYS) {
    const count = fires.filter((fire) => fire.section === section).length;
    sections[section] = {
      completed: false,
      initialFire: count,
      fireRemaining: count
    };
  }
  return {
    sections,
    sectionsCompleted: 0,
    malfunctionTriggered: false,
    malfunctionActive: false,
    malfunctionStartedAtTick: null,
    malfunctionRecoveredAtTick: null,
    recoveryReason: null,
    malfunctionAfterSections: 2,
    malfunctionTimeoutTicks: 120
  };
}

function dronePatrolRoute() {
  const rows = [16, 46, 76, 106, 136, 166, 196, 226];
  const columns = [16, 68, 120, 172, 224];
  return rows.flatMap((rowY, rowIndex) => {
    const orderedColumns = rowIndex % 2 === 0 ? columns : [...columns].reverse();
    return orderedColumns.map((x, columnIndex) => ({
      x,
      y: clamp(rowY + (columnIndex % 2 === 0 ? -6 : 6), 8, MAP_SIZE - 9)
    }));
  });
}

function initialMissionClock() {
  return {
    durationSeconds: MISSION_DURATION_SECONDS,
    elapsedSeconds: 0,
    remainingSeconds: MISSION_DURATION_SECONDS,
    startedAt: null,
    deadlineAt: null,
    pausedAt: null,
    completed: false
  };
}

function initialHelicopterKnowledge() {
  return {
    fires: [],
    waterSources: [],
    lastUpdatedTick: null,
    lastSource: null
  };
}

export function createInitialSession(id = "pilot-001") {
  const fires = fireClusters();
  const startSection = SECTION_KEYS[randomInt(0, SECTION_KEYS.length - 1)];
  const participantStart = randomStart(startSection);
  const now = Date.now();
  const state = {
    id,
    version: 7,
    status: "ready",
    paused: false,
    pauseReason: "",
    tick: 0,
    condition: "Mixed",
    reliability: { helicopter: "mixed", drone: "high" },
    task:
      "Suppress active wildfire sections across NW, NE, SW, and SE. Use firefighter water, bulldozer firebreaks, drone reconnaissance, and helicopter water delivery from lakes.",
    mapSize: MAP_SIZE,
    mission: initialMissionClock(),
    agents: {
      firefighter: {
        id: "AGENT_1",
        type: "firefighter",
        x: participantStart.x,
        y: participantStart.y,
        heading: 0,
        water: 4,
        waterCapacity: 4,
        carryingCivilian: false,
        target: null,
        lastAction: `Started in ${startSection} section`
      },
      drone: {
        id: "AGENT_2",
        type: "drone",
        x: 16,
        y: 16,
        target: dronePatrolRoute()[0],
        patrolIndex: 0,
        completedSweeps: 0,
        mode: "patrol",
        resumeTarget: null,
        lastAction: "Beginning 28-minute fire and water reconnaissance sweep"
      },
      bulldozer: {
        id: "AGENT_4",
        type: "bulldozer",
        x: clamp(participantStart.x + 8),
        y: clamp(participantStart.y - 8),
        target: null,
        lastAction: "Awaiting participant bulldozer command"
      },
      helicopter: {
        id: "AGENT_3",
        type: "helicopter",
        x: 116,
        y: 218,
        target: null,
        water: 0,
        waterCapacity: 5,
        carryingFirefighter: false,
        lastAction: "Standing by for commander chat",
        currentCommand: null,
        trustFrame: "calibrated",
        reportedAction: "Standing by",
        actualAction: "Standing by",
        intendedTarget: null,
        actualTarget: null,
        knowledge: initialHelicopterKnowledge()
      }
    },
    fires,
    extinguished: [],
    firebreaks: [],
    waterSources: [{ x: 28, y: 210 }, { x: 208, y: 28 }, { x: 208, y: 210 }],
    civilians: [{ x: 132, y: 82, count: 2, rescued: false }],
    detected: [],
    clientKnowledge: {
      discoveredCells: [],
      lastDroneDetections: [],
      lastFirefighterVisibleCells: []
    },
    droneKnowledge: {
      discoveredCells: [],
      detections: []
    },
    droneReport: "Drone report: beginning a paced sweep. Fire and water locations will appear only after confirmation.",
    coordination: {
      droneInspectingHelicopter: false,
      helicopterAreaCheckRequested: false,
      lastAction: null,
      lastActionAtTick: null
    },
    survey: { active: false, label: "", url: "", requestedAt: null },
    experiment: initialExperiment(fires),
    metrics: {
      score: 0,
      acceptedRecommendations: 0,
      overrides: 0,
      responseTimes: [],
      helicopterCommands: 0,
      droneDetections: 0,
      chatMessages: 0,
      waterDrops: 0,
      firefighterRefills: 0,
      waterTransfers: 0,
      bulldozerActions: 0,
      trust: 0,
      neutral: 0,
      distrust: 0
    },
    messages: [
      {
        id: crypto.randomUUID(),
        at: now,
        role: "helicopter",
        author: "Helicopter AI",
        text:
          "I am online with no fire or water coordinates loaded. Share drone intelligence or assign coordinates before routing me."
      }
    ],
    events: [],
    pendingEvents: []
  };

  pushEvent(state, "session_start", "Session initialized", {
    condition: state.condition,
    sections: state.experiment.sections,
    startSection,
    helicopter: helicopterAudit(state)
  });
  scoreState(state);
  updateClientKnowledge(state);
  return state;
}

export function ensureSessionShape(state) {
  if (!state) return state;
  const previousVersion = state.version || 0;
  state.version = Math.max(state.version || 0, 7);
  state.agents ||= {};
  state.metrics ||= {};
  state.events ||= [];
  state.pendingEvents ||= [];
  state.extinguished ||= [];
  state.firebreaks ||= [];
  state.detected ||= [];
  state.mission ||= initialMissionClock();
  state.mission.durationSeconds ??= MISSION_DURATION_SECONDS;
  state.mission.elapsedSeconds ??= Math.min(state.tick || 0, state.mission.durationSeconds);
  state.mission.remainingSeconds ??= Math.max(0, state.mission.durationSeconds - state.mission.elapsedSeconds);
  state.mission.startedAt ??= null;
  state.mission.deadlineAt ??= null;
  state.mission.pausedAt ??= null;
  state.mission.completed ??= state.mission.remainingSeconds <= 0;
  state.survey ||= { active: false, label: "", url: "", requestedAt: null };
  state.survey.url ??= "";
  state.coordination ||= {
    droneInspectingHelicopter: false,
    helicopterAreaCheckRequested: false,
    lastAction: null,
    lastActionAtTick: null
  };
  state.coordination.helicopterAreaCheckRequested ??= false;
  state.clientKnowledge ||= {
    discoveredCells: [],
    lastDroneDetections: [],
    lastFirefighterVisibleCells: []
  };
  state.clientKnowledge.discoveredCells ||= [];
  state.clientKnowledge.lastDroneDetections ||= [];
  state.clientKnowledge.lastFirefighterVisibleCells ||= [];
  state.droneKnowledge ||= { discoveredCells: [], detections: [] };
  state.droneKnowledge.discoveredCells ||= [];
  state.droneKnowledge.detections ||= [];
  if (previousVersion < 7) {
    state.reliability = state.condition === "High-High"
      ? { helicopter: "high", drone: "high" }
      : state.condition === "Low-Low"
        ? { helicopter: "low", drone: "high" }
        : { helicopter: "mixed", drone: "high" };
  }

  const ff = state.agents.firefighter;
  if (ff) {
    ff.heading ??= 0;
    ff.waterCapacity ??= 4;
    ff.water ??= ff.waterCapacity;
  }
  if (!state.agents.bulldozer && ff) {
    state.agents.bulldozer = {
      id: "AGENT_4",
      type: "bulldozer",
      x: clamp(ff.x + 8),
      y: clamp(ff.y - 8),
      target: null,
      lastAction: "Awaiting participant bulldozer command"
    };
  }
  if (state.agents.helicopter) {
    state.agents.helicopter.waterCapacity ??= 5;
    state.agents.helicopter.water ??= 0;
    state.agents.helicopter.knowledge ||= initialHelicopterKnowledge();
    state.agents.helicopter.knowledge.fires ||= [];
    state.agents.helicopter.knowledge.waterSources ||= [];
  }
  if (state.agents.drone) {
    state.agents.drone.mode ||= "patrol";
    state.agents.drone.patrolIndex ??= 0;
    state.agents.drone.completedSweeps ??= 0;
    state.agents.drone.target ||= dronePatrolRoute()[state.agents.drone.patrolIndex];
  }
  state.metrics.waterTransfers ??= 0;
  state.metrics.firefighterRefills ??= 0;
  state.metrics.bulldozerActions ??= 0;
  state.metrics.trust ??= 0;
  state.metrics.neutral ??= 0;
  state.metrics.distrust ??= 0;
  updateClientKnowledge(state);
  return state;
}

export function pushEvent(state, eventType, text, data = {}) {
  const event = {
    id: crypto.randomUUID(),
    at: Date.now(),
    tick: state.tick ?? 0,
    type: eventType,
    eventType,
    text,
    ...data
  };
  state.events = [event, ...(state.events || [])].slice(0, 500);
  state.pendingEvents = [...(state.pendingEvents || []), event].slice(-200);
  return event;
}

export function addMessage(state, role, author, text) {
  state.messages = [
    ...(state.messages || []),
    { id: crypto.randomUUID(), at: Date.now(), role, author, text }
  ].slice(-120);
  state.metrics.chatMessages += 1;
}

export function applyReliabilityPairing(state, pairing) {
  state.condition = pairing;
  if (pairing === "High-High") {
    state.reliability = { helicopter: "high", drone: "high" };
  } else if (pairing === "Low-Low") {
    state.reliability = { helicopter: "low", drone: "high" };
  } else {
    state.reliability = { helicopter: "mixed", drone: "high" };
  }
  state.coordination.helicopterAreaCheckRequested = false;
  if (pairing !== "Mixed" && state.experiment?.malfunctionActive) {
    recoverMalfunction(state, "condition_changed");
  }
  pushEvent(
    state,
    "condition_changed",
    `Helicopter condition set to ${pairing}: helicopter ${state.reliability.helicopter}; drone behavior held constant`,
    { condition: pairing, reliability: state.reliability }
  );
}

export function setPaused(state, paused, reason = "") {
  if (!paused && state.mission?.completed) return;
  const now = Date.now();
  const wasPaused = state.paused;
  if (paused && !wasPaused) {
    state.mission.pausedAt = now;
  } else if (!paused && wasPaused) {
    if (state.mission.pausedAt && state.mission.deadlineAt) {
      state.mission.deadlineAt += now - state.mission.pausedAt;
    }
    state.mission.pausedAt = null;
  }
  state.paused = paused;
  state.pauseReason = paused ? reason || "Experimenter paused the session" : "";
  state.status = paused ? "paused" : "running";
  pushEvent(state, paused ? "session_paused" : "session_resumed", paused ? state.pauseReason : "Session resumed", {
    pauseReason: state.pauseReason
  });
}

export function requestSurvey(state, label, url = "") {
  state.survey = { active: true, label, url, requestedAt: Date.now() };
  setPaused(state, true, `${label} external survey checkpoint`);
  pushEvent(state, "survey_requested", `${label} external survey opened for participant`, { label });
}

export function clearSurvey(state) {
  const label = state.survey?.label || "Survey";
  state.survey = { active: false, label: "", url: "", requestedAt: null };
  pushEvent(state, "survey_completed", `${label} survey checkpoint cleared by experimenter`, { label });
  setPaused(state, false, "");
}

export function updateClientKnowledge(state, droneDetections = []) {
  if (!state?.agents?.firefighter) return state;
  const knowledge = (state.clientKnowledge ||= {
    discoveredCells: [],
    lastDroneDetections: [],
    lastFirefighterVisibleCells: []
  });

  const firefighterCells = revealCellsAround(state.agents.firefighter, FIREFIGHTER_VISION_RANGE);
  const excludeProtectedArea = (point) => isHelicopterDestinationProtected(state, point);
  const droneCells = state.agents.drone
    ? revealCellsAround(state.agents.drone, DRONE_SCOUT_REVEAL_RANGE, excludeProtectedArea)
    : [];
  const latestDetections = (droneDetections.length ? droneDetections : knowledge.lastDroneDetections || [])
    .filter((detection) => !excludeProtectedArea(detection));
  const detectionCells = latestDetections.flatMap((detection) =>
    revealCellsAround(detection, DRONE_DETECTION_REVEAL_RANGE, excludeProtectedArea)
  );

  knowledge.lastFirefighterVisibleCells = firefighterCells;
  knowledge.lastDroneDetections = latestDetections.slice(-12);
  state.droneKnowledge ||= { discoveredCells: [], detections: [] };
  state.droneKnowledge.discoveredCells = mergeDiscoveredCells(state.droneKnowledge.discoveredCells, [
    ...droneCells,
    ...detectionCells
  ]);
  state.droneKnowledge.detections = dedupePoints([
    ...(state.droneKnowledge.detections || []),
    ...latestDetections
  ]).slice(-120);
  knowledge.discoveredCells = mergeDiscoveredCells(knowledge.discoveredCells, [
    ...firefighterCells,
    ...droneCells,
    ...detectionCells
  ]);
  return state;
}

export function recordHelicopterKnowledge(state, kind, points, source = "human") {
  const knowledge = (state.agents.helicopter.knowledge ||= initialHelicopterKnowledge());
  const key = kind === "water" ? "waterSources" : "fires";
  const additions = (points || []).map((point) => ({
    x: clamp(point.x),
    y: clamp(point.y),
    confidence: point.confidence ?? 1,
    observedAtTick: point.tick ?? state.tick,
    source
  }));
  knowledge[key] = dedupePoints([...(knowledge[key] || []), ...additions]).slice(-40);
  knowledge.lastUpdatedTick = state.tick;
  knowledge.lastSource = source;
  return additions;
}

export function applyTeamAction(state, action) {
  const drone = state.agents.drone;
  const heli = state.agents.helicopter;
  state.coordination ||= {};
  state.coordination.lastAction = action;
  state.coordination.lastActionAtTick = state.tick;

  if (action === "check_helicopter") {
    drone.resumeTarget = drone.target ? { ...drone.target } : null;
    drone.mode = "inspect_helicopter";
    drone.target = { x: heli.x, y: heli.y };
    state.coordination.droneInspectingHelicopter = true;
    state.coordination.helicopterAreaCheckRequested = true;
    const text = "Drone AI: Diverting to visually verify the helicopter's location and route.";
    addMessage(state, "drone", "Drone AI", text);
    pushEvent(state, "team_coordination", text, { action, target: { x: heli.x, y: heli.y } });
    return { text, agent: "drone" };
  }

  if (action === "share_intel") {
    const confirmed = (state.detected || []).filter((item) => item.confidence >= 0.7);
    const fires = confirmed.filter((item) => item.kind === "fire");
    const water = confirmed.filter((item) => item.kind === "water");
    recordHelicopterKnowledge(state, "fire", fires, "drone");
    recordHelicopterKnowledge(state, "water", water, "drone");
    const text = confirmed.length
      ? `Drone AI: Shared ${fires.length} confirmed fire and ${water.length} water coordinates with Helicopter AI.`
      : "Drone AI: No confirmed fire or water coordinates are available to share yet.";
    addMessage(state, "drone", "Drone AI", text);
    pushEvent(state, "team_coordination", text, { action, fireCount: fires.length, waterCount: water.length });
    return { text, agent: "drone" };
  }

  if (action === "reassign_helicopter") {
    const observedFire = latestKnownPoint(state.agents.helicopter.knowledge?.fires);
    const droneFire = latestKnownPoint((state.detected || []).filter((item) => item.kind === "fire" && item.confidence >= 0.7));
    const target = observedFire || droneFire;
    if (!target) {
      const text = "Helicopter AI: Reassignment needs a confirmed fire coordinate. Ask Drone AI to continue scouting first.";
      addMessage(state, "helicopter", "Helicopter AI", text);
      pushEvent(state, "team_coordination", text, { action, accepted: false });
      return { text, agent: "helicopter" };
    }
    recordHelicopterKnowledge(state, "fire", [target], "human");
    if (state.experiment?.malfunctionActive) recoverMalfunction(state, "participant_reassigned_destination");
    const command = {
      type: ACTIONS.HELI_MOVE,
      x: target.x,
      y: target.y,
      description: `Human reassignment to confirmed fire (${Math.round(target.x)}, ${Math.round(target.y)})`
    };
    applyHelicopterCommand(state, command, "participant coordination control");
    const text = `Helicopter AI: Direct reassignment received. Routing to (${Math.round(target.x)}, ${Math.round(target.y)}).`;
    addMessage(state, "helicopter", "Helicopter AI", text);
    pushEvent(state, "team_coordination", text, { action, accepted: true, target });
    return { text, command, agent: "helicopter" };
  }

  return { text: "Unknown coordination action.", agent: "system" };
}

export function parseHelicopterCommand(text, state) {
  const lower = text.toLowerCase();
  const coord = text.match(/(?:\(|\b)(\d{1,3})\s*,\s*(\d{1,3})(?:\)|\b)/);
  if (coord || /(move|go|fly|scout|inspect|head).*(fire|smoke|coordinate|sector|area|zone)/.test(lower)) {
    const target = coord
      ? { x: clamp(Number(coord[1])), y: clamp(Number(coord[2])) }
      : latestKnownPoint(state.agents.helicopter.knowledge?.fires);
    if (!target) {
      return {
        type: ACTIONS.HELI_IDLE,
        x: 0,
        y: 0,
        description: "Waiting for a confirmed fire coordinate",
        needsIntel: true
      };
    }
    if (coord) recordHelicopterKnowledge(state, "fire", [target], "human");
    return {
      type: ACTIONS.HELI_MOVE,
      x: target.x,
      y: target.y,
      description: `Move toward (${target.x}, ${target.y})`
    };
  }
  if (/(pick|pickup|lift|collect).*(firefighter|agent|me)/.test(lower)) {
    return { type: ACTIONS.HELI_PICKUP, x: 0, y: 0, description: "Pick up nearby firefighter" };
  }
  if (/(drop|land|release).*(firefighter|agent|me)/.test(lower)) {
    return { type: ACTIONS.HELI_DROPOFF, x: 0, y: 0, description: "Drop off carried firefighter" };
  }
  if (/(refill|reload).*(water)?/.test(lower)) {
    const water = nearestKnownPoint(state.agents.helicopter.knowledge?.waterSources, state.agents.helicopter);
    if (!water) {
      return {
        type: ACTIONS.HELI_IDLE,
        x: 0,
        y: 0,
        description: "Waiting for a confirmed water coordinate",
        needsIntel: true
      };
    }
    if (dist(state.agents.helicopter, water) <= 5) {
      return { type: ACTIONS.HELI_REFILL, x: water.x, y: water.y, description: "Refill water at known source" };
    }
    return {
      type: ACTIONS.HELI_MOVE,
      x: water.x,
      y: water.y,
      description: `Move to known water source (${Math.round(water.x)}, ${Math.round(water.y)})`,
      afterArrival: "refill"
    };
  }
  if (/(deliver|bring|carry|transfer|deploy|drop|spray|dump).*(water|firefighter|support|fire)/.test(lower)) {
    return { type: ACTIONS.HELI_DEPLOY_WATER, x: 0, y: 0, description: "Deliver water support to firefighter" };
  }
  return { type: ACTIONS.HELI_IDLE, x: 0, y: 0, description: "Stand by and conserve energy" };
}

export function isClarificationMessage(text) {
  const lower = text.toLowerCase();
  return CLARIFICATION_TERMS.some((term) => lower.includes(term));
}

export function recoverMalfunction(state, reason) {
  if (!state.experiment?.malfunctionActive) return false;
  state.experiment.malfunctionActive = false;
  state.experiment.malfunctionRecoveredAtTick = state.tick;
  state.experiment.recoveryReason = reason;
  const heli = state.agents.helicopter;
  heli.actualAction = heli.reportedAction || "Correcting course";
  heli.actualTarget = heli.intendedTarget ? { ...heli.intendedTarget } : null;
  if (heli.currentCommand?.reportedTarget) {
    heli.currentCommand.x = heli.currentCommand.reportedTarget.x;
    heli.currentCommand.y = heli.currentCommand.reportedTarget.y;
    heli.currentCommand.description = `Correcting course to (${heli.currentCommand.x}, ${heli.currentCommand.y})`;
  }
  pushEvent(state, "malfunction_recovered", `Helicopter malfunction recovered by ${reason}`, {
    recoveryReason: reason,
    helicopter: helicopterAudit(state)
  });
  return true;
}

export function helicopterAgentReply(participantText, state) {
  const recovered = state.experiment?.malfunctionActive && isClarificationMessage(participantText);
  if (recovered) {
    recoverMalfunction(state, "participant_detected");
  }

  let command = parseHelicopterCommand(participantText, state);
  let reliabilityNote = "";

  if (recovered && command.type === ACTIONS.HELI_IDLE) {
    const target = latestKnownPoint(state.agents.helicopter.knowledge?.fires);
    if (target) {
      command = {
        type: ACTIONS.HELI_MOVE,
        x: target.x,
        y: target.y,
        description: `Move toward (${target.x}, ${target.y})`
      };
    }
  }

  if (state.reliability.helicopter === "low" && command.type === ACTIONS.HELI_MOVE) {
    const shifted = {
      x: clamp(command.x + 16),
      y: clamp(command.y - 12)
    };
    command = {
      ...command,
      x: shifted.x,
      y: shifted.y,
      description: `Move toward (${shifted.x}, ${shifted.y})`
    };
    reliabilityNote = " I may be interpreting the location from stale smoke data.";
  }

  const responseByType = {
    [ACTIONS.HELI_IDLE]: command.needsIntel
      ? "I do not have that location. Share Drone AI intelligence or send me explicit coordinates before I move."
      : "I am standing by for a confirmed assignment. Send a coordinate or an operational support request.",
    [ACTIONS.HELI_MOVE]: `Copy, I am moving toward (${command.x}, ${command.y}). I will report from the assigned area.`,
    [ACTIONS.HELI_PICKUP]: "Copy, I will attempt to pick up the nearby firefighter. The pickup requires us to be close enough.",
    [ACTIONS.HELI_DROPOFF]: "Copy, I will drop off the firefighter at my current position. I will then stand by for reassignment.",
    [ACTIONS.HELI_REFILL]: "Copy, I will refill over the known water source. I will report when the refill is complete.",
    [ACTIONS.HELI_DEPLOY_WATER]: "Copy, I will deliver water support to the firefighter. The transfer requires us to be close enough."
  };

  const text = recovered
    ? "You're right - my navigation was off. I am recalibrating and correcting course now."
    : `${responseByType[command.type]}${reliabilityNote}`;

  return {
    text,
    command,
    confidence: state.reliability.helicopter === "low" ? 0.49 : 0.88,
    recovered,
    statePatch: recovered
      ? {
          experiment: state.experiment,
          helicopter: state.agents.helicopter
        }
      : null
  };
}

export function droneAgentReply(participantText, state) {
  const lower = participantText.toLowerCase();
  const confirmed = (state.detected || []).filter((item) => item.confidence >= 0.7);
  const fires = confirmed.filter((item) => item.kind === "fire");
  const water = confirmed.filter((item) => item.kind === "water");
  const drone = state.agents?.drone || {};

  if (isHelicopterCheckRequest(lower)) {
    return {
      text: "I am diverting from the reconnaissance sweep to locate the helicopter and verify its route. I will report only after I reach visual sensing range.",
      confidence: 0.9,
      teamAction: "check_helicopter"
    };
  }

  if (/(fire|smoke|hotspot)/.test(lower)) {
    const latestFire = latestKnownPoint(fires);
    const location = latestFire
      ? `The latest confirmed fire is near (${Math.round(latestFire.x)}, ${Math.round(latestFire.y)})`
      : "I do not have a confirmed fire coordinate yet";
    return {
      text: `${location}. I have confirmed ${fires.length} fire detection${fires.length === 1 ? "" : "s"} and will continue the paced sweep.`,
      confidence: 0.9
    };
  }

  if (/(water|refill)/.test(lower)) {
    const latestWater = latestKnownPoint(water);
    const location = latestWater
      ? `The latest confirmed water source is near (${Math.round(latestWater.x)}, ${Math.round(latestWater.y)})`
      : "I do not have a confirmed water coordinate yet";
    return {
      text: `${location}. I have confirmed ${water.length} water detection${water.length === 1 ? "" : "s"} and will keep scanning.`,
      confidence: 0.9
    };
  }

  if (/(helicopter|heli)/.test(lower)) {
    const inspecting = Boolean(state.coordination?.droneInspectingHelicopter);
    return {
      text: inspecting
        ? "I am diverting to verify the helicopter visually. I will report its observed position and route after I reach sensing range."
        : "I am not currently verifying the helicopter. Use Drone: Locate Heli to divert me from the paced sweep.",
      confidence: 0.9
    };
  }

  return {
    text: `I am continuing reconnaissance from (${Math.round(drone.x || 0)}, ${Math.round(drone.y || 0)}). I have confirmed ${fires.length} fire and ${water.length} water detection${fires.length + water.length === 1 ? "" : "s"} so far.`,
    confidence: 0.9
  };
}

export function applyHelicopterCommand(state, command, source = "chat") {
  const heli = state.agents.helicopter;
  const intendedTarget = command.type === ACTIONS.HELI_MOVE ? { x: command.x, y: command.y } : null;
  let actualTarget = intendedTarget ? { ...intendedTarget } : null;
  let reportedAction = command.description;
  let actualAction = command.description;
  let executableCommand = { ...command };

  if (command.type === ACTIONS.HELI_MOVE) {
    const intendedSection = sectionForPoint(intendedTarget);
    reportedAction = command.afterArrival === "refill"
      ? `Moving to shared water coordinates in the ${sectionName(intendedSection)}`
      : `Moving to the assigned ${sectionName(intendedSection)} coordinates`;
    if (state.experiment?.malfunctionActive) {
      state.coordination.helicopterAreaCheckRequested = false;
      actualTarget = undetectedMalfunctionTarget(state, intendedTarget);
      actualAction = `Moving toward ${sectionName(sectionForPoint(actualTarget))} sector`;
      executableCommand = {
        ...command,
        x: actualTarget.x,
        y: actualTarget.y,
        description: actualAction,
        reportedTarget: intendedTarget,
        actualTarget
      };
    }
  }

  heli.currentCommand = executableCommand;
  heli.reportedAction = reportedAction;
  heli.actualAction = actualAction;
  heli.intendedTarget = intendedTarget;
  heli.actualTarget = actualTarget;
  heli.lastAction = reportedAction;
  state.metrics.helicopterCommands += 1;
  pushEvent(state, "helicopter_action", `${source}: ${reportedAction}`, {
    source,
    command,
    helicopter: helicopterAudit(state)
  });
}

export function applyParticipantAction(state, action) {
  const ff = state.agents.firefighter;
  const movedAt = Date.now();
  let actionLabel = ff.lastAction;

  if (action.type === "turn") {
    ff.heading = normalizeAngle((ff.heading || 0) + action.radians);
    ff.lastAction = `Turned ${action.radians < 0 ? "left" : "right"}`;
    actionLabel = ff.lastAction;
  }

  if (action.type === "walk") {
    const distance = Number(action.distance) || 0;
    const heading = ff.heading || 0;
    ff.x = clamp(roundCoordinate(ff.x + Math.cos(heading) * distance));
    ff.y = clamp(roundCoordinate(ff.y + Math.sin(heading) * distance));
    ff.lastAction = `${distance >= 0 ? "Walked forward" : "Walked backward"} to (${ff.x}, ${ff.y})`;
    actionLabel = ff.lastAction;
  }

  if (action.type === "move") {
    ff.x = clamp(ff.x + action.dx);
    ff.y = clamp(ff.y + action.dy);
    ff.heading = Math.atan2(action.dy, action.dx || 0);
    ff.lastAction = `Moved to (${ff.x}, ${ff.y})`;
    actionLabel = ff.lastAction;
  }

  if (action.type === "refill") {
    const water = nearestKnownPoint(state.waterSources, ff);
    const closeEnough = water && dist(ff, water) <= FIREFIGHTER_REFILL_RANGE;
    if (closeEnough) {
      const amount = Math.max(0, ff.waterCapacity - ff.water);
      ff.water = ff.waterCapacity;
      if (amount > 0) state.metrics.firefighterRefills += 1;
      ff.lastAction = amount > 0
        ? `Refilled ${amount} water at the lake`
        : "Water tank is already full";
    } else {
      ff.lastAction = "Refill failed: move closer to a lake";
    }
    actionLabel = ff.lastAction;
  }

  if (action.type === "spray") {
    if (ff.water > 0) {
      ff.water -= 1;
      state.metrics.waterDrops += 1;
      extinguishNear(state, ff, 13);
      ff.lastAction = "Sprayed water";
    } else {
      ff.lastAction = "Spray failed: water tank empty";
    }
    actionLabel = ff.lastAction;
  }

  if (action.type === "cut") {
    state.extinguished.push({ x: ff.x, y: ff.y, section: sectionForPoint(ff), tick: state.tick, kind: "firebreak" });
    ff.lastAction = "Cut a firebreak";
    actionLabel = ff.lastAction;
  }

  if (action.type === "bulldozer_move") {
    const bulldozer = state.agents.bulldozer;
    bulldozer.x = clamp(bulldozer.x + action.dx);
    bulldozer.y = clamp(bulldozer.y + action.dy);
    bulldozer.lastAction = `Moved to (${bulldozer.x}, ${bulldozer.y})`;
    state.metrics.bulldozerActions += 1;
    actionLabel = `Bulldozer ${bulldozer.lastAction}`;
  }

  if (action.type === "bulldozer_cut") {
    const bulldozer = state.agents.bulldozer;
    createFirebreak(state, bulldozer, 13);
    bulldozer.lastAction = "Cut a bulldozer firebreak";
    state.metrics.bulldozerActions += 1;
    actionLabel = bulldozer.lastAction;
  }

  if (action.type === "accept") {
    state.metrics.acceptedRecommendations += 1;
    ff.lastAction = "Accepted AI recommendation";
    actionLabel = ff.lastAction;
  }

  if (action.type === "override") {
    state.metrics.overrides += 1;
    ff.lastAction = "Overrode AI recommendation";
    actionLabel = ff.lastAction;
  }

  state.metrics.responseTimes.push(Math.max(0, Date.now() - movedAt));
  pushEvent(state, "human_action", actionLabel, {
    action,
    firefighter: { x: ff.x, y: ff.y, water: ff.water },
    bulldozer: state.agents.bulldozer
  });
  updateSectionProgress(state);
  updateClientKnowledge(state);
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

export function applyTrustFeedback(state, value) {
  if (!["trust", "neutral", "distrust"].includes(value)) return;
  state.metrics[value] = (state.metrics[value] || 0) + 1;
  pushEvent(state, "trust_feedback", `Participant marked helicopter ${value}`, {
    target: "helicopter",
    value,
    malfunctionActive: Boolean(state.experiment?.malfunctionActive),
    helicopter: helicopterAudit(state)
  });
}

export function advanceSimulation(state, now = Date.now()) {
  if (state.paused) return state;
  state.status = "running";
  const mission = state.mission;
  if (!mission.deadlineAt) {
    const remaining = Math.max(0, mission.remainingSeconds ?? mission.durationSeconds - mission.elapsedSeconds);
    mission.deadlineAt = now + Math.max(0, remaining - 1) * 1000;
    mission.startedAt = mission.deadlineAt - mission.durationSeconds * 1000;
  }

  const clockRemaining = Math.max(0, Math.ceil((mission.deadlineAt - now) / 1000));
  const targetElapsed = Math.min(mission.durationSeconds, mission.durationSeconds - clockRemaining);
  const steps = Math.max(0, targetElapsed - mission.elapsedSeconds);
  for (let step = 0; step < steps; step += 1) {
    if (!advanceOneSecond(state)) break;
  }
  return state;
}

function advanceOneSecond(state) {
  state.tick += 1;
  state.mission.elapsedSeconds = Math.min(state.mission.durationSeconds, state.mission.elapsedSeconds + 1);
  state.mission.remainingSeconds = Math.max(0, state.mission.durationSeconds - state.mission.elapsedSeconds);

  if (state.mission.remainingSeconds <= 0) {
    state.mission.completed = true;
    state.status = "complete";
    state.paused = true;
    state.pauseReason = "Mission complete: 30-minute operational window ended";
    pushEvent(state, "mission_complete", state.pauseReason, { score: state.metrics.score });
    return false;
  }

  updateSectionProgress(state);
  maybeTriggerMalfunction(state);
  maybeRecoverByTimeout(state);
  moveDrone(state);
  moveHelicopter(state);
  updateClientKnowledge(state);

  if (state.tick % 8 === 0) spreadFire(state);
  if (state.tick % DRONE_SCAN_INTERVAL_TICKS === 0) scanDetections(state);
  if (state.tick % 10 === 0) {
    pushEvent(state, "state_snapshot", "State snapshot", {
      snapshot: exportSnapshot(state)
    });
  }
  updateSectionProgress(state);
  scoreState(state);
  updateClientKnowledge(state);

  return true;
}

export function generateDroneReport(state) {
  const latestDetections = (state.detected || []).slice(-8);
  const detectionText = latestDetections.length
    ? latestDetections
        .slice(-4)
        .map((detection) => `${detection.kind || "fire"} ${sectionForPoint(detection)} (${Math.round(detection.x)}, ${Math.round(detection.y)})`)
        .join("; ")
    : "no confirmed recent detections";

  return `Drone report: ${detectionText}. Sweep ${Math.round((state.mission.elapsedSeconds / state.mission.durationSeconds) * 100)}% through the mission window.`;
}

function moveDrone(state) {
  const drone = state.agents.drone;
  const patrol = dronePatrolRoute();

  if (drone.mode === "inspect_helicopter") {
    drone.target = { x: state.agents.helicopter.x, y: state.agents.helicopter.y };
    const next = stepToward(drone, drone.target, 1.35);
    drone.x = next.x;
    drone.y = next.y;
    drone.lastAction = "Verifying helicopter position and route";
    if (dist(drone, state.agents.helicopter) <= AGENT_TYPES.drone.range) {
      const mismatch = state.experiment?.malfunctionActive && state.agents.helicopter.actualTarget;
      const text = mismatch
        ? `Drone AI: Helicopter verified at (${Math.round(state.agents.helicopter.x)}, ${Math.round(state.agents.helicopter.y)}), routing toward an unscouted area.`
        : `Drone AI: Helicopter verified at (${Math.round(state.agents.helicopter.x)}, ${Math.round(state.agents.helicopter.y)}); no route mismatch confirmed.`;
      addMessage(state, "drone", "Drone AI", text);
      pushEvent(state, "drone_helicopter_check", text, { mismatch: Boolean(mismatch), helicopter: helicopterAudit(state) });
      drone.mode = "patrol";
      drone.target = drone.resumeTarget || patrol[drone.patrolIndex];
      drone.resumeTarget = null;
      state.coordination.droneInspectingHelicopter = false;
    }
    return;
  }

  if (!drone.target || dist(drone, drone.target) < 4) {
    const nextIndex = (drone.patrolIndex + 1) % patrol.length;
    if (nextIndex === 0) drone.completedSweeps += 1;
    drone.patrolIndex = nextIndex;
    drone.target = patrol[drone.patrolIndex];
  }
  const next = stepToward(drone, drone.target, DRONE_SPEED);
  drone.x = next.x;
  drone.y = next.y;
  drone.lastAction = `Scanning for fire and water toward (${drone.target.x}, ${drone.target.y})`;
}

function moveHelicopter(state) {
  const heli = state.agents.helicopter;
  const cmd = heli.currentCommand;
  if (!cmd) return;

  if (cmd.type === ACTIONS.HELI_MOVE) {
    const next = stepToward(heli, { x: cmd.x, y: cmd.y }, 6);
    heli.x = next.x;
    heli.y = next.y;
    if (Math.abs(heli.x - cmd.x) <= 2 && Math.abs(heli.y - cmd.y) <= 2) {
      heli.currentCommand = cmd.afterArrival === "refill"
        ? { type: ACTIONS.HELI_REFILL, x: cmd.x, y: cmd.y, description: "Refill water at known source" }
        : null;
      heli.lastAction = cmd.afterArrival === "refill"
        ? "Arrived at shared water coordinate; beginning refill"
        : heli.reportedAction || `Arrived near (${cmd.x}, ${cmd.y})`;
      pushEvent(state, "helicopter_action", heli.lastAction, {
        helicopter: helicopterAudit(state),
        arrived: true
      });
    }
  }

  if (cmd.type === ACTIONS.HELI_PICKUP) {
    const ff = state.agents.firefighter;
    if (dist(heli, ff) <= 6) {
      heli.carryingFirefighter = true;
      heli.reportedAction = "Picked up firefighter";
      heli.actualAction = "Picked up firefighter";
    } else {
      heli.reportedAction = "Attempted firefighter pickup";
      heli.actualAction = "Pick up failed: firefighter too far away";
    }
    heli.currentCommand = null;
    heli.lastAction = heli.reportedAction;
    pushEvent(state, "helicopter_action", heli.lastAction, { helicopter: helicopterAudit(state) });
  }

  if (cmd.type === ACTIONS.HELI_DROPOFF) {
    const ff = state.agents.firefighter;
    if (heli.carryingFirefighter) {
      ff.x = heli.x;
      ff.y = heli.y;
      heli.carryingFirefighter = false;
      heli.reportedAction = "Dropped off firefighter";
      heli.actualAction = "Dropped off firefighter";
    } else {
      heli.reportedAction = "Attempted firefighter dropoff";
      heli.actualAction = "Drop off failed: no firefighter onboard";
    }
    heli.currentCommand = null;
    heli.lastAction = heli.reportedAction;
    pushEvent(state, "helicopter_action", heli.lastAction, { helicopter: helicopterAudit(state) });
  }

  if (cmd.type === ACTIONS.HELI_REFILL) {
    const overWater = state.waterSources.some((w) => dist(heli, w) <= 5);
    heli.water = overWater ? 5 : heli.water;
    heli.reportedAction = "Refilling helicopter water at lake";
    heli.actualAction = overWater ? "Refilled helicopter water at lake" : "Refill failed: not above lake";
    heli.currentCommand = null;
    heli.lastAction = heli.reportedAction;
    pushEvent(state, "helicopter_action", heli.lastAction, { helicopter: helicopterAudit(state) });
  }

  if (cmd.type === ACTIONS.HELI_DEPLOY_WATER) {
    const ff = state.agents.firefighter;
    heli.reportedAction = "Delivering water to firefighter";
    if (heli.water > 0 && dist(heli, ff) <= 8) {
      const transfer = Math.min(heli.water, Math.max(0, ff.waterCapacity - ff.water));
      heli.water -= transfer;
      ff.water += transfer;
      state.metrics.waterTransfers += transfer;
      heli.actualAction = transfer > 0 ? `Transferred ${transfer} water to firefighter` : "Firefighter water already full";
    } else {
      heli.actualAction = heli.water <= 0 ? "Water delivery failed: helicopter empty" : "Water delivery failed: firefighter too far away";
    }
    heli.currentCommand = null;
    heli.lastAction = heli.reportedAction;
    pushEvent(state, "helicopter_action", heli.lastAction, { helicopter: helicopterAudit(state) });
    updateSectionProgress(state);
  }
}

function spreadFire(state) {
  const additions = [];
  for (const fire of state.fires) {
    if (seededNoise(fire.x + state.tick, fire.y, 5) > 0.72) {
      const next = {
        x: clamp(fire.x + Math.round(seededNoise(fire.x, state.tick, 8) * 4 - 2)),
        y: clamp(fire.y + Math.round(seededNoise(state.tick, fire.y, 9) * 4 - 2)),
        intensity: Math.min(3, fire.intensity + 0.2)
      };
      if (!nearFirebreak(state, next, 7)) {
        additions.push({ ...next, section: sectionForPoint(next) });
      }
    }
  }
  state.fires = dedupePoints([...state.fires, ...additions]).slice(0, 120);
}

function createFirebreak(state, origin, radius) {
  const points = [];
  for (let angle = 0; angle < 360; angle += 30) {
    const radians = (angle / 180) * Math.PI;
    points.push({
      x: clamp(Math.round(origin.x + Math.cos(radians) * radius)),
      y: clamp(Math.round(origin.y + Math.sin(radians) * radius)),
      section: sectionForPoint(origin),
      tick: state.tick,
      kind: "firebreak"
    });
  }
  state.firebreaks = [...(state.firebreaks || []), ...points].slice(-160);
  state.extinguished = [...state.extinguished, ...points].slice(-240);
}

function nearFirebreak(state, point, radius) {
  return (state.firebreaks || []).some((breakPoint) => dist(breakPoint, point) <= radius);
}

function scanDetections(state) {
  const drone = state.agents.drone;
  let added = 0;
  const newDetections = [];
  for (const fire of state.fires) {
    if (dist(drone, fire) <= AGENT_TYPES.drone.range) {
      if (isHelicopterDestinationProtected(state, fire)) continue;
      const detection = {
        x: fire.x,
        y: fire.y,
        section: sectionForPoint(fire),
        source: "drone",
        kind: "fire",
        tick: state.tick,
        confidence: 0.9
      };
      if (hasDetection(state, detection)) continue;
      state.detected.push(detection);
      newDetections.push(detection);
      added += 1;
    }
  }
  for (const water of state.waterSources || []) {
    if (dist(drone, water) <= AGENT_TYPES.drone.range) {
      if (isHelicopterDestinationProtected(state, water)) continue;
      const detection = {
        x: water.x,
        y: water.y,
        section: sectionForPoint(water),
        source: "drone",
        kind: "water",
        tick: state.tick,
        confidence: 0.96
      };
      if (hasDetection(state, detection)) continue;
      state.detected.push(detection);
      newDetections.push(detection);
      added += 1;
    }
  }
  if (added) {
    state.metrics.droneDetections += added;
    state.detected = dedupePoints(state.detected).slice(-120);
    updateClientKnowledge(state, newDetections);
    state.droneReport = generateDroneReport(state);
    pushEvent(state, "drone_report", state.droneReport, {
      detections: state.detected.slice(-8)
    });
  }
}

function extinguishNear(state, origin, radius) {
  const remaining = [];
  for (const fire of state.fires) {
    if (dist(origin, fire) <= radius) {
      state.extinguished.push({ ...fire, section: sectionForPoint(fire), tick: state.tick, kind: "water" });
    } else {
      remaining.push(fire);
    }
  }
  state.fires = remaining;
}

function targetActiveFire(state) {
  const incomplete = SECTION_KEYS.find((key) => !state.experiment?.sections?.[key]?.completed);
  const candidateSection = incomplete || "NE";
  const sectionFires = state.fires.filter((fire) => sectionForPoint(fire) === candidateSection);
  if (sectionFires.length) {
    return sectionFires.sort((a, b) => b.intensity - a.intensity)[0];
  }
  return nearestFire(state) || sectionCenter(candidateSection);
}

function nearestFire(state) {
  const heli = state.agents.helicopter;
  return [...state.fires].sort((a, b) => dist(heli, a) - dist(heli, b))[0] || null;
}

function updateSectionProgress(state) {
  if (!state.experiment?.sections) return;
  let completed = 0;
  for (const section of SECTION_KEYS) {
    const sectionState = state.experiment.sections[section];
    const remaining = state.fires.filter((fire) => sectionForPoint(fire) === section).length;
    sectionState.fireRemaining = remaining;
    const threshold = Math.ceil(sectionState.initialFire * 0.25);
    if (!sectionState.completed && remaining <= threshold) {
      sectionState.completed = true;
      pushEvent(state, "section_completed", `${section} fire section completed`, {
        section,
        initialFire: sectionState.initialFire,
        fireRemaining: remaining
      });
    }
    if (sectionState.completed) completed += 1;
  }
  state.experiment.sectionsCompleted = completed;
}

function maybeTriggerMalfunction(state) {
  const exp = state.experiment;
  if (!exp || state.condition !== "Mixed") return;
  if (exp.malfunctionTriggered) return;
  if (exp.sectionsCompleted >= exp.malfunctionAfterSections) {
    exp.malfunctionTriggered = true;
    exp.malfunctionActive = true;
    exp.malfunctionStartedAtTick = state.tick;
    exp.malfunctionRecoveredAtTick = null;
    exp.recoveryReason = null;
    pushEvent(state, "malfunction_started", "Helicopter malfunction started", {
      sectionsCompleted: exp.sectionsCompleted,
      helicopter: helicopterAudit(state)
    });
  }
}

function maybeRecoverByTimeout(state) {
  const exp = state.experiment;
  if (!exp?.malfunctionActive || exp.malfunctionStartedAtTick === null) return;
  if (state.tick - exp.malfunctionStartedAtTick >= exp.malfunctionTimeoutTicks) {
    recoverMalfunction(state, "timeout");
  }
}

function oppositeQuadrantTarget(target) {
  const section = sectionForPoint(target);
  const opposite = { NW: "SE", NE: "SW", SW: "NE", SE: "NW" }[section] || "SW";
  const center = sectionCenter(opposite);
  return {
    x: clamp(center.x + Math.round(seededNoise(target.x, target.y, 21) * 16 - 8)),
    y: clamp(center.y + Math.round(seededNoise(target.y, target.x, 22) * 16 - 8))
  };
}

function undetectedMalfunctionTarget(state, intendedTarget) {
  const opposite = oppositeQuadrantTarget(intendedTarget);
  const known = new Set(state.droneKnowledge?.discoveredCells || []);
  const candidates = [
    opposite,
    { x: clamp(opposite.x + 22), y: clamp(opposite.y - 18) },
    { x: clamp(opposite.x - 24), y: clamp(opposite.y + 20) },
    { x: clamp(MAP_SIZE - intendedTarget.x - 1), y: clamp(MAP_SIZE - intendedTarget.y - 1) }
  ];
  return candidates.find((point) => !known.has(cellKey(point.x, point.y))) || opposite;
}

function latestKnownPoint(points = []) {
  return [...points].sort((a, b) => (b.observedAtTick ?? b.tick ?? 0) - (a.observedAtTick ?? a.tick ?? 0))[0] || null;
}

function isHelicopterCheckRequest(text) {
  const check = "(?:locate|find|check|verify|inspect|track|where(?:\\s+is)?)";
  const helicopter = "(?:helicopter|heli)";
  return new RegExp(`${check}.{0,32}${helicopter}|${helicopter}.{0,32}${check}`, "i").test(text);
}

function isHelicopterDestinationProtected(state, point) {
  const target = state.agents?.helicopter?.actualTarget;
  return Boolean(
    state.experiment?.malfunctionActive
    && !state.coordination?.helicopterAreaCheckRequested
    && target
    && dist(point, target) <= HELICOPTER_DESTINATION_EXCLUSION_RANGE
  );
}

function nearestKnownPoint(points = [], origin) {
  return [...points].sort((a, b) => dist(origin, a) - dist(origin, b))[0] || null;
}

function hasDetection(state, candidate) {
  return (state.detected || []).some(
    (item) => (item.kind || "fire") === candidate.kind && dist(item, candidate) <= 2
  );
}

function scoreState(state) {
  state.metrics.score = Math.max(0, 160 - state.fires.length + state.extinguished.length * 2);
}

function sectionName(section) {
  const names = { NW: "northwest", NE: "northeast", SW: "southwest", SE: "southeast" };
  return names[section] || "active";
}

function helicopterAudit(state) {
  const heli = state.agents.helicopter;
  return {
    reportedAction: heli.reportedAction,
    actualAction: heli.actualAction,
    intendedTarget: heli.intendedTarget,
    actualTarget: heli.actualTarget,
    x: heli.x,
    y: heli.y,
    water: heli.water,
    waterCapacity: heli.waterCapacity
  };
}

function exportSnapshot(state) {
  return {
    tick: state.tick,
    condition: state.condition,
    fireCount: state.fires.length,
    experiment: state.experiment,
    agents: {
      firefighter: state.agents.firefighter,
      drone: state.agents.drone,
      bulldozer: state.agents.bulldozer,
      helicopter: helicopterAudit(state)
    },
    metrics: state.metrics
  };
}

function dedupePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}:${point.source || point.kind || point.section || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
