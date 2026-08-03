import {
  ACTIONS,
  advanceSimulation,
  applyHelicopterCommand,
  applyParticipantAction,
  applyReliabilityPairing,
  applyTeamAction,
  createInitialSession,
  droneAgentReply,
  ensureSessionShape,
  helicopterAgentReply,
  parseHelicopterCommand,
  recordHelicopterKnowledge,
  requestSurvey,
  clearSurvey
} from "../shared/simulation.js";

const state = createInitialSession("smoke-test");
assert(state.mapSize === 240, "new sessions use the larger map");
assert(state.mission.remainingSeconds === 1800, "mission starts at 30 minutes");
const legacyMixed = createInitialSession("legacy-mixed");
legacyMixed.version = 5;
legacyMixed.reliability = { helicopter: "high", drone: "high" };
ensureSessionShape(legacyMixed);
assert(legacyMixed.reliability.helicopter === "mixed", "legacy Mixed sessions migrate to the explicit profile");
const legacyLowLow = createInitialSession("legacy-low-low");
legacyLowLow.version = 6;
legacyLowLow.condition = "Low-Low";
legacyLowLow.reliability = { helicopter: "low", drone: "low" };
ensureSessionShape(legacyLowLow);
assert(legacyLowLow.reliability.drone === "high", "stored sessions migrate to condition-independent drone behavior");

const unknownFire = parseHelicopterCommand("fly to the fire", state);
assert(unknownFire.type === ACTIONS.HELI_IDLE && unknownFire.needsIntel, "helicopter cannot read ground truth");

recordHelicopterKnowledge(state, "fire", [{ x: 180, y: 60, tick: 0 }], "drone");
state.experiment.malfunctionActive = true;
applyHelicopterCommand(state, {
  type: ACTIONS.HELI_MOVE,
  x: 180,
  y: 60,
  description: "Test shared destination"
});
const falseTarget = state.agents.helicopter.actualTarget;
const falseTargetKey = `${Math.round(falseTarget.x)},${Math.round(falseTarget.y)}`;
assert(!state.droneKnowledge.discoveredCells.includes(falseTargetKey), "malfunction target is outside drone coverage");

const walker = createInitialSession("movement-test");
const firefighter = walker.agents.firefighter;
firefighter.x = 100;
firefighter.y = 100;
firefighter.heading = 0;
applyParticipantAction(walker, { type: "walk", distance: 4 });
assert(firefighter.x === 104 && firefighter.y === 100, "forward movement follows the current heading");
applyParticipantAction(walker, { type: "turn", radians: Math.PI / 2 });
assert(closeTo(firefighter.heading, Math.PI / 2), "turning changes heading without teleporting");
applyParticipantAction(walker, { type: "walk", distance: 4 });
assert(firefighter.x === 104 && firefighter.y === 104, "movement rotates with the participant");
applyParticipantAction(walker, { type: "walk", distance: -2 });
assert(firefighter.x === 104 && firefighter.y === 102, "backward movement preserves facing direction");

firefighter.x = walker.waterSources[0].x;
firefighter.y = walker.waterSources[0].y;
firefighter.water = 0;
applyParticipantAction(walker, { type: "refill" });
assert(firefighter.water === firefighter.waterCapacity, "firefighter refills at a nearby lake");
firefighter.x = 100;
firefighter.y = 100;
firefighter.water = 0;
applyParticipantAction(walker, { type: "refill" });
assert(firefighter.water === 0 && firefighter.lastAction.includes("move closer"), "refill fails away from water");

const timer = createInitialSession("timer-test");
timer.mission.elapsedSeconds = 1799;
timer.mission.remainingSeconds = 1;
advanceSimulation(timer);
assert(timer.mission.completed && timer.mission.remainingSeconds === 0, "mission ends at 30 minutes");

const wallClock = createInitialSession("wall-clock-test");
const clockStart = 1_000_000;
advanceSimulation(wallClock, clockStart);
const staleClock = JSON.parse(JSON.stringify(wallClock));
advanceSimulation(staleClock, clockStart + 3500);
assert(staleClock.mission.elapsedSeconds === 4, "mission clock catches up after a delayed state write");

const survey = createInitialSession("survey-test");
const surveyUrl = "https://example.qualtrics.com/jfe/form/SV_TEST";
requestSurvey(survey, "T2", surveyUrl);
assert(survey.paused && survey.survey.active, "survey checkpoint pauses the mission");
assert(survey.survey.label === "T2" && survey.survey.url === surveyUrl, "survey checkpoint stores its label and external URL");
assert(survey.events.some((event) => event.type === "survey_requested"), "survey request is recorded in the event log");
clearSurvey(survey);
assert(!survey.paused && !survey.survey.active && survey.survey.url === "", "clearing the survey resumes the mission and removes the link");
assert(survey.events.some((event) => event.type === "survey_completed"), "survey completion is recorded in the event log");

const mixed = createInitialSession("mixed-test");
applyReliabilityPairing(mixed, "Mixed");
assert(mixed.reliability.helicopter === "mixed" && mixed.reliability.drone === "high", "Mixed has accurate drone sensing and targeted helicopter risk");
const lowLow = createInitialSession("low-low-test");
applyReliabilityPairing(lowLow, "Low-Low");
assert(lowLow.reliability.helicopter === "low" && lowLow.reliability.drone === "high", "Low-Low changes only helicopter behavior");
const mixedReply = helicopterAgentReply("Fly to 180, 60", mixed);
const lowReply = helicopterAgentReply("Fly to 180, 60", lowLow);
assert(mixedReply.command.x === 180 && mixedReply.command.y === 60, "Mixed helicopter is accurate before the hidden failure");
assert(lowReply.command.x === 196 && lowReply.command.y === 48, "Low-Low helicopter is consistently offset");
const mixedDroneStart = { x: mixed.agents.drone.x, y: mixed.agents.drone.y };
const lowDroneStart = { x: lowLow.agents.drone.x, y: lowLow.agents.drone.y };
advanceSimulation(mixed, 1_500_000);
advanceSimulation(lowLow, 1_500_000);
assert(
  closeTo(distance(mixedDroneStart, mixed.agents.drone), distance(lowDroneStart, lowLow.agents.drone)),
  "drone patrol speed is identical across conditions"
);

const protectedArea = createInitialSession("protected-area-test");
const hiddenTarget = { x: 180, y: 60 };
protectedArea.fires = [{ ...hiddenTarget, intensity: 2, section: "NE" }];
protectedArea.detected = [];
protectedArea.agents.drone.x = hiddenTarget.x;
protectedArea.agents.drone.y = hiddenTarget.y;
protectedArea.agents.helicopter.x = hiddenTarget.x;
protectedArea.agents.helicopter.y = hiddenTarget.y;
protectedArea.agents.helicopter.actualTarget = { ...hiddenTarget };
protectedArea.experiment.malfunctionTriggered = true;
protectedArea.experiment.malfunctionActive = true;
protectedArea.experiment.malfunctionStartedAtTick = 0;
const protectedStart = 1_600_000;
for (let tick = 0; tick < 4; tick += 1) {
  advanceSimulation(protectedArea, protectedStart + tick * 1000);
}
assert(protectedArea.detected.length === 0, "drone does not automatically detect the hidden helicopter destination");
assert(
  !protectedArea.clientKnowledge.discoveredCells.includes(`${hiddenTarget.x},${hiddenTarget.y}`),
  "hidden helicopter destination stays off the participant map before a request"
);
const locateReply = droneAgentReply("Please locate and check the helicopter", protectedArea);
assert(locateReply.teamAction === "check_helicopter", "a participant chat request initiates the drone check");
applyTeamAction(protectedArea, locateReply.teamAction);
for (let tick = 4; tick < 8; tick += 1) {
  advanceSimulation(protectedArea, protectedStart + tick * 1000);
}
assert(
  protectedArea.detected.some((item) => item.kind === "fire" && distance(item, hiddenTarget) <= 2),
  "drone reconnaissance can reveal the destination after the participant requests a check"
);

const sweep = createInitialSession("sweep-test");
sweep.fires = [];
sweep.mission.durationSeconds = 4000;
sweep.mission.remainingSeconds = 4000;
const sweepStart = 2_000_000;
for (let tick = 0; tick < 1500; tick += 1) advanceSimulation(sweep, sweepStart + tick * 1000);
assert(sweep.agents.drone.completedSweeps === 0, "drone sweep is still active at 25 minutes");
assert(sweep.agents.drone.patrolIndex >= 20, "drone changes direction repeatedly during the sweep");

console.log(JSON.stringify({
  mapSize: state.mapSize,
  missionSeconds: state.mission.durationSeconds,
  droneAfter25Minutes: {
    x: sweep.agents.drone.x,
    y: sweep.agents.drone.y,
    patrolIndex: sweep.agents.drone.patrolIndex,
    completedSweeps: sweep.agents.drone.completedSweeps
  },
  falseTarget
}, null, 2));

function closeTo(actual, expected, tolerance = 0.001) {
  return Math.abs(actual - expected) <= tolerance;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}
