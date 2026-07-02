import {
  addMessage,
  applyHelicopterCommand,
  applyParticipantAction,
  applyTrustFeedback,
  cloneState,
  createInitialSession,
  ensureSessionShape,
  helicopterAgentReply,
  pushEvent
} from "../shared/simulation.js";
import { renderFirstPerson, renderMiniMap } from "../shared/map-renderer.js";
import { formatTime, SessionStore } from "../shared/realtime.js";

const els = {
  sessionId: document.querySelector("#sessionId"),
  join: document.querySelector("#joinBtn"),
  firstPerson: document.querySelector("#firstPerson"),
  miniMap: document.querySelector("#miniMap"),
  pauseOverlay: document.querySelector("#pauseOverlay"),
  pauseReason: document.querySelector("#pauseReason"),
  mission: document.querySelector("#missionText"),
  droneReport: document.querySelector("#droneReport"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#chatInput"),
  spray: document.querySelector("#sprayBtn"),
  cut: document.querySelector("#cutBtn"),
  bulldozerCut: document.querySelector("#bulldozerCutBtn"),
  accept: document.querySelector("#acceptBtn"),
  override: document.querySelector("#overrideBtn"),
  readout: document.querySelector("#readout")
};

let store = null;
let state = null;

els.join.addEventListener("click", join);
els.form.addEventListener("submit", sendChat);
els.spray.addEventListener("click", () => participant({ type: "spray" }));
els.cut.addEventListener("click", () => participant({ type: "cut" }));
els.bulldozerCut.addEventListener("click", () => participant({ type: "bulldozer_cut" }));
els.accept.addEventListener("click", () => participant({ type: "accept" }));
els.override.addEventListener("click", () => participant({ type: "override" }));
document.querySelectorAll("[data-trust]").forEach((button) => {
  button.addEventListener("click", () => trustFeedback(button.dataset.trust));
});
document.querySelectorAll("[data-move]").forEach((button) => {
  button.addEventListener("click", () => {
    const [dx, dy] = button.dataset.move.split(",").map(Number);
    participant({ type: "move", dx, dy });
  });
});
document.querySelectorAll("[data-bulldozer-move]").forEach((button) => {
  button.addEventListener("click", () => {
    const [dx, dy] = button.dataset.bulldozerMove.split(",").map(Number);
    participant({ type: "bulldozer_move", dx, dy });
  });
});

window.addEventListener("resize", render);

async function join() {
  const sessionId = els.sessionId.value.trim() || "pilot-001";
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    onState(next) {
      state = ensureSessionShape(next);
      render();
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

async function trustFeedback(value) {
  if (!state || state.paused || !store) return;
  const draft = cloneState(state);
  applyTrustFeedback(draft, value);
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

  const draft = cloneState(state);
  addMessage(draft, "participant", "Participant", text);
  pushEvent(draft, "human_chat", "Participant sent helicopter chat", {
    target: "helicopter",
    text
  });
  await store.sendMessage(draft.messages[draft.messages.length - 1]);

  const reply = await getHelicopterReply(text, draft);
  if (reply.statePatch?.experiment) draft.experiment = reply.statePatch.experiment;
  if (reply.statePatch?.helicopter) {
    draft.agents.helicopter = {
      ...draft.agents.helicopter,
      ...reply.statePatch.helicopter
    };
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
    const response = await fetch("/.netlify/functions/helicopter-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, state: currentState })
    });
    if (response.ok) return await response.json();
  } catch {
    // Local static preview or no OpenAI key.
  }
  return helicopterAgentReply(text, currentState);
}

function render() {
  if (!state) return;
  renderFirstPerson(els.firstPerson, state);
  renderMiniMap(els.miniMap, state);
  els.pauseOverlay.hidden = !state.paused;
  els.pauseReason.textContent = state.pauseReason || "";
  els.mission.textContent = state.task;
  els.droneReport.textContent = state.droneReport || "Waiting for drone report.";

  const ff = state.agents.firefighter;
  const heli = state.agents.helicopter;
  const drone = state.agents.drone;
  const bulldozer = state.agents.bulldozer || { x: "?", y: "?" };
  els.readout.textContent = `Tick ${state.tick} | Firefighter (${ff.x}, ${ff.y}) water ${ff.water}/${ff.waterCapacity} | Bulldozer (${bulldozer.x}, ${bulldozer.y}) | Drone (${drone.x}, ${drone.y}) | Helicopter (${heli.x}, ${heli.y}) water ${heli.water}/${heli.waterCapacity}`;

  els.messages.innerHTML = (state.messages || [])
    .slice(-40)
    .map(
      (message) => `
        <article class="message ${message.role}">
          <small>${message.author} - ${formatTime(message.at)}</small>
          ${escapeHtml(message.text)}
        </article>
      `
    )
    .join("");
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

join();
