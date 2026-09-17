import { DetectionTask } from "../shared/detection-task.js";

export async function createDetectionController({ sessionId, headers, getState, isBlocked, lamp }) {
  const key = `wildfire-detection-queue:${sessionId}`;
  let queue = {};
  try { queue = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* Empty queue. */ }
  let release;
  const owned = await new Promise((resolve) => {
    if (!navigator.locks) return resolve(false);
    navigator.locks.request(`wildfire-detection:${sessionId}`, { ifAvailable: true }, async (lock) => {
      resolve(Boolean(lock));
      if (lock) await new Promise((done) => { release = done; });
    }).catch(() => resolve(false));
  });
  if (!owned) throw new Error("Keep this game open in one browser tab only. Close the other tab and retry. A current desktop browser is required.");
  function persist() { localStorage.setItem(key, JSON.stringify(queue)); }
  for (const r of Object.values(queue)) {
    if (r.status === "pending") Object.assign(r, { revision: r.revision + 1, status: "interrupted", interruption_reason: "reload", lamp_off_ms: performance.timeOrigin + performance.now(), miss: false });
  }
  persist();
  let busy = false;
  async function flush() {
    if (busy) return false;
    busy = true;
    try {
      const batch = Object.values(queue).slice(0, 100);
      if (!batch.length) return true;
      const response = await fetch(`/.netlify/functions/detection-events?sessionId=${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.timeout(15000), method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ records: batch })
      });
      if (!response.ok) throw new Error("Detection responses could not be saved. Check your connection and retry.");
      for (const r of batch) if (queue[r.id]?.revision === r.revision && r.status !== "pending") delete queue[r.id];
      persist();
      return Object.values(queue).every((r) => r.status === "pending");
    } finally { busy = false; }
  }
  const task = new DetectionTask({ clock: () => performance.now(), epoch: (t) => performance.timeOrigin + t,
    textFocused: () => Boolean(document.activeElement?.matches("input,textarea,select,[contenteditable=true]")),
    random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
    id: () => crypto.randomUUID(), onLamp: (on) => { lamp.classList.toggle("on", on); lamp.setAttribute("data-on", String(on)); },
    scenarioTime: () => {
      const state = getState();
      const mission = state.mission;
      const remaining = state.paused || !mission.deadlineAt ? mission.remainingSeconds * 1000 : Math.max(0, mission.deadlineAt - Date.now());
      return Math.max(0, Math.min(mission.durationSeconds * 1000, mission.durationSeconds * 1000 - remaining));
    },
    onRecord: (record) => { queue[record.id] = record; persist(); }
  });
  let frame;
  let stopped = false;
  function update() {
    if (stopped) return;
    const state = getState();
    const blocked = !state || state.paused || state.mission.completed || !state.secondaryTask?.instructionAccepted || isBlocked() || document.hidden || !document.hasFocus();
    if (blocked) task.suspend(document.hidden || !document.hasFocus() ? "tab_inactive" : "game_paused");
    else { task.resume(); task.tick(); }
    frame = requestAnimationFrame(update);
  }
  let down = false;
  function keydown(event) {
    if (event.code !== "Space") return;
    const state = getState();
    if (!state || state.paused || state.mission.completed || isBlocked() || !state.secondaryTask?.instructionAccepted || document.hidden || !document.hasFocus()) return;
    const editable = Boolean(event.target.closest?.('input,textarea,select,[contenteditable="true"]'));
    if (task.press({ repeat: event.repeat || down, editable })) event.preventDefault();
    down = true;
  }
  function keyup(event) { if (event.code === "Space") down = false; }
  function pause() { down = false; task.suspend("tab_inactive"); }
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("keyup", keyup, true);
  window.addEventListener("blur", pause);
  document.addEventListener("visibilitychange", pause);
  window.addEventListener("pagehide", pause);
  const timer = setInterval(() => { flush().catch(() => {}); }, 2000);
  update();
  return {
    async flushAll() {
      task.suspend("game_complete");
      for (let attempt = 0; attempt < 30; attempt++) {
        if (await flush()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Detection responses are still saving. Please retry completion.");
    },
    close() {
      stopped = true; task.suspend("session_closed"); clearInterval(timer); cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keydown, true); window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", pause); window.removeEventListener("pagehide", pause); document.removeEventListener("visibilitychange", pause);
      release?.();
    }
  };
}
