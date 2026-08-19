import {
  addMessage,
  advanceSimulation,
  applyHelicopterCommand,
  applyParticipantAction,
  applyTeamAction,
  cloneState,
  createInitialSession,
  droneAgentReply,
  ensureSessionShape,
  helicopterAgentReply,
  pushEvent,
  submitSurvey,
  FIREFIGHTER_FORWARD_STEP,
  FIREFIGHTER_BACKWARD_STEP
} from "../shared/simulation.js";
import { SURVEY_QUESTIONS } from "../shared/survey-config.js";
import { renderFirstPerson, renderMiniMap } from "../shared/map-renderer.js";
import { describeConnectionMode, formatTime, SessionStore } from "../shared/realtime.js";

const els = {
  sessionId: document.querySelector("#sessionId"),
  join: document.querySelector("#joinBtn"),
  firstPerson: document.querySelector("#firstPerson"),
  miniMap: document.querySelector("#miniMap"),
  pauseOverlay: document.querySelector("#pauseOverlay"),
  pauseTitle: document.querySelector("#pauseTitle"),
  pauseReason: document.querySelector("#pauseReason"),
  surveyForm: document.querySelector("#surveyForm"),
  surveyQuestions: document.querySelector("#surveyQuestions"),
  surveyEmpty: document.querySelector("#surveyEmpty"),
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
const heldMovementKeys = new Set();
const TURN_STEP = Math.PI / 8;

els.join.addEventListener("click", join);
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
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.repeat) return;
    participant(actionFactory());
  });
}

function handleMovementKey(event) {
  if (event.target?.matches?.("input, textarea, select")) return;
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
    arrowright: { type: "turn", radians: TURN_STEP }
  }[key];
  if (!action) return;
  event.preventDefault();
  heldMovementKeys.add(key);
  participant(action);
}

async function join() {
  const sessionId = els.sessionId.value.trim() || "pilot-001";
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    onState(next) {
      state = ensureSessionShape(next);
      render();
    },
    onConnection() {
      renderConnectionStatus();
    }
  });
  await store.connect();
  const loaded = await store.loadState();
  const requestedTestbed = new URLSearchParams(window.location.search).get("testbed");
  state = ensureSessionShape(loaded || createInitialSession(sessionId, { testbed: requestedTestbed }));
  if (!loaded) await store.saveState(state);
  render();
}

async function participant(action) {
  if (!state || state.paused || !store || participantBusy) return;
  participantBusy = true;
  try {
    const draft = cloneState(state);
    applyParticipantAction(draft, action);
    state = draft;
    await store.saveState(state);
    render();
  } finally {
    participantBusy = false;
  }
}

async function maintainSimulationClock() {
  if (!state || !store || state.paused || state.mission?.completed || heartbeatBusy) return;
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
  } finally {
    heartbeatBusy = false;
  }
}

async function coordinateTeam(action) {
  if (!state || state.paused || !store) return;
  const actionState = cloneState(state);
  const result = applyTeamAction(actionState, action);
  const actionMessage = actionState.messages[actionState.messages.length - 1];
  state = actionState;
  await store.saveState(state);
  render();

  const reply = await getAgentActionReply(result.agent, action, actionState, result.text);
  updateAiStatusFromReply(reply);
  const latest = cloneState(state);
  const lastAgentMessage = (latest.messages || []).find((message) => message.id === actionMessage?.id);
  if (lastAgentMessage && reply?.text) lastAgentMessage.text = reply.text;
  state = latest;
  await store.saveState(state);
  render();
}

async function sendChat(event) {
  event.preventDefault();
  if (!state || state.paused || !store) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  const target = els.chatTarget.value;
  const targetName = target === "drone" ? "Drone AI" : "Helicopter AI";

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
}

async function getHelicopterReply(text, currentState) {
  try {
    const response = await fetch("/.netlify/functions/agent-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "helicopter", message: text, state: currentState })
    });
    if (response.ok) return await response.json();
  } catch {
    // Local static preview or no OpenAI key.
  }
  return helicopterAgentReply(text, currentState);
}

async function getDroneReply(text, currentState) {
  try {
    const response = await fetch("/.netlify/functions/agent-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "drone", message: text, intent: "participant_chat", state: currentState })
    });
    if (response.ok) return await response.json();
  } catch {
    // Local static preview uses deterministic simulation replies.
  }
  return droneAgentReply(text, currentState);
}

async function getAgentActionReply(agent, intent, currentState, fallbackText) {
  if (!agent || agent === "system") return { text: fallbackText };
  try {
    const response = await fetch("/.netlify/functions/agent-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, intent, state: currentState, fallbackText })
    });
    if (response.ok) return await response.json();
  } catch {
    // Local static preview uses deterministic simulation replies.
  }
  return { text: fallbackText };
}

function render() {
  if (!state) return;
  renderConnectionStatus();
  renderFirstPerson(els.firstPerson, state);
  renderMiniMap(els.miniMap, state);
  els.pauseOverlay.hidden = !state.paused;
  const surveyActive = Boolean(state.survey?.active && state.mission?.completed);
  els.pauseTitle.textContent = state.mission?.completed
    ? "Mission Complete"
    : surveyActive
      ? `${state.survey.label || "Final"} Survey`
      : "Session Paused";
  els.pauseReason.textContent = state.pauseReason || "";
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

async function loadAiStatus() {
  try {
    const response = await fetch("/.netlify/functions/config");
    if (!response.ok) throw new Error("config unavailable");
    const config = await response.json();
    els.aiStatus.textContent = config.AI_ENABLED ? "AI online" : "AI fallback";
    els.aiStatus.classList.toggle("connected", Boolean(config.AI_ENABLED));
  } catch {
    els.aiStatus.textContent = "AI fallback";
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
  els.aiStatus.title = reply.diagnostic || "The built-in deterministic dialogue produced this reply.";
}

function renderConnectionStatus() {
  const description = describeConnectionMode(store);
  const connected = ["supabase", "netlify"].includes(store?.mode) && store?.realtimeStatus === "connected";
  els.realtimeStatus.textContent = connected
    ? "Cross-device connected"
    : ["supabase", "netlify"].includes(store?.mode)
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

function renderSurveyQuestions() {
  els.surveyEmpty.hidden = SURVEY_QUESTIONS.length > 0;
  if (els.surveyQuestions.childElementCount || !SURVEY_QUESTIONS.length) return;
  els.surveyQuestions.innerHTML = SURVEY_QUESTIONS.map((question) => surveyQuestionHtml(question)).join("");
}

async function submitFinalSurvey(event) {
  event.preventDefault();
  if (!state || !store) return;
  const responses = Object.fromEntries(new FormData(els.surveyForm).entries());
  const draft = cloneState(state);
  submitSurvey(draft, responses);
  state = draft;
  await store.saveState(state);
  render();
}

function surveyQuestionHtml(question) {
  const id = escapeHtml(question.id);
  const label = escapeHtml(question.label);
  if (question.type === "text") return `<label>${label}<textarea name="${id}" required></textarea></label>`;
  if (question.type === "choice") {
    const options = (question.options || []).map((option) => `<option>${escapeHtml(option)}</option>`).join("");
    return `<label>${label}<select name="${id}" required><option value="">Select</option>${options}</select></label>`;
  }
  return `<label>${label}<input name="${id}" type="range" min="${question.min || 1}" max="${question.max || 7}" value="${question.min || 1}" /></label>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

join();
loadAiStatus();
