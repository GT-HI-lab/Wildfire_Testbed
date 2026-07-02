import {
  advanceSimulation,
  applyReliabilityPairing,
  clearSurvey,
  cloneState,
  createInitialSession,
  ensureSessionShape,
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
  exportCsv: document.querySelector("#exportCsvBtn"),
  exportJson: document.querySelector("#exportJsonBtn"),
  pause: document.querySelector("#pauseBtn"),
  resume: document.querySelector("#resumeBtn"),
  status: document.querySelector("#statusPill"),
  tick: document.querySelector("#tickLabel"),
  condition: document.querySelector("#conditionSelect"),
  metrics: document.querySelector("#metrics"),
  agents: document.querySelector("#agentList"),
  debug: document.querySelector("#experimentDebug"),
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
els.exportCsv.addEventListener("click", () => exportCsv());
els.exportJson.addEventListener("click", () => exportJson());
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
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    onState(next) {
      state = ensureSessionShape(next);
      render();
    }
  });
  await store.connect();
  state = ensureSessionShape((await store.loadState()) || createInitialSession(sessionId));
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
    metric("Water transfers", m.waterTransfers ?? 0),
    metric("Bulldozer", m.bulldozerActions ?? 0),
    metric("Accepts", m.acceptedRecommendations),
    metric("Overrides", m.overrides),
    metric("Sections", state.experiment?.sectionsCompleted ?? 0),
    metric("Distrust", m.distrust ?? 0)
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

  els.debug.innerHTML = renderDebug(state);

  els.events.innerHTML = (state.events || [])
    .slice(0, 120)
    .map((event) => `<li><strong>${event.type}</strong> ${event.text}<br><small>${formatTime(event.at)}</small></li>`)
    .join("");
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderDebug(current) {
  const exp = current.experiment || {};
  const heli = current.agents.helicopter || {};
  const bulldozer = current.agents.bulldozer || {};
  const sections = exp.sections || {};
  const rows = [
    ["condition", current.condition],
    ["sectionsCompleted", exp.sectionsCompleted],
    ["NW", sectionDebug(sections.NW)],
    ["NE", sectionDebug(sections.NE)],
    ["SW", sectionDebug(sections.SW)],
    ["SE", sectionDebug(sections.SE)],
    ["malfunctionTriggered", exp.malfunctionTriggered],
    ["malfunctionActive", exp.malfunctionActive],
    ["malfunctionStartedAtTick", exp.malfunctionStartedAtTick],
    ["malfunctionRecoveredAtTick", exp.malfunctionRecoveredAtTick],
    ["recoveryReason", exp.recoveryReason],
    ["helicopter reportedAction", heli.reportedAction],
    ["helicopter actualAction", heli.actualAction],
    ["intendedTarget", formatPoint(heli.intendedTarget)],
    ["actualTarget", formatPoint(heli.actualTarget)],
    ["bulldozer", `${formatPoint(bulldozer)} ${bulldozer.lastAction || ""}`]
  ];
  return rows
    .map(
      ([label, value]) => `
        <div class="debug-row">
          <span>${escapeHtml(String(label))}</span>
          <strong>${escapeHtml(String(value ?? ""))}</strong>
        </div>
      `
    )
    .join("");
}

function sectionDebug(section) {
  if (!section) return "";
  return `${section.completed ? "complete" : "active"} (${section.fireRemaining}/${section.initialFire})`;
}

function formatPoint(point) {
  return point ? `(${point.x}, ${point.y})` : "";
}

function exportJson() {
  if (!state) return;
  download(
    `${state.id || "wildfire"}-export.json`,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        sessionId: state.id,
        state,
        events: state.events || []
      },
      null,
      2
    ),
    "application/json"
  );
}

function exportCsv() {
  if (!state) return;
  const rows = [
    [
      "id",
      "at",
      "tick",
      "eventType",
      "text",
      "target",
      "value",
      "reportedAction",
      "actualAction",
      "intendedTarget",
      "actualTarget",
      "malfunctionActive",
      "recoveryReason",
      "json"
    ]
  ];

  for (const event of state.events || []) {
    const helicopter = event.helicopter || event.snapshot?.agents?.helicopter || {};
    rows.push([
      event.id,
      new Date(event.at).toISOString(),
      event.tick,
      event.eventType || event.type,
      event.text,
      event.target || "",
      event.value || "",
      helicopter.reportedAction || "",
      helicopter.actualAction || "",
      formatPoint(helicopter.intendedTarget),
      formatPoint(helicopter.actualTarget),
      event.malfunctionActive ?? state.experiment?.malfunctionActive ?? "",
      event.recoveryReason || "",
      JSON.stringify(event)
    ]);
  }

  download(`${state.id || "wildfire"}-events.csv`, rows.map(csvRow).join("\n"), "text/csv");
}

function csvRow(row) {
  return row
    .map((value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(",");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

connect();
