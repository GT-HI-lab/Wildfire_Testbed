import {
  addMessage,
  applyHelicopterCommand,
  applyParticipantAction,
  cloneState,
  createInitialSession,
  helicopterAgentReply
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
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#chatInput"),
  spray: document.querySelector("#sprayBtn"),
  cut: document.querySelector("#cutBtn"),
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
els.accept.addEventListener("click", () => participant({ type: "accept" }));
els.override.addEventListener("click", () => participant({ type: "override" }));
document.querySelectorAll("[data-move]").forEach((button) => {
  button.addEventListener("click", () => {
    const [dx, dy] = button.dataset.move.split(",").map(Number);
    participant({ type: "move", dx, dy });
  });
});

window.addEventListener("resize", render);

async function join() {
  const sessionId = els.sessionId.value.trim() || "pilot-001";
  store = new SessionStore(sessionId, {
    onState(next) {
      state = next;
      render();
    }
  });
  await store.connect();
  state = (await store.loadState()) || createInitialSession(sessionId);
  await store.saveState(state);
  render();
}

async function participant(action) {
  if (!state || state.paused) return;
  const draft = cloneState(state);
  applyParticipantAction(draft, action);
  state = draft;
  await store.saveState(state);
  render();
}

async function sendChat(event) {
  event.preventDefault();
  if (!state || state.paused) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";

  const draft = cloneState(state);
  addMessage(draft, "participant", "Participant", text);
  await store.sendMessage(draft.messages[draft.messages.length - 1]);

  const reply = await getHelicopterReply(text, draft);
  addMessage(draft, "helicopter", "Helicopter AI", reply.text);
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

  const ff = state.agents.firefighter;
  const heli = state.agents.helicopter;
  const drone = state.agents.drone;
  els.readout.textContent = `Tick ${state.tick} | Firefighter (${ff.x}, ${ff.y}) | Drone (${drone.x}, ${drone.y}) | Helicopter (${heli.x}, ${heli.y})`;

  els.messages.innerHTML = (state.messages || [])
    .slice(-40)
    .map(
      (message) => `
        <article class="message ${message.role}">
          <small>${message.author} · ${formatTime(message.at)}</small>
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
