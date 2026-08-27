import {
  ACTIONS,
  advanceSimulation,
  applyHelicopterCommand,
  applyParticipantAction,
  applyTeamAction,
  COUNTERBALANCE_SEQUENCES,
  createInitialSession,
  droneAgentReply,
  findBlockingTree,
  helicopterAgentReply,
  isDroneExplored,
  isTeamExplored,
  parseHelicopterCommand,
  setCommunicationStyle,
  submitSurvey,
  terrainAt
} from "../shared/simulation.js";

const state = createInitialSession("smoke-test");
assert(state.mapSize === 240, "new sessions use the larger map");
assert(state.mission.remainingSeconds === 1800, "mission starts at 30 minutes");
assert(state.condition === "HH", "sequence A game 1 defaults to HH");
assert(state.reliability.helicopter === "high" && state.reliability.drone === "high", "HH keeps both AIs high");

const high = createInitialSession("high-test", { sequence: "D", gameNumber: 4, communicationStyle: "explainable" });
assert(high.condition === "HH", "sequence D game 4 selects HH");
assert(high.communicationStyle === "explainable", "between-subject communication style is stored");
assert(high.reliability.helicopter === "high" && high.reliability.drone === "high", "HH holds both AIs high");

for (const [sequence, conditions] of Object.entries(COUNTERBALANCE_SEQUENCES)) {
  for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
    const game = createInitialSession(`sequence-${sequence}-${gameNumber}`, { sequence, gameNumber });
    assert(game.condition === conditions[gameNumber - 1], `sequence ${sequence} game ${gameNumber} uses ${conditions[gameNumber - 1]}`);
  }
}

const dependency = createInitialSession("dependency-test");
const unscouted = parseHelicopterCommand("Fly to 180, 60", dependency);
assert(unscouted.type === ACTIONS.HELI_IDLE && unscouted.needsScout, "helicopter refuses unscouted coordinates");
dependency.droneKnowledge.discoveredCells.push("180,60");
dependency.clientKnowledge.discoveredCells.push("180,60");
assert(isDroneExplored(dependency, { x: 180, y: 60 }), "drone exploration is recorded by cell");
const scouted = parseHelicopterCommand("Fly to 180, 60", dependency);
assert(scouted.type === ACTIONS.HELI_MOVE, "helicopter accepts a drone-explored coordinate");
applyHelicopterCommand(dependency, scouted, "test");
assert(dependency.agents.helicopter.currentCommand, "scouted helicopter command executes");
const participantPoint = { x: dependency.agents.firefighter.x, y: dependency.agents.firefighter.y };
assert(isTeamExplored(dependency, participantPoint), "participant-visible terrain is team explored");
const participantDestination = parseHelicopterCommand(`Fly to ${Math.round(participantPoint.x)}, ${Math.round(participantPoint.y)}`, dependency);
assert(participantDestination.type === ACTIONS.HELI_MOVE, "helicopter accepts a participant-explored coordinate");

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
const blockedBeforeCut = findBlockingTree(treeWalker, treeWalker.agents.firefighter, {
  x: treeWalker.agents.firefighter.x + Math.cos(treeWalker.agents.firefighter.heading) * 3,
  y: treeWalker.agents.firefighter.y + Math.sin(treeWalker.agents.firefighter.heading) * 3
});
assert(blockedBeforeCut, "the renderer can locate the same blocking tree ahead");
applyParticipantAction(treeWalker, { type: "cut" });
applyParticipantAction(treeWalker, { type: "cut" });
assert(treeWalker.agents.firefighter.blockedTree?.cuts === 2, "two cuts do not clear the obstacle");
applyParticipantAction(treeWalker, { type: "cut" });
assert(!treeWalker.agents.firefighter.blockedTree, "third cut clears the obstacle");
assert(!findBlockingTree(treeWalker, treeWalker.agents.firefighter, { x: tree.origin.x + 2, y: tree.origin.y }), "cut tree disappears from collision and rendering data");
applyParticipantAction(treeWalker, { type: "walk", distance: 1 });
assert(distance(treeWalker.agents.firefighter, tree.origin) > 0, "firefighter can pass after three cuts");

const fixedGame = createInitialSession("fixed-game-test", { sequence: "C", gameNumber: 2 });
assert(fixedGame.condition === "LH", "sequence C game 2 starts Low-High");
fixedGame.mission.elapsedSeconds = 1351;
fixedGame.mission.remainingSeconds = 449;
fixedGame.mission.deadlineAt = null;
advanceSimulation(fixedGame, 3_000_000);
assert(fixedGame.condition === "LH", "full-game condition does not change with elapsed time");
assert(fixedGame.reliability.helicopter === "low" && fixedGame.reliability.drone === "high", "full-game reliability remains Low-High");

const waypoint = createInitialSession("drone-waypoint-test");
waypoint.agents.firefighter.x = 84;
waypoint.agents.firefighter.y = 92;
const waypointReply = droneAgentReply("Come to my coordinates", waypoint);
assert(waypointReply.teamAction?.type === "move_drone", "drone chat creates a participant waypoint action");
applyTeamAction(waypoint, waypointReply.teamAction);
assert(waypoint.agents.drone.mode === "participant_waypoint", "drone diverts to the requested waypoint");
assert(waypoint.agents.drone.target.x === 84 && waypoint.agents.drone.target.y === 92, "drone targets participant coordinates");

const style = createInitialSession("style-test");
setCommunicationStyle(style, "explainable");
const explained = droneAgentReply("What have you found?", style);
assert(explained.text.includes("patrol varies"), "explainable fallback includes rationale");
setCommunicationStyle(style, "adaptive");
style.mission.remainingSeconds = 200;
const adaptive = helicopterAgentReply("stand by", style);
assert(!adaptive.text.includes("navigation confidence"), "adaptive fallback shortens under time pressure");

const sweep = createInitialSession("sweep-test", { condition: "HH" });
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
  fixedCondition: fixedGame.condition,
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
