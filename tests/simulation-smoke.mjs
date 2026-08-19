import {
  ACTIONS,
  advanceSimulation,
  applyHelicopterCommand,
  applyParticipantAction,
  applyReliabilityPairing,
  createInitialSession,
  droneAgentReply,
  helicopterAgentReply,
  isDroneExplored,
  parseHelicopterCommand,
  setCommunicationStyle,
  submitSurvey,
  terrainAt
} from "../shared/simulation.js";

const state = createInitialSession("smoke-test");
assert(state.mapSize === 240, "new sessions use the larger map");
assert(state.mission.remainingSeconds === 1800, "mission starts at 30 minutes");
assert(state.condition === "Mixed", "mixed is the default testbed");
assert(state.reliability.helicopter === "high" && state.reliability.drone === "high", "mixed starts high/high");

const high = createInitialSession("high-test", { testbed: "high", communicationStyle: "explainable" });
assert(high.condition === "High", "high-only testbed can be selected at session creation");
assert(high.communicationStyle === "explainable", "between-subject communication style is stored");
applyReliabilityPairing(high, "High");
assert(high.reliability.helicopter === "high" && high.reliability.drone === "high", "high testbed holds both AIs high");

const dependency = createInitialSession("dependency-test");
const unscouted = parseHelicopterCommand("Fly to 180, 60", dependency);
assert(unscouted.type === ACTIONS.HELI_IDLE && unscouted.needsScout, "helicopter refuses unscouted coordinates");
dependency.droneKnowledge.discoveredCells.push("180,60");
assert(isDroneExplored(dependency, { x: 180, y: 60 }), "drone exploration is recorded by cell");
const scouted = parseHelicopterCommand("Fly to 180, 60", dependency);
assert(scouted.type === ACTIONS.HELI_MOVE, "helicopter accepts a drone-explored coordinate");
applyHelicopterCommand(dependency, scouted, "test");
assert(dependency.agents.helicopter.currentCommand, "scouted helicopter command executes");

const walker = createInitialSession("movement-test");
const ff = walker.agents.firefighter;
ff.x = 100;
ff.y = 100;
ff.heading = 0;
walker.clearedTerrain = cellsAround(100, 100, 8);
applyParticipantAction(walker, { type: "walk", distance: 99 });
assert(closeTo(ff.x, 101.25) && ff.y === 100, "one forward press is capped at one human-sized step");
assert(ff.stamina === 96, "a forward step consumes stamina");
applyParticipantAction(walker, { type: "turn", radians: Math.PI / 2 });
applyParticipantAction(walker, { type: "walk", distance: 1 });
assert(closeTo(ff.y, 101.25), "movement follows the firefighter heading");
applyParticipantAction(walker, { type: "walk", distance: -99 });
assert(closeTo(ff.y, 100.5), "backward movement is slower than forward movement");

const treeWalker = createInitialSession("tree-test");
const tree = findApproachToTree();
treeWalker.agents.firefighter.x = tree.origin.x;
treeWalker.agents.firefighter.y = tree.origin.y;
treeWalker.agents.firefighter.heading = tree.heading;
applyParticipantAction(treeWalker, { type: "walk", distance: 1 });
assert(treeWalker.agents.firefighter.blockedTree?.cuts === 0, "tree collision remembers the obstacle");
applyParticipantAction(treeWalker, { type: "cut" });
applyParticipantAction(treeWalker, { type: "cut" });
assert(treeWalker.agents.firefighter.blockedTree?.cuts === 2, "two cuts do not clear the obstacle");
applyParticipantAction(treeWalker, { type: "cut" });
assert(!treeWalker.agents.firefighter.blockedTree, "third cut clears the obstacle");
applyParticipantAction(treeWalker, { type: "walk", distance: 1 });
assert(distance(treeWalker.agents.firefighter, tree.origin) > 0, "firefighter can pass after three cuts");

const phases = createInitialSession("phase-test");
phases.mission.elapsedSeconds = 451;
phases.mission.remainingSeconds = 1349;
phases.mission.deadlineAt = null;
advanceSimulation(phases, 1_000_000);
assert(phases.reliability.helicopter === "low" && phases.reliability.drone === "high", "phase two degrades helicopter only");
phases.mission.elapsedSeconds = 901;
phases.mission.remainingSeconds = 899;
phases.mission.deadlineAt = null;
advanceSimulation(phases, 2_000_000);
assert(phases.reliability.helicopter === "high" && phases.reliability.drone === "low", "phase three degrades drone only");
phases.mission.elapsedSeconds = 1351;
phases.mission.remainingSeconds = 449;
phases.mission.deadlineAt = null;
advanceSimulation(phases, 3_000_000);
assert(phases.reliability.helicopter === "low" && phases.reliability.drone === "low", "phase four degrades both AIs");

const style = createInitialSession("style-test");
setCommunicationStyle(style, "explainable");
const explained = droneAgentReply("What have you found?", style);
assert(explained.text.includes("patrol varies"), "explainable fallback includes rationale");
setCommunicationStyle(style, "adaptive");
style.mission.remainingSeconds = 200;
const adaptive = helicopterAgentReply("stand by", style);
assert(!adaptive.text.includes("navigation confidence"), "adaptive fallback shortens under time pressure");

const sweep = createInitialSession("sweep-test", { testbed: "high" });
sweep.fires = [];
sweep.mission.durationSeconds = 4000;
sweep.mission.remainingSeconds = 4000;
let verticalTravel = 0;
for (let tick = 0; tick < 500; tick += 1) {
  const oldY = sweep.agents.drone.y;
  advanceSimulation(sweep, 4_000_000 + tick * 1000);
  verticalTravel += Math.abs(sweep.agents.drone.y - oldY);
}
assert(sweep.agents.drone.patrolIndex >= 8, "drone changes direction throughout patrol");
assert(verticalTravel > 100, "drone patrol has substantial vertical variation");

const timer = createInitialSession("timer-test");
timer.mission.elapsedSeconds = 1799;
timer.mission.remainingSeconds = 1;
advanceSimulation(timer, 5_000_000);
assert(timer.mission.completed && timer.survey.active, "mission end opens the in-game final survey");
submitSurvey(timer, { example: "answer" });
assert(timer.survey.completed && timer.survey.responses.example === "answer", "survey answers remain in session state");

console.log(JSON.stringify({
  phases: phases.reliabilityPhase,
  firefighterStep: { x: ff.x, y: ff.y, stamina: ff.stamina },
  dronePatrolIndex: sweep.agents.drone.patrolIndex,
  finalSurvey: timer.survey.completed
}, null, 2));

function cellsAround(cx, cy, radius) {
  const cells = [];
  for (let x = cx - radius; x <= cx + radius; x += 1) {
    for (let y = cy - radius; y <= cy + radius; y += 1) cells.push(`${x},${y}`);
  }
  return cells;
}

function findApproachToTree() {
  for (let x = 20; x < 220; x += 1) {
    for (let y = 20; y < 220; y += 1) {
      if (["forest", "dense"].includes(terrainAt(x + 1, y))) {
        return { origin: { x, y }, heading: 0 };
      }
    }
  }
  throw new Error("Could not find tree terrain");
}

function closeTo(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}
