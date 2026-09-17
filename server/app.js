import {
  advanceSimulation,
  cloneState,
  ensureSessionShape,
  pushEvent,
  setPaused
} from "../shared/simulation.js";
import { renderMap } from "../shared/map-renderer.js";
import { describeConnectionMode, formatTime, SessionStore } from "../shared/realtime.js";

const els = {
  canvas: document.querySelector("#mapCanvas"),
  adminKey: document.querySelector("#adminKey"),
  dashboard: document.querySelector("#dashboardBtn"),
  pauseEnrollment: document.querySelector("#pauseEnrollmentBtn"),
  resumeEnrollment: document.querySelector("#resumeEnrollmentBtn"),
  syncAnalytics: document.querySelector("#syncAnalyticsBtn"),
  enrollmentStatus: document.querySelector("#enrollmentStatus"),
  analyticsStatus: document.querySelector("#analyticsStatus"),
  studySummary: document.querySelector("#studySummary"),
  participantSessions: document.querySelector("#participantSessions"),
  exportRegistry: document.querySelector("#exportRegistryBtn"),
  sessionId: document.querySelector("#sessionId"),
  connect: document.querySelector("#connectBtn"),
  exportCsv: document.querySelector("#exportCsvBtn"),
  exportJson: document.querySelector("#exportJsonBtn"),
  pause: document.querySelector("#pauseBtn"),
  resume: document.querySelector("#resumeBtn"),
  status: document.querySelector("#statusPill"),
  tick: document.querySelector("#tickLabel"),
  conditionSummary: document.querySelector("#conditionSummary"),
  metrics: document.querySelector("#metrics"),
  agents: document.querySelector("#agentList"),
  debug: document.querySelector("#experimentDebug"),
  events: document.querySelector("#eventList"),
  surveyStatus: document.querySelector("#surveyStatus"),
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
let registry = null;

els.connect.addEventListener("click", connect);
els.dashboard.addEventListener("click", loadDashboard);
els.pauseEnrollment.addEventListener("click", () => updateEnrollment("pause"));
els.resumeEnrollment.addEventListener("click", () => updateEnrollment("resume"));
els.syncAnalytics.addEventListener("click", syncAnalytics);
els.exportRegistry.addEventListener("click", exportRegistry);
els.participantSessions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (!button) return;
  els.sessionId.value = button.dataset.sessionId;
  connect();
});
els.exportCsv.addEventListener("click", () => exportCsv());
els.exportJson.addEventListener("click", () => exportJson());
els.pause.addEventListener("click", () => mutate((draft) => setPaused(draft, true, "Experimenter paused the session")));
els.resume.addEventListener("click", () => mutate((draft) => setPaused(draft, false)));
window.addEventListener("resize", render);
setInterval(renderMissionClock, 250);

async function connect() {
  const sessionId = els.sessionId.value.trim();
  const adminKey = els.adminKey.value.trim();
  if (!sessionId || !adminKey) {
    els.enrollmentStatus.textContent = "Load the study and select a participant session first.";
    return;
  }
  if (store) await store.close();
  store = new SessionStore(sessionId, {
    adminKey,
    remoteOnly: true,
    onState(next) {
      const incoming = ensureSessionShape(next);
      if (state?.mission?.deadlineAt && incoming.mission?.deadlineAt === state.mission.deadlineAt) {
        const incomingSurveyRequest = Boolean(incoming.survey?.active && !state.survey?.active);
        incoming.mission.elapsedSeconds = Math.max(state.mission.elapsedSeconds, incoming.mission.elapsedSeconds);
        incoming.mission.remainingSeconds = Math.min(state.mission.remainingSeconds, incoming.mission.remainingSeconds);
        incoming.mission.completed = state.mission.completed || incoming.mission.completed;
        incoming.tick = Math.max(state.tick, incoming.tick);
        if (!incomingSurveyRequest) {
          incoming.paused = state.paused;
          incoming.pauseReason = state.pauseReason;
          incoming.status = state.status;
        }
        incoming.condition = state.condition;
        incoming.study = state.study;
        incoming.reliability = state.reliability;
        incoming.reliabilityCondition = state.reliabilityCondition;
        incoming.communicationStyle = state.communicationStyle;
      }
      state = incoming;
      render();
    },
    onConnection() {
      renderConnectionStatus();
    }
  });
  await store.connect();
  const loaded = await store.loadState();
  if (!loaded) throw new Error("The selected session was not found");
  state = ensureSessionShape(loaded);
  await loadAiConfig();
  render();
}

async function loadDashboard() {
  const adminKey = els.adminKey.value.trim();
  if (!adminKey) {
    els.enrollmentStatus.textContent = "Enter the administrator key first.";
    return;
  }
  els.enrollmentStatus.textContent = "Loading study status...";
  try {
    const response = await fetch("/.netlify/functions/study-admin", {
      cache: "no-store",
      headers: { "X-Admin-Key": adminKey }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Study status could not be loaded");
    registry = result;
    renderDashboard(result);
  } catch (error) {
    els.enrollmentStatus.textContent = error.message;
  }
}

async function updateEnrollment(action) {
  const adminKey = els.adminKey.value.trim();
  if (!adminKey) return loadDashboard();
  try {
    const response = await fetch("/.netlify/functions/study-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      body: JSON.stringify({ action })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Enrollment could not be updated");
    await loadDashboard();
  } catch (error) {
    els.enrollmentStatus.textContent = error.message;
  }
}

async function syncAnalytics() {
  const adminKey = els.adminKey.value.trim();
  if (!adminKey) return loadDashboard();
  els.syncAnalytics.disabled = true;
  let offset = 0;
  let sessions = 0;
  let failures = 0;
  try {
    while (true) {
      const response = await fetch("/.netlify/functions/study-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({ action: "sync_analytics", offset })
      });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result.error || "Analytics could not be synchronized");
      sessions += result.processedSessions || 0;
      failures += result.failures || 0;
      offset = result.nextOffset || offset;
      els.analyticsStatus.textContent = `Supabase sync: ${Math.min(offset, result.totalParticipants)} of ${result.totalParticipants} participants.`;
      if (result.done) break;
    }
    els.analyticsStatus.textContent = failures
      ? `Supabase sync finished: ${sessions} sessions, ${failures} failures. Check Function logs.`
      : `Supabase sync finished: ${sessions} sessions are analysis-ready.`;
    await loadDashboard();
  } catch (error) {
    els.analyticsStatus.textContent = error.message;
  } finally {
    els.syncAnalytics.disabled = false;
  }
}

function renderDashboard(result) {
  els.enrollmentStatus.textContent = result.settings.enrollmentPaused
    ? "New enrollment is paused. Active sessions can continue."
    : "Enrollment is open and runs without this dashboard.";
  els.analyticsStatus.textContent = result.analyticsConfigured
    ? "Supabase analytics is connected. Sync Analytics also backfills earlier sessions."
    : "Supabase analytics is not configured; live games still save to Netlify Blobs.";
  els.syncAnalytics.disabled = !result.analyticsConfigured;
  els.studySummary.innerHTML = `
    <div class="registry-total"><strong>${result.participantCount}</strong><span>assigned participants</span></div>
    <div class="cell-grid">
      ${Object.entries(result.cells).map(([id, cell]) => `
        <div class="cell-row">
          <strong>${escapeHtml(id)}</strong>
          <span>${cell.assigned} assigned</span>
          <span>complete ${cell.completedWaves.join("/")}</span>
        </div>
      `).join("")}
    </div>
  `;
  const sessions = result.participants.flatMap((participant) =>
    Object.values(participant.waves || {}).map((wave) => ({
      ...wave,
      participant: participant.prolificParticipantId,
      cell: participant.assignment.id
    }))
  ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  els.participantSessions.innerHTML = sessions.length
    ? sessions.slice(0, 80).map((session) => `
        <button class="session-row secondary" data-session-id="${escapeHtml(session.gameSessionId)}">
          <strong>${escapeHtml(session.participant)}</strong>
          <span>${escapeHtml(session.cell)} | wave ${session.wave} | ${escapeHtml(session.status)}</span>
        </button>
      `).join("")
    : "<small>No participant sessions have enrolled yet.</small>";
}

function exportRegistry() {
  if (!registry) return;
  download(
    `wildfire-prolific-registry-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(registry, null, 2),
    "application/json"
  );
}

function startClock() {
  clearInterval(clock);
  clock = setInterval(advanceClock, 1000);
}

async function advanceClock() {
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
  els.conditionSummary.textContent = conditionSummary(state);
  els.surveyStatus.textContent = state.survey?.completed
    ? "Final survey submitted"
    : state.survey?.active
      ? `${state.survey.label || "Survey"} open in participant client`
      : "Opens automatically in the participant client when the mission ends.";
  els.surveyStatus.classList.toggle("connected", Boolean(state.survey?.completed));

  const m = state.metrics;
  els.metrics.innerHTML = [
    metric("Score", m.score),
    metric("Fires", state.fires.length),
    metric("Detections", m.droneDetections),
    metric("Water drops", m.waterDrops),
    metric("FF refills", m.firefighterRefills ?? 0),
    metric("FF cuts", m.firefighterCuts ?? 0),
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
    aiEnabled = Boolean(config.AI_ENABLED);
    els.aiStatus.textContent = aiEnabled
      ? "AI online"
      : config.AI_CONFIGURED
        ? "AI unavailable"
        : "AI not configured";
    els.aiStatus.classList.toggle("connected", aiEnabled);
    els.aiStatus.title = config.AI_DIAGNOSTIC || "AI status unavailable.";
  } catch {
    aiEnabled = false;
    els.aiStatus.textContent = "AI status error";
    els.aiStatus.title = "The config Function could not be reached. Confirm the latest Netlify deployment includes netlify/functions/config.mjs.";
  }
}

async function refreshDroneBrief() {
  if (droneBriefInFlight || !state) return;
  droneBriefInFlight = true;
  const snapshot = cloneState(state);
  try {
    const response = await fetch("/.netlify/functions/agent-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...store.authHeaders() },
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
    els.aiStatus.textContent = "AI online";
    els.aiStatus.classList.add("connected");
    els.aiStatus.title = "This reply was generated by the configured AI provider.";
    return;
  }
  els.aiStatus.textContent = reply.diagnosticCode === "missing_configuration"
    ? "AI not configured"
    : "AI unavailable";
  els.aiStatus.classList.remove("connected");
  els.aiStatus.title = reply.diagnostic || "The built-in deterministic dialogue produced this reply.";
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

function conditionSummary(current) {
  const label = current.reliabilityCondition?.label || current.condition;
  return `Sequence ${current.study?.sequence || "A"}, game ${current.study?.gameNumber || 1}: ${current.condition} ${label} (Helicopter-Drone), fixed for the full mission.`;
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
    ["sequence", current.study?.sequence],
    ["game number", current.study?.gameNumber],
    ["communication style", current.communicationStyle],
    ["full-game pairing", current.reliabilityCondition?.label],
    ["helicopter reliability", current.reliability?.helicopter],
    ["drone reliability", current.reliability?.drone],
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
