export const DETECTION_CONFIG = Object.freeze({ minGapMs: 17000, maxGapMs: 20000, lampMs: 3000, maxFrameGapMs: 250 });
export const DETECTION_INSTRUCTION = "Your main job is the wildfire task. If the amber lamp turns on, press Space as quickly as you can without neglecting the fire.";

// Browser timing stays independent of simulation ticks and network round trips.
export class DetectionTask {
  constructor({ clock, epoch, random = Math.random, id, onLamp, onRecord, scenarioTime, textFocused = () => false }) {
    Object.assign(this, { clock, epoch, random, id, onLamp, onRecord, scenarioTime, textFocused });
    this.active = false; this.probe = null; this.due = null; this.lastFrame = null;
  }
  delay() { return DETECTION_CONFIG.minGapMs + this.random() * (DETECTION_CONFIG.maxGapMs - DETECTION_CONFIG.minGapMs); }
  resume() {
    if (this.active) return;
    this.active = true; this.lastFrame = this.clock(); this.due = this.lastFrame + this.delay();
  }
  suspend(reason = "paused") {
    if (this.probe) this.finish(this.clock(), "interrupted", reason);
    this.active = false; this.due = null; this.lastFrame = null; this.onLamp(false);
  }
  tick() {
    if (!this.active) return;
    const now = this.clock();
    if (this.lastFrame !== null && now - this.lastFrame > DETECTION_CONFIG.maxFrameGapMs) {
      if (this.probe) this.finish(now, "interrupted", "frame_gap");
      this.due = now + this.delay();
    }
    this.lastFrame = now;
    if (this.probe && this.textFocused()) this.probe.record.text_focus_during_probe = true;
    if (this.probe && now >= this.probe.end) this.finish(now);
    if (!this.probe && now >= this.due) {
      this.probe = { end: now + DETECTION_CONFIG.lampMs, onset: now, record: {
        id: this.id(), revision: 1, kind: "probe", status: "pending", probe_onset_ms: this.epoch(now),
        response_ms: null, rt_ms: null, hit: false, miss: false, false_alarm: false,
        text_focus_at_onset: this.textFocused(), text_focus_during_probe: this.textFocused(),
        scenario_time_ms: this.scenarioTime(), lamp_off_ms: null, interruption_reason: null
      }};
      this.onLamp(true); this.onRecord({ ...this.probe.record });
    }
  }
  press({ repeat = false, editable = false } = {}) {
    if (!this.active || repeat || editable) return false;
    const now = this.clock();
    if (this.probe && now >= this.probe.end) this.finish(now);
    if (this.probe) {
      if (this.probe.record.response_ms !== null) return true; // First response only.
      Object.assign(this.probe.record, { response_ms: this.epoch(now), rt_ms: now - this.probe.onset, hit: true, revision: this.probe.record.revision + 1 });
      this.onRecord({ ...this.probe.record });
    } else {
      this.onRecord({ id: this.id(), revision: 1, kind: "false_alarm", status: "false_alarm", probe_onset_ms: null,
        response_ms: this.epoch(now), rt_ms: null, hit: false, miss: false, false_alarm: true,
        text_focus_at_onset: this.textFocused(), text_focus_during_probe: this.textFocused(),
        scenario_time_ms: this.scenarioTime(), lamp_off_ms: null, interruption_reason: null });
    }
    return true;
  }
  finish(now, status, reason = null) {
    const record = this.probe.record;
    this.onLamp(false);
    this.onRecord({ ...record, revision: record.revision + 1, lamp_off_ms: this.epoch(now),
      status: status || (record.hit ? "hit" : "miss"), miss: !status && !record.hit,
      interruption_reason: reason });
    this.probe = null;
    // Full on-duration is retained after a response; delay starts at actual off.
    this.due = now + this.delay();
  }
}
