import {
  advanceSimulation,
  applyReliabilityPairing,
  clearSurvey,
  cloneState,
  createInitialSession,
  ensureSessionShape,
  pushEvent,
  requestSurvey,
  setPaused
} from "../shared/simulation.js";
import { renderMap } from "../shared/map-renderer.js";
import { describeConnectionMode, formatTime, SessionStore } from "../shared/realtime.js";

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
  conditionSummary: document.querySelector("#conditionSummary"),
  metrics: document.querySelector("#metrics"),
  agents: document.querySelector("#agentList"),
  debug: document.querySelector("#experimentDebug"),
  events: document.querySelector("#eventList"),
  clearSurvey: document.querySelector("#clearSurveyBtn"),
  surveyUrlStatus: document.querySelector("#surveyUrlStatus"),
  missionClock: document.querySelector("#missionClock"),
  aiStatus: document.querySelector("#aiStatus"),
  realtimeStatus: document.querySelector("#realtimeStatus")
};

let store = null;
let state = null;
let clock = null;
let clockBusy = false;
let aiEnabled = false;
let droneBriefInFlight = false;
const PLACEHOLDER_SURVEY_URL = "https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER";
let surveyUrl = window.WILDFIRE_CONFIG?.QUALTRICS_SURVEY_URL || PLACEHOLDER_SURVEY_URL;

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
  button.addEventListener("click", () => mutate((draft) => requestSurvey(draft, button.dataset.survey, surveyUrl)));
});

window.addEventListener("resize", render);
setInterval(renderMissionClock, 250);

async function connect() {
  const sessionId = els.sessionId.value.trim() || "pilot-001";
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    onState(next) {
      const incoming = ensureSessionShape(next);
      if (state?.mission?.deadlineAt && incoming.mission?.deadlineAt === state.mission.deadlineAt) {
        incoming.mission.elapsedSeconds = Math.max(state.mission.elapsedSeconds, incoming.mission.elapsedSeconds);
        incoming.mission.remainingSeconds = Math.min(state.mission.remainingSeconds, incoming.mission.remainingSeconds);
        incoming.mission.completed = state.mission.completed || incoming.mission.completed;
        incoming.tick = Math.max(state.tick, incoming.tick);
        incoming.paused = state.paused;
        incoming.pauseReason = state.pauseReason;
        incoming.status = state.status;
        incoming.condition = state.condition;
        incoming.reliability = state.reliability;
      }
      state = incoming;
      render();
    },
    onConnection() {
      renderConnectionStatus();
    }
  });
  await store.connect();
  state = ensureSessionShape((await store.loadState()) || createInitialSession(sessionId));
  await store.saveState(state);
  await loadAiConfig();
  startClock();
  render();
}

function startClock() {
  clearInterval(clock);
  clock = setInterval(async () => {
    if (!state || state.paused || clockBusy) return;
    clockBusy = true;
    try {
      const previousTick = state.tick;
      const draft = cloneState(state);
      advanceSimulation(draft, Date.now());
      state = draft;
      await store.saveState(state);
      render();
      if (aiEnabled && Math.floor(state.tick / 30) > Math.floor(previousTick / 30)) refreshDroneBrief();
    } finally {
      clockBusy = false;
    }
  }, 1000);
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
  renderConnectionStatus();
  renderMap(els.canvas, state, { alignTop: true });
  els.status.textContent = state.mission?.completed ? "Complete" : state.paused ? "Paused" : state.status === "running" ? "Running" : "Ready";
  els.status.className = `pill ${state.mission?.completed || state.paused ? "paused" : state.status === "running" ? "running" : ""}`;
  els.tick.textContent = `Tick ${state.tick}`;
  renderMissionClock();
  els.condition.value = state.condition;
  els.conditionSummary.textContent = conditionSummary(state.condition);

  const m = state.metrics;
  els.metrics.innerHTML = [
    metric("Score", m.score),
    metric("Fires", state.fires.length),
    metric("Detections", m.droneDetections),
    metric("Water drops", m.waterDrops),
    metric("FF refills", m.firefighterRefills ?? 0),
    metric("Water transfers", m.waterTransfers ?? 0),
    metric("Bulldozer", m.bulldozerActions ?? 0),
    metric("Accepts", m.acceptedRecommendations),
    metric("Overrides", m.overrides),
    metric("Sections", state.experiment?.sectionsCompleted ?? 0)
  ].join("");

  els.agents.innerHTML = `
    <h2>Agents</h2>
    ${Object.values(state.agents)
      .map(
        (agent) => `
          <article class="agent">
            <span class="agent-badge ${agent.type}" aria-hidden="true">${agentInitials(agent.type)}</span>
            <div>
              <strong>${agent.id} ${agent.type}</strong>
              <small>(${Math.round(agent.x)}, ${Math.round(agent.y)}) ${agent.water !== undefined ? `Water ${agent.water}` : ""}</small>
              <small>${agent.lastAction}</small>
            </div>
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

async function loadAiConfig() {
  try {
    const response = await fetch("/.netlify/functions/config");
    if (!response.ok) throw new Error("config unavailable");
    const config = await response.json();
    surveyUrl = config.QUALTRICS_SURVEY_URL || surveyUrl;
    renderSurveyUrlStatus();
    aiEnabled = Boolean(config.AI_ENABLED);
    els.aiStatus.textContent = aiEnabled
      ? `${providerLabel(config.AI_PROVIDER)} ${config.AI_MODEL}`
      : "Deterministic fallback";
    els.aiStatus.classList.toggle("connected", aiEnabled);
  } catch {
    aiEnabled = false;
    els.aiStatus.textContent = "Local fallback";
    renderSurveyUrlStatus();
  }
}

function renderSurveyUrlStatus() {
  const placeholder = surveyUrl === PLACEHOLDER_SURVEY_URL;
  els.surveyUrlStatus.textContent = placeholder ? "Placeholder survey link" : "Survey link configured";
  els.surveyUrlStatus.classList.toggle("connected", !placeholder);
  els.surveyUrlStatus.title = surveyUrl;
}

function providerLabel(provider) {
  return provider === "gemini" ? "Gemini" : provider === "openai" ? "OpenAI" : "AI";
}

async function refreshDroneBrief() {
  if (droneBriefInFlight || !state) return;
  droneBriefInFlight = true;
  const snapshot = cloneState(state);
  try {
    const response = await fetch("/.netlify/functions/agent-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "drone",
        intent: "periodic_reconnaissance_brief",
        state: snapshot,
        fallbackText: snapshot.droneReport
      })
    });
    if (!response.ok) return;
    const reply = await response.json();
    if (!reply.text || !state) return;
    updateAiStatusFromReply(reply);
    const draft = cloneState(state);
    draft.droneReport = reply.text;
    pushEvent(draft, "drone_ai_brief", "Drone AI generated reconnaissance brief", {
      ai: Boolean(reply.ai),
      text: reply.text
    });
    state = draft;
    await store.saveState(state);
    render();
  } finally {
    droneBriefInFlight = false;
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
      : "Local only - configure Supabase";
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

function conditionSummary(condition) {
  if (condition === "High-High") {
    return "Helicopter navigation is accurate; drone behavior remains fixed.";
  }
  if (condition === "Low-Low") {
    return "Helicopter routes are consistently offset; drone behavior remains fixed.";
  }
  return "Helicopter navigation has one recoverable hidden failure after two sections; drone behavior remains fixed.";
}

function formatCountdown(seconds) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function agentInitials(type) {
  return { firefighter: "FF", drone: "DR", bulldozer: "DZ", helicopter: "HE" }[type] || "AI";
}

function renderDebug(current) {
  const exp = current.experiment || {};
  const heli = current.agents.helicopter || {};
  const bulldozer = current.agents.bulldozer || {};
  const sections = exp.sections || {};
  const rows = [
    ["condition", current.condition],
    ["helicopter reliability", current.reliability?.helicopter],
    ["drone behavior", "fixed across conditions"],
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
