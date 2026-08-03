import {
  addMessage,
  applyHelicopterCommand,
  applyParticipantAction,
  applyTeamAction,
  cloneState,
  createInitialSession,
  droneAgentReply,
  ensureSessionShape,
  helicopterAgentReply,
  pushEvent
} from "../shared/simulation.js";
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
  surveyLink: document.querySelector("#surveyLink"),
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
  realtimeStatus: document.querySelector("#realtimeStatus")
};

let store = null;
let state = null;
const PLACEHOLDER_SURVEY_URL = "https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER";
let surveyBaseUrl = window.WILDFIRE_CONFIG?.QUALTRICS_SURVEY_URL || PLACEHOLDER_SURVEY_URL;
const TURN_STEP = Math.PI / 8;

els.join.addEventListener("click", join);
els.form.addEventListener("submit", sendChat);
els.spray.addEventListener("click", () => participant({ type: "spray" }));
els.refill.addEventListener("click", () => participant({ type: "refill" }));
els.cut.addEventListener("click", () => participant({ type: "cut" }));
els.bulldozerCut.addEventListener("click", () => participant({ type: "bulldozer_cut" }));
els.accept.addEventListener("click", () => participant({ type: "accept" }));
els.override.addEventListener("click", () => participant({ type: "override" }));
document.querySelectorAll("[data-walk]").forEach((button) => {
  button.addEventListener("click", () => {
    participant({ type: "walk", distance: Number(button.dataset.walk) });
  });
});
document.querySelectorAll("[data-turn]").forEach((button) => {
  button.addEventListener("click", () => {
    participant({ type: "turn", radians: Number(button.dataset.turn) * TURN_STEP });
  });
});
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
setInterval(renderMissionClock, 250);

function handleMovementKey(event) {
  if (event.target?.matches?.("input, textarea, select")) return;
  if (event.repeat) return;
  const action = {
    w: { type: "walk", distance: 4 },
    arrowup: { type: "walk", distance: 4 },
    s: { type: "walk", distance: -2 },
    arrowdown: { type: "walk", distance: -2 },
    a: { type: "turn", radians: -TURN_STEP },
    arrowleft: { type: "turn", radians: -TURN_STEP },
    d: { type: "turn", radians: TURN_STEP },
    arrowright: { type: "turn", radians: TURN_STEP }
  }[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
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
  state = ensureSessionShape(loaded || createInitialSession(sessionId));
  if (!loaded) await store.saveState(state);
  render();
}

async function participant(action) {
  if (!state || state.paused || !store) return;
  const draft = cloneState(state);
  applyParticipantAction(draft, action);
  state = draft;
  await store.saveState(state);
  render();
}

async function coordinateTeam(action) {
  if (!state || state.paused || !store) return;
  const draft = cloneState(state);
  const result = applyTeamAction(draft, action);
  const reply = await getAgentActionReply(result.agent, action, draft, result.text);
  updateAiStatusFromReply(reply);
  const lastAgentMessage = [...(draft.messages || [])]
    .reverse()
    .find((message) => message.role === result.agent);
  if (lastAgentMessage && reply?.text) lastAgentMessage.text = reply.text;
  state = draft;
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

  const draft = cloneState(state);
  addMessage(draft, "participant", "Participant", text);
  pushEvent(draft, "human_chat", `Participant sent ${targetName} chat`, {
    target,
    text
  });
  await store.sendMessage(draft.messages[draft.messages.length - 1]);

  const reply = target === "drone"
    ? await getDroneReply(text, draft)
    : await getHelicopterReply(text, draft);
  updateAiStatusFromReply(reply);

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
  const surveyActive = Boolean(state.survey?.active && !state.mission?.completed);
  els.pauseTitle.textContent = state.mission?.completed
    ? "Mission Complete"
    : surveyActive
      ? `${state.survey.label || "Checkpoint"} Survey`
      : "Session Paused";
  els.pauseReason.textContent = state.pauseReason || "";
  els.surveyLink.hidden = !surveyActive;
  if (surveyActive) {
    els.surveyLink.textContent = `Open ${state.survey.label || "External"} Survey`;
    els.surveyLink.href = surveyUrl(state.survey.url || surveyBaseUrl, state);
  }
  els.mission.textContent = state.task;
  els.droneReport.textContent = state.droneReport || "Waiting for drone report.";
  renderMissionClock();

  const ff = state.agents.firefighter;
  const heli = state.agents.helicopter;
  const drone = state.agents.drone;
  const bulldozer = state.agents.bulldozer || { x: "?", y: "?" };
  els.readout.textContent = `Tick ${state.tick} | Firefighter (${ff.x}, ${ff.y}) facing ${headingLabel(ff.heading)} water ${ff.water}/${ff.waterCapacity} | Bulldozer (${bulldozer.x}, ${bulldozer.y}) | Drone (${drone.x}, ${drone.y}) | Helicopter (${heli.x}, ${heli.y}) water ${heli.water}/${heli.waterCapacity}`;

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
    surveyBaseUrl = config.QUALTRICS_SURVEY_URL || surveyBaseUrl;
    els.aiStatus.textContent = config.AI_ENABLED
      ? `${providerLabel(config.AI_PROVIDER)} ${config.AI_MODEL}`
      : "Deterministic fallback";
    els.aiStatus.classList.toggle("connected", Boolean(config.AI_ENABLED));
  } catch {
    els.aiStatus.textContent = "Local fallback";
  }
}

function updateAiStatusFromReply(reply) {
  if (reply.ai) {
    els.aiStatus.textContent = `${providerLabel(reply.provider)} ${reply.model}`;
    els.aiStatus.classList.add("connected");
    els.aiStatus.title = "This reply was generated by the configured AI provider.";
    return;
  }
  els.aiStatus.textContent = reply.provider && reply.provider !== "deterministic"
    ? `${providerLabel(reply.provider)} fallback`
    : "Deterministic fallback";
  els.aiStatus.classList.remove("connected");
  els.aiStatus.title = reply.diagnostic || "The built-in deterministic dialogue produced this reply.";
}

function renderConnectionStatus() {
  const description = describeConnectionMode(store);
  const connected = store?.mode === "supabase" && store?.realtimeStatus === "connected";
  els.realtimeStatus.textContent = connected
    ? "Realtime connected"
    : store?.mode === "supabase"
      ? "Realtime error"
      : "Local only - cross-device off";
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

function providerLabel(provider) {
  return provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI" : "AI";
}

function surveyUrl(baseUrl, currentState) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("session_id", currentState.id || els.sessionId.value.trim());
    url.searchParams.set("checkpoint", currentState.survey?.label || "");
    return url.toString();
  } catch {
    return PLACEHOLDER_SURVEY_URL;
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

join();
loadAiStatus();
