import { createDetectionController } from "./detection-controller.js";
import { DETECTION_INSTRUCTION } from "../shared/detection-task.js";
import {
  addMessage,
  advanceSimulation,
  applyHelicopterCommand,
  applyParticipantAction,
  applyTeamAction,
  cloneState,
  droneAgentReply,
  ensureSessionShape,
  helicopterAgentReply,
  pushEvent,
  submitSurvey,
  FIREFIGHTER_FORWARD_STEP,
  FIREFIGHTER_BACKWARD_STEP
} from "../shared/simulation.js";
import { questionsForCheckpoint, DOES_NOT_FIT } from "../shared/survey-config.js";
import { renderFirstPerson, renderMiniMap } from "../shared/map-renderer.js";
import { describeConnectionMode, formatTime, SessionStore } from "../shared/realtime.js";

const els = {
  entryOverlay: document.querySelector("#entryOverlay"),
  entryTitle: document.querySelector("#entryTitle"),
  entryMessage: document.querySelector("#entryMessage"),
  entryRetry: document.querySelector("#entryRetry"),
  waveLabel: document.querySelector("#waveLabel"),
  firstPerson: document.querySelector("#firstPerson"),
  miniMap: document.querySelector("#miniMap"),
  pauseOverlay: document.querySelector("#pauseOverlay"),
  pauseTitle: document.querySelector("#pauseTitle"),
  pauseReason: document.querySelector("#pauseReason"),
  surveyForm: document.querySelector("#surveyForm"),
  surveyQuestions: document.querySelector("#surveyQuestions"),
  surveyEmpty: document.querySelector("#surveyEmpty"),
  completionRetry: document.querySelector("#completionRetry"),
  mission: document.querySelector("#missionText"),
  droneReport: document.querySelector("#droneReport"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#chatInput"),
  chatTarget: document.querySelector("#chatTarget"),
  spray: document.querySelector("#sprayBtn"),
  refill: document.querySelector("#refillBtn"),
  cut: document.querySelector("#cutBtn"),
  bulldozerCut: document.querySelector("#bulldozerCutBtn"),
  accept: document.querySelector("#acceptBtn"),
  override: document.querySelector("#overrideBtn"),
  readout: document.querySelector("#readout"),
  missionClock: document.querySelector("#missionClock"),
  aiStatus: document.querySelector("#aiStatus"),
  realtimeStatus: document.querySelector("#realtimeStatus"),
  staminaMeter: document.querySelector("#staminaMeter"),
  staminaValue: document.querySelector("#staminaValue")
};

let store = null;
let state = null;
let participantBusy = false;
let heartbeatBusy = false;
let enrollment = null;
let studyTestMode = false;
let operationalBlocked = false;
let completionBusy = false;
let detectionController = null;
const lamp = document.querySelector("#detectionLamp");
const detectionStart = document.querySelector("#detectionStart");
function awaitingDetectionStart() { return state?.secondaryTask?.instructionAccepted === false; }
detectionStart.addEventListener("click", async () => {
  if (!state || !store) return;
  detectionStart.disabled = true;
  try {
    const draft = cloneState(state);
    draft.secondaryTask.instructionAccepted = true;
    draft.secondaryTask.acceptedAt = Date.now();
    await store.saveState(draft); state = draft; render();
  } catch (error) { els.pauseReason.textContent = error.message; }
  finally { detectionStart.disabled = false; }
});
let surveyBusy = false;
let renderedCheckpoint = null;
const gameLayout = document.querySelector(".client-layout");
document.body.append(els.pauseOverlay);
els.pauseOverlay.setAttribute("role", "dialog");
els.pauseOverlay.setAttribute("aria-modal", "true");
els.pauseOverlay.setAttribute("aria-labelledby", "pauseTitle");
els.surveyForm.addEventListener("change", () => {
  if (state?.survey?.active) localStorage.setItem(surveyDraftKey(), JSON.stringify(Object.fromEntries(new FormData(els.surveyForm))));
});
const heldMovementKeys = new Set();
const TURN_STEP = Math.PI / 8;

els.entryRetry.addEventListener("click", autoEnroll);
els.completionRetry.addEventListener("click", finalizeStudy);
els.form.addEventListener("submit", sendChat);
els.surveyForm.addEventListener("submit", submitFinalSurvey);
els.spray.addEventListener("click", () => participant({ type: "spray" }));
els.refill.addEventListener("click", () => participant({ type: "refill" }));
els.cut.addEventListener("click", () => participant({ type: "cut" }));
els.bulldozerCut.addEventListener("click", () => participant({ type: "bulldozer_cut" }));
els.accept.addEventListener("click", () => participant({ type: "accept" }));
els.override.addEventListener("click", () => participant({ type: "override" }));
document.querySelectorAll("[data-walk]").forEach((button) => bindMovementButton(button, () => ({
  type: "walk",
  distance: Number(button.dataset.walk)
})));
document.querySelectorAll("[data-turn]").forEach((button) => bindMovementButton(button, () => ({
  type: "turn",
  radians: Number(button.dataset.turn) * TURN_STEP
})));
document.querySelectorAll("[data-bulldozer-move]").forEach((button) => {
  button.addEventListener("click", () => {
    const [dx, dy] = button.dataset.bulldozerMove.split(",").map(Number);
    participant({ type: "bulldozer_move", dx, dy });
  });
});
document.querySelectorAll("[data-team-action]").forEach((button) => {
  button.addEventListener("click", () => coordinateTeam(button.dataset.teamAction));
});

window.addEventListener("resize", render);
window.addEventListener("keydown", handleMovementKey);
window.addEventListener("keyup", (event) => heldMovementKeys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => heldMovementKeys.clear());
setInterval(renderMissionClock, 250);
setInterval(maintainSimulationClock, 1000);

function bindMovementButton(button, actionFactory) {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    participant(actionFactory());
  });
  button.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat) return;
    participant(actionFactory());
  });
}

function handleMovementKey(event) {
  if (state?.survey?.active || event.target?.matches?.("input, textarea, select")) return;
  const key = event.key.toLowerCase();
  if (event.repeat || heldMovementKeys.has(key)) return;
  const action = {
    w: { type: "walk", distance: FIREFIGHTER_FORWARD_STEP },
    arrowup: { type: "walk", distance: FIREFIGHTER_FORWARD_STEP },
    s: { type: "walk", distance: -FIREFIGHTER_BACKWARD_STEP },
    arrowdown: { type: "walk", distance: -FIREFIGHTER_BACKWARD_STEP },
    a: { type: "turn", radians: -TURN_STEP },
    arrowleft: { type: "turn", radians: -TURN_STEP },
    d: { type: "turn", radians: TURN_STEP },
    arrowright: { type: "turn", radians: TURN_STEP },
    c: { type: "cut" }
  }[key];
  if (!action) return;
  event.preventDefault();
  heldMovementKeys.add(key);
  participant(action);
}

async function connectEnrolledSession() {
  const sessionId = enrollment.gameSessionId;
  detectionController?.close();
  detectionController = null;
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    accessToken: enrollment.accessToken,
    remoteOnly: true,
    onState(next) {
      if (surveyBusy) return;
      state = ensureSessionShape(next);
      render();
    },
    onConnection() {
      renderConnectionStatus();
    }
  });
  await store.connect();
  if (store.realtimeStatus !== "connected") throw new Error("The shared study service could not be reached");
  const loaded = await store.loadState();
  if (!loaded) throw new Error("The assigned game session could not be loaded");
  state = ensureSessionShape(loaded);
  if (state.secondaryTask) detectionController = await createDetectionController({
    sessionId, headers: store.authHeaders(), getState: () => state,
    isBlocked: () => operationalBlocked || completionBusy, lamp
  });
  els.waveLabel.textContent = `${enrollment.wave} of 4`;
  render();
}

async function participant(action) {
  if (!state || state.paused || !store || participantBusy || operationalBlocked || awaitingDetectionStart()) return;
  participantBusy = true;
  try {
    const draft = cloneState(state);
    applyParticipantAction(draft, action);
    state = draft;
    await store.saveState(state);
    render();
  } catch (error) {
    handleOperationalError(error);
  } finally {
    participantBusy = false;
  }
}

async function maintainSimulationClock() {
  if (!state || !store || state.paused || state.mission?.completed || heartbeatBusy || operationalBlocked || awaitingDetectionStart()) return;
  if (Date.now() - (state.updatedAt || 0) < 1800) return;
  heartbeatBusy = true;
  try {
    const draft = cloneState(state);
    const previousTick = draft.tick;
    advanceSimulation(draft, Date.now());
    if (draft.tick === previousTick && !draft.survey?.active) return;
    state = draft;
    await store.saveState(state);
    render();
  } catch (error) {
    handleOperationalError(error);
  } finally {
    heartbeatBusy = false;
  }
}

async function coordinateTeam(action) {
  if (!state || state.paused || !store || operationalBlocked || awaitingDetectionStart()) return;
  try {
    const actionState = cloneState(state);
    const result = applyTeamAction(actionState, action);
    const actionMessage = actionState.messages[actionState.messages.length - 1];
    state = actionState;
    await store.saveState(state);
    render();

    const reply = await getAgentActionReply(result.agent, action, actionState, result.text);
    updateAiStatusFromReply(reply);
    if (state.paused) return;
    const latest = cloneState(state);
    const lastAgentMessage = (latest.messages || []).find((message) => message.id === actionMessage?.id);
    if (lastAgentMessage && reply?.text) lastAgentMessage.text = reply.text;
    state = latest;
    await store.saveState(state);
    render();
  } catch (error) {
    handleOperationalError(error);
  }
}

async function sendChat(event) {
  event.preventDefault();
  if (!state || state.paused || !store || operationalBlocked || awaitingDetectionStart()) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  const target = els.chatTarget.value;
  const targetName = target === "drone" ? "Drone AI" : "Helicopter AI";

  try {

  const requestState = cloneState(state);
  addMessage(requestState, "participant", "Participant", text);
  pushEvent(requestState, "human_chat", `Participant sent ${targetName} chat`, {
    target,
    text
  });
  const participantMessage = requestState.messages[requestState.messages.length - 1];
  state = requestState;
  await store.sendMessage(participantMessage);
  await store.saveState(state);
  render();

  const reply = target === "drone"
    ? await getDroneReply(text, requestState)
    : await getHelicopterReply(text, requestState);
  updateAiStatusFromReply(reply);
  if (state.paused) return;
  const draft = cloneState(state);

  if (target === "drone") {
    if (reply.teamAction) {
      applyTeamAction(draft, reply.teamAction);
      const actionMessage = [...(draft.messages || [])]
        .reverse()
        .find((message) => message.role === "drone");
      if (actionMessage) actionMessage.text = reply.text;
    } else {
      addMessage(draft, "drone", "Drone AI", reply.text);
    }
    pushEvent(draft, "drone_reply", "Drone replied to participant", {
      text: reply.text,
      teamAction: reply.teamAction || null,
      ai: Boolean(reply.ai),
      provider: reply.provider
    });
    await store.sendMessage(draft.messages[draft.messages.length - 1]);
    state = draft;
    await store.saveState(state);
    render();
    return;
  }

  if (reply.statePatch?.experiment) draft.experiment = reply.statePatch.experiment;
  if (reply.statePatch?.helicopter) {
    draft.agents.helicopter = {
      ...draft.agents.helicopter,
      ...reply.statePatch.helicopter
    };
  }
  if (reply.statePatch?.helicopterKnowledge) {
    draft.agents.helicopter.knowledge = reply.statePatch.helicopterKnowledge;
  }
  addMessage(draft, "helicopter", "Helicopter AI", reply.text);
  pushEvent(draft, "helicopter_reply", "Helicopter replied to participant", {
    text: reply.text,
    command: reply.command,
    helicopter: {
      reportedAction: draft.agents.helicopter.reportedAction,
      actualAction: draft.agents.helicopter.actualAction,
      intendedTarget: draft.agents.helicopter.intendedTarget,
      actualTarget: draft.agents.helicopter.actualTarget
    }
  });
  applyHelicopterCommand(draft, reply.command, "participant chat");
  await store.sendMessage(draft.messages[draft.messages.length - 1]);

  state = draft;
  await store.saveState(state);
  render();
  } catch (error) {
    handleOperationalError(error);
  }
}

async function getHelicopterReply(text, currentState) {
  const fallback = helicopterAgentReply(text, currentState);
  return requestAgentReply({ agent: "helicopter", message: text, state: currentState }, fallback);
}

async function getDroneReply(text, currentState) {
  const fallback = droneAgentReply(text, currentState);
  return requestAgentReply(
    { agent: "drone", message: text, intent: "participant_chat", state: currentState },
    fallback
  );
}

async function getAgentActionReply(agent, intent, currentState, fallbackText) {
  if (!agent || agent === "system") return { text: fallbackText };
  return requestAgentReply({ agent, intent, state: currentState, fallbackText }, { text: fallbackText });
}

async function requestAgentReply(body, fallback) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/.netlify/functions/agent-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...store.authHeaders() },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error(`AI request failed (HTTP ${response.status})`);
      const reply = await response.json();
      if (reply.ai || studyTestMode) return reply;
      throw new Error("The AI communication service is temporarily unavailable");
    } catch (error) {
      lastError = error;
    }
  }
  if (studyTestMode) return fallback;
  throw lastError || new Error("The AI communication service is temporarily unavailable");
}

function render() {
  if (!state) return;
  renderConnectionStatus();
  renderFirstPerson(els.firstPerson, state);
  renderMiniMap(els.miniMap, state);
  const instructionPending = awaitingDetectionStart() && !state.survey?.active;
  detectionStart.hidden = !instructionPending;
  els.pauseOverlay.hidden = !state.paused && !instructionPending;
  const surveyActive = Boolean(state.survey?.active);
  gameLayout.inert = state.paused || instructionPending;
  els.pauseTitle.textContent = state.mission?.completed
    ? "Mission Complete"
    : surveyActive
      ? state.survey.label || "Questionnaire"
      : "Session Paused";
  els.pauseReason.textContent = instructionPending ? DETECTION_INSTRUCTION : state.pauseReason || "";
  if (instructionPending) els.pauseTitle.textContent = "Before this round";
  els.surveyForm.hidden = !surveyActive;
  renderSurveyQuestions();
  els.mission.textContent = state.task;
  els.droneReport.textContent = state.droneReport || "Waiting for drone report.";
  renderMissionClock();

  const ff = state.agents.firefighter;
  const heli = state.agents.helicopter;
  const drone = state.agents.drone;
  const bulldozer = state.agents.bulldozer || { x: "?", y: "?" };
  els.readout.textContent = `Tick ${state.tick} | Firefighter (${ff.x}, ${ff.y}) facing ${headingLabel(ff.heading)} water ${ff.water}/${ff.waterCapacity} | Bulldozer (${bulldozer.x}, ${bulldozer.y}) | Drone (${drone.x}, ${drone.y}) | Helicopter (${heli.x}, ${heli.y}) water ${heli.water}/${heli.waterCapacity}`;
  els.staminaMeter.value = ff.stamina;
  els.staminaValue.textContent = Math.round(ff.stamina);
  els.cut.textContent = ff.blockedTree ? `Cut Tree ${ff.blockedTree.cuts}/3` : "Cut Tree";
  els.cut.title = "Cut the blocking tree (C)";

  els.messages.innerHTML = (state.messages || [])
    .slice(-40)
    .map(
      (message) => `
        <article class="message ${message.role}">
          <span class="message-avatar" aria-hidden="true">${agentInitials(message.role)}</span>
          <div>
            <small>${escapeHtml(message.author)} - ${formatTime(message.at)}</small>
            ${escapeHtml(message.text)}
          </div>
        </article>
      `
    )
    .join("");
  els.messages.scrollTop = els.messages.scrollHeight;
}

function formatCountdown(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function headingLabel(heading = 0) {
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const normalized = ((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return directions[Math.round(normalized / (Math.PI / 4)) % directions.length];
}

function agentInitials(role) {
  return { participant: "FF", firefighter: "FF", drone: "DR", helicopter: "HE", bulldozer: "DZ" }[role] || "SYS";
}

async function loadStudyStatus() {
  try {
    const response = await fetch("/.netlify/functions/config", { cache: "no-store" });
    if (!response.ok) throw new Error("config unavailable");
    const config = await response.json();
    studyTestMode = Boolean(config.STUDY_TEST_MODE);
    els.aiStatus.textContent = config.AI_ENABLED ? "AI online" : "AI fallback";
    els.aiStatus.classList.toggle("connected", Boolean(config.AI_ENABLED));
    els.aiStatus.title = config.AI_ENABLED
      ? "AI access verified."
      : "AI is unavailable; built-in operational dialogue remains active.";
    return config;
  } catch {
    els.aiStatus.textContent = "AI fallback";
    els.aiStatus.title = "The AI status service is unavailable; built-in operational dialogue remains active.";
    throw new Error("The study readiness service could not be reached");
  }
}

function updateAiStatusFromReply(reply) {
  if (reply.ai) {
    els.aiStatus.textContent = "AI online";
    els.aiStatus.classList.add("connected");
    els.aiStatus.title = "This reply was generated by the configured AI provider.";
    return;
  }
  els.aiStatus.textContent = reply.provider && reply.provider !== "deterministic"
    ? "AI fallback"
    : "AI fallback";
  els.aiStatus.classList.remove("connected");
  els.aiStatus.title = "AI is unavailable; built-in operational dialogue produced this reply.";
}

function renderConnectionStatus() {
  const description = describeConnectionMode(store);
  const connected = store?.mode === "netlify" && store?.realtimeStatus === "connected";
  els.realtimeStatus.textContent = connected
    ? "Cross-device connected"
    : store?.mode === "netlify"
      ? "Connection error"
      : "Cross-device unavailable";
  els.realtimeStatus.classList.toggle("connected", connected);
  els.realtimeStatus.title = description;
}

function renderMissionClock() {
  if (!state) return;
  els.missionClock.textContent = formatCountdown(liveMissionSeconds(state));
}

function liveMissionSeconds(currentState) {
  const mission = currentState.mission || {};
  if (currentState.paused || !mission.deadlineAt) return mission.remainingSeconds ?? 1800;
  return Math.max(0, Math.ceil((mission.deadlineAt - Date.now()) / 1000));
}

function surveyDraftKey() {
  return `wildfire-survey-draft:${state.id}:${state.survey.version || 1}:${state.survey.checkpoint || "final"}`;
}

function renderSurveyQuestions() {
  if (!state.survey?.active) return;
  const checkpoint = state.survey.checkpoint || "final";
  const key = `${state.id}:${checkpoint}`;
  if (renderedCheckpoint === key) return;
  renderedCheckpoint = key;
  const questions = questionsForCheckpoint(checkpoint);
  els.surveyEmpty.hidden = true;
  let previousGroup = "";
  els.surveyQuestions.innerHTML = questions.map((question) => {
    const group = question.target;
    const title = { helicopter: "Helicopter AI", drone: "Drone AI", task: "Your workload", technology: "Your views on technology" }[group];
    const introduction = question.measure === "mdmt_v2"
      ? `How much does each attribute describe the ${title}? Select 0 (Not at all) to 7 (Very), or Does Not Fit.`
      : question.measure === "nasa_tlx_subset" ? "Rate your experience of the game so far, from 0 (Very Low) to 20 (Very High)."
      : "Rate your agreement with each statement, from 1 (Strongly disagree) to 5 (Strongly agree).";
    const heading = group !== previousGroup ? `<h2>${title}</h2><p class="survey-instructions">${introduction}</p>` : "";
    previousGroup = group;
    return heading + surveyQuestionHtml(question);
  }).join("");
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(surveyDraftKey()) || "{}"); } catch { /* Ignore invalid local drafts. */ }
  for (const input of els.surveyForm.querySelectorAll("input[type=radio]")) input.checked = draft[input.name] === input.value;
  els.surveyForm.querySelector("button[type=submit]").textContent = checkpoint === "final" ? "Submit and finish game" : checkpoint === "baseline" ? "Submit and start game" : "Submit and resume game";
  els.surveyForm.scrollTop = 0;
  els.pauseTitle.tabIndex = -1;
  els.pauseTitle.focus();
}

async function submitFinalSurvey(event) {
  event.preventDefault();
  if (!state || !store || surveyBusy || !els.surveyForm.reportValidity()) return;
  surveyBusy = true;
  const submitButton = els.surveyForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  const draftKey = surveyDraftKey();
  try {
    const responses = Object.fromEntries(new FormData(els.surveyForm).entries());
    const draft = cloneState(state);
    submitSurvey(draft, responses);
    await store.saveState(draft);
    state = draft;
    localStorage.removeItem(draftKey);
    renderedCheckpoint = null;
    render();
    if (state.survey.completed) await finalizeStudy();
  } catch (error) {
    // Keep the form and clock paused; retry uses the same answers.
    els.pauseReason.textContent = `Answers not confirmed: ${error.message}. Please retry submitting.`;
  } finally {
    surveyBusy = false;
    submitButton.disabled = false;
  }
}

async function finalizeStudy() {
  if (!state?.survey?.completed || !enrollment || completionBusy) return;
  completionBusy = true;
  els.pauseOverlay.hidden = false;
  els.surveyForm.hidden = true;
  els.completionRetry.hidden = true;
  els.pauseTitle.textContent = "Saving Completion";
  els.pauseReason.textContent = "Please keep this page open while your responses are confirmed.";
  try {
    if (detectionController) await detectionController.flushAll();
    const response = await fetch("/.netlify/functions/study-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...store.authHeaders() },
      body: JSON.stringify({ sessionId: enrollment.gameSessionId })
    });
    const result = await response.json();
    if (!response.ok || !result.saved) throw new Error(result.error || "Completion could not be confirmed");
    els.pauseTitle.textContent = "Responses Saved";
    els.pauseReason.textContent = result.completionUrl
      ? "Returning you to Prolific now."
      : `Test completion recorded. Receipt: ${result.receiptId}`;
    if (result.completionUrl) setTimeout(() => window.location.replace(result.completionUrl), 900);
  } catch (error) {
    els.pauseTitle.textContent = "Completion Not Confirmed";
    els.pauseReason.textContent = "Your game remains saved. Check your connection, then retry completion.";
    els.completionRetry.hidden = false;
  } finally {
    completionBusy = false;
  }
}

async function autoEnroll() {
  operationalBlocked = true;
  els.entryOverlay.hidden = false;
  els.entryRetry.hidden = true;
  els.entryTitle.textContent = "Preparing your session";
  els.entryMessage.textContent = "Verifying the study link and shared services.";
  try {
    if (window.innerWidth < 1000 || window.innerHeight < 600) {
      throw new Error("This study requires a desktop or laptop browser window at least 1000 by 600 pixels.");
    }
    const config = await loadStudyStatus();
    if (!config.STUDY_CONFIGURED) throw new Error("This study deployment is not configured yet.");
    if (!config.AI_ENABLED && !config.STUDY_TEST_MODE) {
      throw new Error("The study communication service is temporarily unavailable. Please try again shortly.");
    }

    const parameters = enrollmentParameters(config.STUDY_TEST_MODE);
    const response = await fetch("/.netlify/functions/study-enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parameters)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The study session could not be prepared");
    enrollment = result;
    await connectEnrolledSession();
    operationalBlocked = false;
    els.entryOverlay.hidden = true;
    if (state.survey?.completed || enrollment.status === "completed") await finalizeStudy();
  } catch (error) {
    els.entryTitle.textContent = "Session Unavailable";
    els.entryMessage.textContent = error.message || "The session could not be prepared. Please try again.";
    els.entryRetry.hidden = false;
  }
}

function enrollmentParameters(testMode) {
  const query = new URLSearchParams(window.location.search);
  const wave = Number(query.get("wave"));
  let prolificParticipantId = query.get("PROLIFIC_PID") || "";
  let studyId = query.get("STUDY_ID") || "";
  let submissionId = query.get("SESSION_ID") || "";
  if (query.get("preview") === "1" && testMode) {
    prolificParticipantId = sessionStorage.getItem("wildfire-preview-participant") || randomProlificId();
    studyId ||= `test-study-wave-${wave}`;
    submissionId ||= sessionStorage.getItem(`wildfire-preview-submission-${wave}`) || randomProlificId();
    sessionStorage.setItem("wildfire-preview-participant", prolificParticipantId);
    sessionStorage.setItem(`wildfire-preview-submission-${wave}`, submissionId);
  }
  return {
    prolificParticipantId,
    studyId,
    submissionId,
    prolificToken: query.get("prolific_token") || "",
    wave,
    entryUrl: window.location.href
  };
}

function randomProlificId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
}

function handleOperationalError(error) {
  console.error("Study operation failed", error);
  operationalBlocked = true;
  els.entryOverlay.hidden = false;
  els.entryTitle.textContent = "Connection Interrupted";
  els.entryMessage.textContent = "Your latest confirmed progress is saved. Restore your connection and try again.";
  els.entryRetry.hidden = false;
}

function surveyQuestionHtml(question) {
  const id = escapeHtml(question.id);
  const options = Array.from({ length: question.max - question.min + 1 }, (_, index) => {
    const value = question.min + index;
    return `<label class="rating-option"><input type="radio" name="${id}" value="${value}" required aria-label="${value}"/><span>${value}</span></label>`;
  });
  if (question.allowDoesNotFit) options.push(`<label class="rating-option not-fit"><input type="radio" name="${id}" value="${DOES_NOT_FIT}" required/><span>Does Not Fit</span></label>`);
  return `<fieldset class="survey-item"><legend>${escapeHtml(question.label)}</legend>${question.description ? `<p>${escapeHtml(question.description)}</p>` : ""}<div class="rating-anchors"><span>${question.min} · ${question.minLabel}</span><span>${question.max} · ${question.maxLabel}</span></div><div class="rating-options">${options.join("")}</div></fieldset>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

autoEnroll();
