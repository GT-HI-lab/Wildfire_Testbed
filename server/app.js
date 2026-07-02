import {
  advanceSimulation,
  applyReliabilityPairing,
  clearSurvey,
  cloneState,
  createInitialSession,
  requestSurvey,
  setPaused
} from "../shared/simulation.js";
import { renderMap } from "../shared/map-renderer.js";
import { formatTime, SessionStore } from "../shared/realtime.js";

const els = {
  canvas: document.querySelector("#mapCanvas"),
  sessionId: document.querySelector("#sessionId"),
  connect: document.querySelector("#connectBtn"),
  reset: document.querySelector("#resetBtn"),
  pause: document.querySelector("#pauseBtn"),
  resume: document.querySelector("#resumeBtn"),
  status: document.querySelector("#statusPill"),
  tick: document.querySelector("#tickLabel"),
  condition: document.querySelector("#conditionSelect"),
  metrics: document.querySelector("#metrics"),
  agents: document.querySelector("#agentList"),
  events: document.querySelector("#eventList"),
  clearSurvey: document.querySelector("#clearSurveyBtn")
};

let store = null;
let state = null;
let clock = null;

els.connect.addEventListener("click", connect);
els.reset.addEventListener("click", async () => {
  state = createInitialSession(els.sessionId.value.trim() || "pilot-001");
  await store?.saveState(state);
  render();
});
els.pause.addEventListener("click", () => mutate((draft) => setPaused(draft, true, "Experimenter paused the session")));
els.resume.addEventListener("click", () => mutate((draft) => setPaused(draft, false)));
els.condition.addEventListener("change", () => mutate((draft) => applyReliabilityPairing(draft, els.condition.value)));
els.clearSurvey.addEventListener("click", () => mutate((draft) => clearSurvey(draft)));
document.querySelectorAll("[data-survey]").forEach((button) => {
  button.addEventListener("click", () => mutate((draft) => requestSurvey(draft, button.dataset.survey)));
});

window.addEventListener("resize", render);

async function connect() {
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
  startClock();
  render();
}

function startClock() {
  clearInterval(clock);
  clock = setInterval(async () => {
    if (!state || state.paused) return;
    const draft = cloneState(state);
    advanceSimulation(draft);
    state = draft;
    await store.saveState(state);
    render();
  }, 1250);
}

async function mutate(fn) {
  if (!state) return;
  const draft = cloneState(state);
  fn(draft);
  state = draft;
  await store.saveState(state);
  render();
}

function render() {
  if (!state) return;
  renderMap(els.canvas, state, { alignTop: true });
  els.status.textContent = state.paused ? "Paused" : state.status === "running" ? "Running" : "Ready";
  els.status.className = `pill ${state.paused ? "paused" : state.status === "running" ? "running" : ""}`;
  els.tick.textContent = `Tick ${state.tick}`;
  els.condition.value = state.condition;

  const m = state.metrics;
  els.metrics.innerHTML = [
    metric("Score", m.score),
    metric("Fires", state.fires.length),
    metric("Detections", m.droneDetections),
    metric("Water drops", m.waterDrops),
    metric("Accepts", m.acceptedRecommendations),
    metric("Overrides", m.overrides)
  ].join("");

  els.agents.innerHTML = `
    <h2>Agents</h2>
    ${Object.values(state.agents)
      .map(
        (agent) => `
          <article class="agent">
            <strong>${agent.id} ${agent.type}</strong>
            <small>(${agent.x}, ${agent.y}) ${agent.water !== undefined ? `Water ${agent.water}` : ""}</small>
            <small>${agent.lastAction}</small>
          </article>
        `
      )
      .join("")}
  `;

  els.events.innerHTML = (state.events || [])
    .slice(0, 18)
    .map((event) => `<li><strong>${event.type}</strong> ${event.text}<br><small>${formatTime(event.at)}</small></li>`)
    .join("");
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

connect();
