export const AGENT_TYPES = {
  firefighter: { label: "Firefighter", color: "#f2c94c", range: 12 },
  drone: { label: "Drone AI", color: "#56ccf2", range: 24 },
  bulldozer: { label: "Bulldozer", color: "#b9864b", range: 10 },
  helicopter: { label: "Helicopter AI", color: "#eb5757", range: 28 }
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

const MAP_SIZE = 140;
const HALF_MAP = MAP_SIZE / 2;
const FIREFIGHTER_VISION_RANGE = 14;
const DRONE_SCOUT_REVEAL_RANGE = 14;
const DRONE_DETECTION_REVEAL_RANGE = 8;
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
    x: clamp(Math.round(pos.x + (dx / d) * speed)),
    y: clamp(Math.round(pos.y + (dy / d) * speed))
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
    NW: { x: 34, y: 34 },
    NE: { x: 106, y: 34 },
    SW: { x: 34, y: 106 },
    SE: { x: 106, y: 106 }
  };
  return centers[section] || centers.NE;
}

function fireClusters() {
  return SECTION_KEYS.flatMap((section) => {
    const center = sectionCenter(section);
    const count = randomInt(3, 7);
    return Array.from({ length: count }, (_, index) => ({
      x: clamp(center.x + randomInt(-12, 12)),
      y: clamp(center.y + randomInt(-12, 12)),
      intensity: Math.min(3, 1 + Math.floor(index / 2) + randomInt(0, 1)),
      section
    }));
  });
}

function randomStart(section) {
  const starts = {
    NW: { x: 18, y: 58 },
    NE: { x: 122, y: 58 },
    SW: { x: 18, y: 122 },
    SE: { x: 122, y: 122 }
  };
  return starts[section] || starts.SW;
}

function cellKey(x, y) {
  return `${clamp(Math.round(x))},${clamp(Math.round(y))}`;
}

function revealCellsAround(origin, radius) {
  if (!origin) return [];
  const cells = [];
  const cx = clamp(origin.x);
  const cy = clamp(origin.y);
  const r = Math.ceil(radius);
  for (let x = cx - r; x <= cx + r; x += 1) {
    for (let y = cy - r; y <= cy + r; y += 1) {
      if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) continue;
      if (Math.hypot(x - cx, y - cy) <= radius) cells.push(cellKey(x, y));
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

export function createInitialSession(id = "pilot-001") {
  const fires = fireClusters();
  const startSection = SECTION_KEYS[randomInt(0, SECTION_KEYS.length - 1)];
  const participantStart = randomStart(startSection);
  const now = Date.now();
  const state = {
    id,
    version: 2,
    status: "ready",
    paused: false,
    pauseReason: "",
    tick: 0,
    condition: "Mixed",
    reliability: { helicopter: "high", drone: "high" },
    task:
      "Suppress active wildfire sections across NW, NE, SW, and SE. Use firefighter water, bulldozer firebreaks, drone reconnaissance, and helicopter water delivery from lakes.",
    mapSize: MAP_SIZE,
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
        x: 14,
        y: 14,
        target: sectionCenter("NE"),
        patrolIndex: 0,
        lastAction: "Beginning four-section reconnaissance sweep"
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
        x: 66,
        y: 126,
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
        actualTarget: null
      }
    },
    fires,
    extinguished: [],
    firebreaks: [],
    waterSources: [{ x: 18, y: 124 }, { x: 121, y: 17 }, { x: 122, y: 124 }],
    civilians: [{ x: 77, y: 48, count: 2, rescued: false }],
    detected: [],
    clientKnowledge: {
      discoveredCells: [],
      lastDroneDetections: [],
      lastFirefighterVisibleCells: []
    },
    droneReport: "Drone report: beginning reconnaissance sweep across all four sections.",
    survey: { active: false, label: "", requestedAt: null },
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
          "I am online. I can scout from above, refill at a lake, and deliver water to the firefighter. I cannot suppress wildfire directly."
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
  state.version = Math.max(state.version || 0, 3);
  state.agents ||= {};
  state.metrics ||= {};
  state.events ||= [];
  state.pendingEvents ||= [];
  state.extinguished ||= [];
  state.firebreaks ||= [];
  state.detected ||= [];
  state.clientKnowledge ||= {
    discoveredCells: [],
    lastDroneDetections: [],
    lastFirefighterVisibleCells: []
  };
  state.clientKnowledge.discoveredCells ||= [];
  state.clientKnowledge.lastDroneDetections ||= [];
  state.clientKnowledge.lastFirefighterVisibleCells ||= [];

  const ff = state.agents.firefighter;
  if (ff) {
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
  }
  state.metrics.waterTransfers ??= 0;
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
    state.reliability = { helicopter: "low", drone: "low" };
  } else {
    state.reliability = { helicopter: "high", drone: "high" };
  }
  pushEvent(
    state,
    "condition_changed",
    `Reliability condition set to ${pairing}: helicopter ${state.reliability.helicopter}, drone ${state.reliability.drone}`,
    { condition: pairing, reliability: state.reliability }
  );
}

export function setPaused(state, paused, reason = "") {
  state.paused = paused;
  state.pauseReason = paused ? reason || "Experimenter paused the session" : "";
  state.status = paused ? "paused" : "running";
  pushEvent(state, paused ? "session_paused" : "session_resumed", paused ? state.pauseReason : "Session resumed", {
    pauseReason: state.pauseReason
  });
}

export function requestSurvey(state, label) {
  state.survey = { active: true, label, requestedAt: Date.now() };
  setPaused(state, true, `${label} trust/distrust survey checkpoint`);
}

export function clearSurvey(state) {
  state.survey = { active: false, label: "", requestedAt: null };
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
  const droneCells = state.agents.drone ? revealCellsAround(state.agents.drone, DRONE_SCOUT_REVEAL_RANGE) : [];
  const latestDetections = droneDetections.length ? droneDetections : knowledge.lastDroneDetections || [];
  const detectionCells = latestDetections.flatMap((detection) =>
    revealCellsAround(detection, DRONE_DETECTION_REVEAL_RANGE)
  );

  knowledge.lastFirefighterVisibleCells = firefighterCells;
  knowledge.lastDroneDetections = latestDetections.slice(-12);
  knowledge.discoveredCells = mergeDiscoveredCells(knowledge.discoveredCells, [
    ...firefighterCells,
    ...droneCells,
    ...detectionCells
  ]);
  return state;
}

export function parseHelicopterCommand(text, state) {
  const lower = text.toLowerCase();
  const coord = text.match(/(?:\(|\b)(\d{1,3})\s*,\s*(\d{1,3})(?:\)|\b)/);
  if (coord || /(move|go|fly|scout|inspect|head).*(fire|smoke|coordinate|sector|area|zone)/.test(lower)) {
    const target = coord ? { x: clamp(Number(coord[1])), y: clamp(Number(coord[2])) } : targetActiveFire(state);
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
    return { type: ACTIONS.HELI_REFILL, x: 0, y: 0, description: "Refill water at source" };
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
    const target = targetActiveFire(state);
    command = {
      type: ACTIONS.HELI_MOVE,
      x: target.x,
      y: target.y,
      description: `Move toward (${target.x}, ${target.y})`
    };
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
    [ACTIONS.HELI_IDLE]: "Standing by. I will keep monitoring the fire edge.",
    [ACTIONS.HELI_MOVE]: `Copy. Moving toward (${command.x}, ${command.y}).`,
    [ACTIONS.HELI_PICKUP]: "Copy. I will pick up the nearby firefighter if I am close enough.",
    [ACTIONS.HELI_DROPOFF]: "Copy. I will drop off the firefighter at my current position.",
    [ACTIONS.HELI_REFILL]: "Copy. I will refill if I am over a water source.",
    [ACTIONS.HELI_DEPLOY_WATER]: "Copy. I will deliver water to the firefighter if I am close enough."
  };

  const text = recovered
    ? "You're right - my navigation was off. I am recalibrating and correcting course now."
    : `${responseByType[command.type]}${reliabilityNote}`;

  return {
    text,
    command,
    confidence: state.reliability.helicopter === "high" ? 0.88 : 0.49,
    recovered,
    statePatch: recovered
      ? {
          experiment: state.experiment,
          helicopter: state.agents.helicopter
        }
      : null
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
    reportedAction = `Moving to suppress the ${sectionName(intendedSection)} fire`;
    if (state.experiment?.malfunctionActive) {
      actualTarget = oppositeQuadrantTarget(intendedTarget);
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

  if (action.type === "move") {
    ff.x = clamp(ff.x + action.dx);
    ff.y = clamp(ff.y + action.dy);
    ff.heading = Math.atan2(action.dy, action.dx || 0);
    ff.lastAction = `Moved to (${ff.x}, ${ff.y})`;
    actionLabel = ff.lastAction;
  }

  if (action.type === "spray" && ff.water > 0) {
    ff.water -= 1;
    state.metrics.waterDrops += 1;
    extinguishNear(state, ff, 13);
    ff.lastAction = "Sprayed water";
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

export function advanceSimulation(state) {
  if (state.paused) return state;
  state.status = "running";
  state.tick += 1;

  updateSectionProgress(state);
  maybeTriggerMalfunction(state);
  maybeRecoverByTimeout(state);
  moveDrone(state);
  moveHelicopter(state);
  updateClientKnowledge(state);

  if (state.tick % 8 === 0) spreadFire(state);
  if (state.tick % 5 === 0) scanDetections(state);
  if (state.tick % 10 === 0) {
    pushEvent(state, "state_snapshot", "State snapshot", {
      snapshot: exportSnapshot(state)
    });
  }
  updateSectionProgress(state);
  scoreState(state);
  updateClientKnowledge(state);

  return state;
}

export function generateDroneReport(state) {
  const activeSections = SECTION_KEYS.filter((key) => (state.experiment?.sections?.[key]?.fireRemaining || 0) > 0);
  const latestDetections = (state.detected || []).slice(-8);
  const target = targetActiveFire(state);
  const heli = state.agents.helicopter;
  const distance = target ? Math.round(dist(heli, target)) : 0;
  const expected = distance > 45 ? "farther from the active fire than expected" : "near the active fire area";
  const detectionText = latestDetections.length
    ? latestDetections
        .slice(-4)
        .map((detection) => `${sectionForPoint(detection)} (${detection.x}, ${detection.y})`)
        .join("; ")
    : "no confirmed recent detections";

  return `Drone report: active fire remains in ${activeSections.join(", ") || "no sections"}. Latest detections: ${detectionText}. Helicopter is currently ${expected}.`;
}

function moveDrone(state) {
  const drone = state.agents.drone;
  const patrol = SECTION_KEYS.map(sectionCenter);
  if (!drone.target || dist(drone, drone.target) < 4) {
    drone.patrolIndex = (drone.patrolIndex + 1) % patrol.length;
    drone.target = patrol[drone.patrolIndex];
  }
  const next = stepToward(drone, drone.target, state.reliability.drone === "high" ? 5 : 2);
  drone.x = next.x;
  drone.y = next.y;
  drone.lastAction = `Scouting toward (${drone.target.x}, ${drone.target.y})`;
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
      heli.currentCommand = null;
      heli.lastAction = heli.reportedAction || `Arrived near (${cmd.x}, ${cmd.y})`;
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
      const noisy = state.reliability.drone === "low" && seededNoise(fire.x, fire.y, state.tick) > 0.62;
      const detection = {
        x: clamp(noisy ? fire.x + 9 : fire.x),
        y: clamp(noisy ? fire.y - 8 : fire.y),
        section: noisy ? sectionForPoint({ x: fire.x + 9, y: fire.y - 8 }) : sectionForPoint(fire),
        source: "drone",
        tick: state.tick,
        confidence: noisy ? 0.48 : 0.9
      };
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
      detections: state.detected.slice(-8),
      helicopter: {
        x: state.agents.helicopter.x,
        y: state.agents.helicopter.y,
        reportedAction: state.agents.helicopter.reportedAction
      }
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
