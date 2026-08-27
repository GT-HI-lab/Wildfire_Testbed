export function describeConnectionMode(store) {
  if (!store) return "Not connected";
  if (store.mode === "netlify" && store.realtimeStatus === "connected") {
    return "Cross-device: Netlify shared session connected";
  }
  if (store.mode === "netlify") {
    return `Shared session error: ${store.connectionError || "Netlify session service unavailable"}`;
  }
  return `Local development only: ${store.connectionError || "shared backend unavailable"}`;
}

export class SessionStore {
  constructor(sessionId, handlers = {}) {
    this.sessionId = sessionId;
    this.handlers = handlers;
    this.accessToken = handlers.accessToken || "";
    this.adminKey = handlers.adminKey || "";
    this.remoteOnly = Boolean(handlers.remoteOnly);
    this.localKey = `wildfire-session:${sessionId}`;
    this.messageKey = `wildfire-messages:${sessionId}`;
    this.channel = typeof BroadcastChannel === "function"
      ? new BroadcastChannel(`wildfire:${sessionId}`)
      : null;
    if (this.channel) this.channel.onmessage = (event) => this.handleLocalMessage(event.data);
    this.pollTimer = null;
    this.pollBusy = false;
    this.lastRevision = 0;
    this.mode = "local";
    this.realtimeStatus = "local";
    this.connectionError = "";
  }

  async connect() {
    if (await this.connectNetlify()) return this;
    if (this.remoteOnly) {
      this.setConnection("netlify", "error", "The shared study backend is unavailable");
      return this;
    }
    const localHost = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
    this.setConnection(
      "local",
      "local",
      localHost ? "Start the included development server to test the shared backend" : "Netlify shared session service is unavailable"
    );
    return this;
  }

  async connectNetlify() {
    try {
      const response = await fetch("/.netlify/functions/session-state?health=1", { cache: "no-store" });
      if (!response.ok) return false;
      this.setConnection("netlify", "connected", "");
      this.startPolling();
      return true;
    } catch {
      return false;
    }
  }

  async loadState() {
    if (this.mode === "netlify") {
      const response = await fetch(this.sessionUrl(), { cache: "no-store", headers: this.authHeaders() });
      if (response.status === 404) return null;
      if (!response.ok) {
        this.reportNetlifyError("State load", response.status);
        if (this.remoteOnly) throw new Error(`State load failed (HTTP ${response.status})`);
        return null;
      }
      const { state } = await response.json();
      this.lastRevision = state?._syncRevision || 0;
      return state;
    }
    const raw = localStorage.getItem(this.localKey);
    return raw ? JSON.parse(raw) : null;
  }

  async saveState(state) {
    state.pendingEvents = [];
    state.updatedAt = Date.now();
    if (this.mode === "netlify") {
      const response = await fetch(this.sessionUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ state })
      });
      if (!response.ok) {
        this.reportNetlifyError("State save", response.status);
        if (this.remoteOnly) throw new Error(`State save failed (HTTP ${response.status})`);
      } else {
        const saved = (await response.json()).state;
        state._syncRevision = saved._syncRevision;
        state.updatedAt = saved.updatedAt;
        this.lastRevision = saved._syncRevision;
      }
    }
    localStorage.setItem(this.localKey, JSON.stringify(state));
    this.channel?.postMessage({ type: "state", state });
  }

  async appendEvent() {
    // Events are persisted inside the strongly consistent session state.
  }

  async sendMessage(message) {
    const messages = JSON.parse(localStorage.getItem(this.messageKey) || "[]");
    messages.push(message);
    localStorage.setItem(this.messageKey, JSON.stringify(messages.slice(-200)));
    this.channel?.postMessage({ type: "message", message });
  }

  handleLocalMessage(data) {
    if (data?.type === "state") this.handlers.onState?.(data.state);
    if (data?.type === "message") this.handlers.onRemoteMessage?.(data.message);
  }

  setConnection(mode, realtimeStatus, connectionError) {
    this.mode = mode;
    this.realtimeStatus = realtimeStatus;
    this.connectionError = connectionError;
    this.handlers.onConnection?.({ mode, realtimeStatus, error: connectionError });
  }

  reportNetlifyError(operation, status) {
    this.setConnection("netlify", "error", `${operation} failed (HTTP ${status})`);
  }

  sessionUrl() {
    return `/.netlify/functions/session-state?sessionId=${encodeURIComponent(this.sessionId)}`;
  }

  authHeaders() {
    if (this.accessToken) return { Authorization: `Bearer ${this.accessToken}` };
    if (this.adminKey) return { "X-Admin-Key": this.adminKey };
    return {};
  }

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollNetlify(), 700);
  }

  async pollNetlify() {
    if (this.mode !== "netlify" || this.pollBusy) return;
    this.pollBusy = true;
    try {
      const response = await fetch(this.sessionUrl(), { cache: "no-store", headers: this.authHeaders() });
      if (response.status === 404) return;
      if (!response.ok) {
        this.reportNetlifyError("State refresh", response.status);
        return;
      }
      const { state } = await response.json();
      const revision = state?._syncRevision || 0;
      if (state && revision > this.lastRevision) {
        this.lastRevision = revision;
        this.handlers.onState?.(state);
      }
      if (this.realtimeStatus !== "connected") this.setConnection("netlify", "connected", "");
    } catch {
      this.setConnection("netlify", "error", "State refresh could not reach Netlify");
    } finally {
      this.pollBusy = false;
    }
  }

  async close() {
    this.handlers = {};
    clearInterval(this.pollTimer);
    this.channel?.close();
    this.channel = null;
    this.pollTimer = null;
  }
}

export function formatTime(at) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(at));
}
