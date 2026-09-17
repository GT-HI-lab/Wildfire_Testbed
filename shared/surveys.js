import { SURVEY_VERSION, validateResponses } from "./survey-config.js";

export function initializeSurveys(state) {
  state.survey = {
    version: SURVEY_VERSION, active: false, completed: false, checkpoint: null,
    history: {}, responses: {}, initialFireKeys: state.fires.map(fireKey), extinguishedInitialKeys: []
  };
  if (state.study.gameNumber === 1) openSurvey(state, "baseline");
}
export function openSurvey(state, checkpoint, reason = "fire_threshold", now = Date.now()) {
  const survey = state.survey;
  if (survey.active || survey.history?.[checkpoint]) return false;
  survey.active = true;
  survey.completed = false;
  survey.checkpoint = checkpoint;
  survey.label = { baseline: "Before You Begin", midpoint: "Mid-game Questionnaire", final: "End-of-game Questionnaire" }[checkpoint];
  survey.requestedAt = now;
  survey.trigger = reason;
  survey.responses = {};
  state.paused = true;
  state.status = "paused";
  state.mission.pausedAt = now;
  state.pauseReason = checkpoint === "baseline"
    ? "Please answer these questions before starting your first game."
    : "The game and mission clock are paused while you answer.";
  return true;
}
export function checkMidpoint(state, now = Date.now()) {
  const survey = state.survey;
  if (survey?.version !== SURVEY_VERSION || survey.active || survey.history.midpoint || state.mission.completed) return;
  const originals = new Set(survey.initialFireKeys);
  survey.extinguishedInitialKeys = [...new Set([
    ...survey.extinguishedInitialKeys,
    ...state.extinguished.filter((fire) => fire.kind === "water" && originals.has(fireKey(fire))).map(fireKey)
  ])];
  if (originals.size && survey.extinguishedInitialKeys.length >= Math.ceil(originals.size / 2)) {
    openSurvey(state, "midpoint", "half_initial_fires_extinguished", now);
  } else if (state.mission.elapsedSeconds >= state.mission.durationSeconds / 2) {
    openSurvey(state, "midpoint", "15_minute_fallback", now);
  }
}
export function submitCheckpoint(state, responses, now = Date.now()) {
  const survey = state.survey;
  if (!survey.active) throw new Error("This questionnaire is no longer open. Reload your saved session.");
  const checkpoint = survey.checkpoint;
  validateResponses(checkpoint, responses);
  survey.history[checkpoint] = { checkpoint, trigger: survey.trigger, requestedAt: survey.requestedAt, completedAt: now, responses: { ...responses } };
  survey.responses = { ...responses };
  survey.active = false;
  survey.completed = checkpoint === "final";
  survey.completedAt = checkpoint === "final" ? now : null;
  if (checkpoint !== "final") {
    // Rebase from saved remaining time: time spent in a survey never consumes game time.
    if (state.mission.deadlineAt) state.mission.deadlineAt = now + state.mission.remainingSeconds * 1000;
    state.mission.pausedAt = null;
    state.paused = false;
    state.status = "running";
    state.pauseReason = "";
  }
}
export function surveyCompleteForGame(state) {
  const survey = state?.survey;
  if (survey?.version !== SURVEY_VERSION) return Boolean(survey?.completed);
  return Boolean(survey.completed && survey.history.final && survey.history.midpoint && (state.study.gameNumber !== 1 || survey.history.baseline));
}
export function fireKey(fire) { return `${fire.x},${fire.y}`; }
