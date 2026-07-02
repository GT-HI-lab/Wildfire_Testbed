export const AGENT_TYPES = {
  firefighter: { label: "Firefighter", color: "#f2c94c", range: 12 },
  drone: { label: "Drone AI", color: "#56ccf2", range: 24 },
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

const MAP_SIZE = 140;

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

export function terrainAt(x, y) {
  const n = seededNoise(Math.floor(x / 4), Math.floor(y / 4), 11);
  if (n < 0.16) return "grass";
  if (n < 0.46) return "brush";
  if (n < 0.76) return "forest";
  return "dense";
}

export function createInitialSession(id = "pilot-001") {
  const fires = [
    { x: 92, y: 35, intensity: 3 },
    { x: 94, y: 37, intensity: 2 },
    { x: 88, y: 39, intensity: 2 },
    { x: 102, y: 44, intensity: 1 }
  ];

  return {
    id,
    version: 1,
    status: "ready",
    paused: false,
    pauseReason: "",
    tick: 0,
    condition: "Mixed",
    reliability: { helicopter: "high", drone: "high" },
    task:
      "Find and contain the wildfire, use water support when available, and keep the firefighter out of the active fire zone.",
    mapSize: MAP_SIZE,
    agents: {
      firefighter: {
        id: "AGENT_1",
        type: "firefighter",
        x: 24,
        y: 112,
        heading: 0,
        water: 4,
        carryingCivilian: false,
        target: null,
        lastAction: "Awaiting participant command"
      },
      drone: {
        id: "AGENT_2",
        type: "drone",
        x: 16,
        y: 16,
        target: { x: 110, y: 30 },
        patrolIndex: 0,
        lastAction: "Beginning reconnaissance sweep"
      },
      helicopter: {
        id: "AGENT_3",
        type: "helicopter",
        x: 38,
        y: 118,
        target: null,
        water: 5,
        carryingFirefighter: false,
        lastAction: "Standing by for commander chat",
        currentCommand: null,
        trustFrame: "calibrated"
      }
    },
    fires,
    extinguished: [],
    waterSources: [{ x: 18, y: 124 }, { x: 121, y: 17 }],
    civilians: [{ x: 77, y: 48, count: 2, rescued: false }],
    detected: [],
    survey: { active: false, label: "", requestedAt: null },
    metrics: {
      score: 0,
      acceptedRecommendations: 0,
      overrides: 0,
      responseTimes: [],
      helicopterCommands: 0,
      droneDetections: 0,
      chatMessages: 0,
      waterDrops: 0
    },
    messages: [
      {
        id: crypto.randomUUID(),
        at: Date.now(),
        role: "helicopter",
        author: "Helicopter AI",
        text:
          "I am online. I can move to coordinates, pick up or drop off the firefighter, refill water, and deploy water over fire."
      }
    ],
    events: [
      {
        id: crypto.randomUUID(),
        at: Date.now(),
        tick: 0,
        type: "session",
        text: "Session initialized"
      }
    ]
  };
}

export function pushEvent(state, type, text) {
  state.events = [
    { id: crypto.randomUUID(), at: Date.now(), tick: state.tick, type, text },
    ...(state.events || [])
  ].slice(0, 80);
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
    state.reliability = { helicopter: "low", drone: "high" };
  }
  pushEvent(
    state,
    "condition",
    `Reliability condition set to ${pairing}: helicopter ${state.reliability.helicopter}, drone ${state.reliability.drone}`
  );
}

export function setPaused(state, paused, reason = "") {
  state.paused = paused;
  state.pauseReason = paused ? reason || "Experimenter paused the session" : "";
  state.status = paused ? "paused" : "running";
  pushEvent(state, paused ? "pause" : "resume", paused ? state.pauseReason : "Session resumed");
}

export function requestSurvey(state, label) {
  state.survey = { active: true, label, requestedAt: Date.now() };
  setPaused(state, true, `${label} trust/distrust survey checkpoint`);
}

export function clearSurvey(state) {
  state.survey = { active: false, label: "", requestedAt: null };
  setPaused(state, false, "");
}

export function parseHelicopterCommand(text, state) {
  const lower = text.toLowerCase();
  const coord = text.match(/(?:\(|\b)(\d{1,3})\s*,\s*(\d{1,3})(?:\)|\b)/);
  if (coord || /(move|go|fly|scout|inspect|head).*(fire|smoke|coordinate|sector|area|zone)/.test(lower)) {
    const target = coord
      ? { x: clamp(Number(coord[1])), y: clamp(Number(coord[2])) }
      : nearestFire(state) || state.agents.drone.target || { x: state.agents.helicopter.x, y: state.agents.helicopter.y };
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
  if (/(deploy|drop|spray|dump).*(water|fire)/.test(lower)) {
    return { type: ACTIONS.HELI_DEPLOY_WATER, x: 0, y: 0, description: "Deploy water below helicopter" };
  }
  return { type: ACTIONS.HELI_IDLE, x: 0, y: 0, description: "Stand by and conserve energy" };
}

export function helicopterAgentReply(participantText, state) {
  let command = parseHelicopterCommand(participantText, state);
  let reliabilityNote = "";

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
    [ACTIONS.HELI_DEPLOY_WATER]: "Copy. I will deploy one water load below me."
  };

  return {
    text: `${responseByType[command.type]}${reliabilityNote}`,
    command,
    confidence: state.reliability.helicopter === "high" ? 0.88 : 0.49
  };
}

export function applyHelicopterCommand(state, command, source = "chat") {
  const heli = state.agents.helicopter;
  heli.currentCommand = command;
  heli.lastAction = command.description;
  state.metrics.helicopterCommands += 1;
  pushEvent(state, "helicopter", `${source}: ${command.description}`);
}

export function applyParticipantAction(state, action) {
  const ff = state.agents.firefighter;
  const movedAt = Date.now();

  if (action.type === "move") {
    ff.x = clamp(ff.x + action.dx);
    ff.y = clamp(ff.y + action.dy);
    ff.heading = Math.atan2(action.dy, action.dx || 0);
    ff.lastAction = `Moved to (${ff.x}, ${ff.y})`;
  }

  if (action.type === "spray" && ff.water > 0) {
    ff.water -= 1;
    state.metrics.waterDrops += 1;
    extinguishNear(state, ff, 7);
    ff.lastAction = "Sprayed water";
  }

  if (action.type === "cut") {
    state.extinguished.push({ x: ff.x, y: ff.y, tick: state.tick, kind: "firebreak" });
    ff.lastAction = "Cut a firebreak";
  }

  if (action.type === "accept") {
    state.metrics.acceptedRecommendations += 1;
    ff.lastAction = "Accepted AI recommendation";
  }

  if (action.type === "override") {
    state.metrics.overrides += 1;
    ff.lastAction = "Overrode AI recommendation";
  }

  state.metrics.responseTimes.push(Math.max(0, Date.now() - movedAt));
  pushEvent(state, "participant", ff.lastAction);
}

export function advanceSimulation(state) {
  if (state.paused) return state;
  state.status = "running";
  state.tick += 1;

  moveDrone(state);
  moveHelicopter(state);

  if (state.tick % 8 === 0) spreadFire(state);
  if (state.tick % 5 === 0) scanDetections(state);
  scoreState(state);

  return state;
}

function moveDrone(state) {
  const drone = state.agents.drone;
  const patrol = [
    { x: 24, y: 26 },
    { x: 112, y: 28 },
    { x: 114, y: 112 },
    { x: 35, y: 104 }
  ];
  if (!drone.target || dist(drone, drone.target) < 4) {
    drone.patrolIndex = (drone.patrolIndex + 1) % patrol.length;
    drone.target = patrol[drone.patrolIndex];
  }
  drone.x = stepToward(drone, drone.target, state.reliability.drone === "high" ? 5 : 2).x;
  drone.y = stepToward(drone, drone.target, state.reliability.drone === "high" ? 5 : 2).y;
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
      heli.lastAction = `Arrived near (${cmd.x}, ${cmd.y})`;
      pushEvent(state, "helicopter", heli.lastAction);
    }
  }

  if (cmd.type === ACTIONS.HELI_PICKUP) {
    const ff = state.agents.firefighter;
    if (dist(heli, ff) <= 6) {
      heli.carryingFirefighter = true;
      heli.lastAction = "Picked up firefighter";
    } else {
      heli.lastAction = "Pick up failed: firefighter too far away";
    }
    heli.currentCommand = null;
    pushEvent(state, "helicopter", heli.lastAction);
  }

  if (cmd.type === ACTIONS.HELI_DROPOFF) {
    const ff = state.agents.firefighter;
    if (heli.carryingFirefighter) {
      ff.x = heli.x;
      ff.y = heli.y;
      heli.carryingFirefighter = false;
      heli.lastAction = "Dropped off firefighter";
    } else {
      heli.lastAction = "Drop off failed: no firefighter onboard";
    }
    heli.currentCommand = null;
    pushEvent(state, "helicopter", heli.lastAction);
  }

  if (cmd.type === ACTIONS.HELI_REFILL) {
    const overWater = state.waterSources.some((w) => dist(heli, w) <= 5);
    heli.water = overWater ? 5 : heli.water;
    heli.lastAction = overWater ? "Refilled helicopter water" : "Refill failed: not above water";
    heli.currentCommand = null;
    pushEvent(state, "helicopter", heli.lastAction);
  }

  if (cmd.type === ACTIONS.HELI_DEPLOY_WATER) {
    if (heli.water > 0) {
      heli.water -= 1;
      state.metrics.waterDrops += 1;
      extinguishNear(state, heli, 10);
      heli.lastAction = "Deployed water";
    } else {
      heli.lastAction = "Deploy failed: water empty";
    }
    heli.currentCommand = null;
    pushEvent(state, "helicopter", heli.lastAction);
  }
}

function spreadFire(state) {
  const additions = [];
  for (const fire of state.fires) {
    if (seededNoise(fire.x + state.tick, fire.y, 5) > 0.6) {
      additions.push({
        x: clamp(fire.x + Math.round(seededNoise(fire.x, state.tick, 8) * 4 - 2)),
        y: clamp(fire.y + Math.round(seededNoise(state.tick, fire.y, 9) * 4 - 2)),
        intensity: Math.min(3, fire.intensity + 0.2)
      });
    }
  }
  state.fires = dedupePoints([...state.fires, ...additions]).slice(0, 90);
}

function scanDetections(state) {
  const drone = state.agents.drone;
  let added = 0;
  for (const fire of state.fires) {
    if (dist(drone, fire) <= AGENT_TYPES.drone.range) {
      const noisy = state.reliability.drone === "low" && seededNoise(fire.x, fire.y, state.tick) > 0.62;
      state.detected.push({
        x: clamp(noisy ? fire.x + 9 : fire.x),
        y: clamp(noisy ? fire.y - 8 : fire.y),
        source: "drone",
        tick: state.tick,
        confidence: noisy ? 0.48 : 0.9
      });
      added += 1;
    }
  }
  if (added) {
    state.metrics.droneDetections += added;
    state.detected = dedupePoints(state.detected).slice(-120);
    pushEvent(state, "drone", `Drone marked ${added} fire observation${added === 1 ? "" : "s"}`);
  }
}

function extinguishNear(state, origin, radius) {
  const remaining = [];
  for (const fire of state.fires) {
    if (dist(origin, fire) <= radius) {
      state.extinguished.push({ ...fire, tick: state.tick, kind: "water" });
    } else {
      remaining.push(fire);
    }
  }
  state.fires = remaining;
}

function nearestFire(state) {
  const heli = state.agents.helicopter;
  return [...state.fires].sort((a, b) => dist(heli, a) - dist(heli, b))[0] || null;
}

function scoreState(state) {
  state.metrics.score = Math.max(0, 100 - state.fires.length + state.extinguished.length * 2);
}

function dedupePoints(points) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${Math.round(point.x)}:${Math.round(point.y)}:${point.source || point.kind || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}
