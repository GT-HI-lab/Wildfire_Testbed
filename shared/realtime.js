export async function loadRuntimeConfig() {
  if (window.WILDFIRE_CONFIG?.SUPABASE_URL && window.WILDFIRE_CONFIG?.SUPABASE_ANON_KEY) {
    return window.WILDFIRE_CONFIG;
  }

  try {
    const response = await fetch("/.netlify/functions/config", { cache: "no-store" });
    if (response.ok) {
      const config = await response.json();
      if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) return config;
    }
  } catch {
    // Local static preview without Netlify functions.
  }

  return {};
}

export function describeConnectionMode(store) {
  if (!store) return "Not connected";
  if (store.mode === "supabase" && store.realtimeStatus === "connected") {
    return "Cross-device: Supabase connected";
  }
  if (store.mode === "supabase" && store.realtimeStatus === "connecting") {
    return "Cross-device: Supabase connecting";
  }
  if (store.mode === "supabase") {
    return `Supabase error: ${store.connectionError || "realtime unavailable"}`;
  }
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
    this.localKey = `wildfire-session:${sessionId}`;
    this.messageKey = `wildfire-messages:${sessionId}`;
    this.channel = new BroadcastChannel(`wildfire:${sessionId}`);
    this.channel.onmessage = (event) => this.handleLocalMessage(event.data);
    this.supabase = null;
    this.remoteChannel = null;
    this.pollTimer = null;
    this.pollBusy = false;
    this.lastRevision = 0;
    this.mode = "local";
    this.realtimeStatus = "local";
    this.connectionError = "";
  }

  async connect() {
    const config = await loadRuntimeConfig();
    if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase) {
      this.supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      this.setConnection("supabase", "connecting", "");
      await this.subscribeSupabase();
      if (this.realtimeStatus === "connected") return this;
    }

    if (await this.connectNetlify()) return this;

    const localHost = ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
    this.setConnection(
      "local",
      "local",
      localHost ? "Use Netlify Dev to test the shared backend locally" : "Netlify shared session service is unavailable"
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

  async subscribeSupabase() {
    this.remoteChannel = this.supabase.channel(`wildfire-session-${this.sessionId}`);
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = setTimeout(() => {
        this.setConnection("supabase", "error", "Realtime subscription timed out");
        finish();
      }, 8000);

      this.remoteChannel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "wildfire_sessions",
            filter: `id=eq.${this.sessionId}`
          },
          (payload) => {
            if (payload.new?.state) this.handlers.onState?.(payload.new.state);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "wildfire_messages",
            filter: `session_id=eq.${this.sessionId}`
          },
          (payload) => this.handlers.onRemoteMessage?.(payload.new)
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timeout);
            this.setConnection("supabase", "connected", "");
            finish();
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            clearTimeout(timeout);
            this.setConnection("supabase", "error", `Realtime channel ${status.toLowerCase()}`);
            finish();
          }
        });
    });
  }

  async loadState() {
    if (this.mode === "supabase") {
      const { data, error } = await this.supabase
        .from("wildfire_sessions")
        .select("state")
        .eq("id", this.sessionId)
        .maybeSingle();
      if (!error && data?.state) return data.state;
      if (error) this.reportSupabaseError("State load", error);
    }

    if (this.mode === "netlify") {
      const response = await fetch(this.sessionUrl(), { cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) {
        this.reportNetlifyError("State load", response.status);
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
    const pendingEvents = [...(state.pendingEvents || [])];
    state.pendingEvents = [];
    state.updatedAt = Date.now();
    if (this.mode === "supabase") {
      const { error } = await this.supabase.from("wildfire_sessions").upsert({
        id: this.sessionId,
        state,
        status: state.status,
        paused: state.paused,
        updated_at: new Date().toISOString()
      });
      if (error) this.reportSupabaseError("State save", error);
      if (pendingEvents.length) {
        const { error: eventError } = await this.supabase.from("wildfire_events").insert(
          pendingEvents.map((event) => ({
            session_id: this.sessionId,
            tick: event.tick,
            event_type: event.eventType || event.type,
            body: event
          }))
        );
        if (eventError) this.reportSupabaseError("Event save", eventError);
      }
    }

    if (this.mode === "netlify") {
      const response = await fetch(this.sessionUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      });
      if (!response.ok) {
        this.reportNetlifyError("State save", response.status);
      } else {
        const saved = (await response.json()).state;
        state._syncRevision = saved._syncRevision;
        state.updatedAt = saved.updatedAt;
        this.lastRevision = saved._syncRevision;
      }
    }

    localStorage.setItem(this.localKey, JSON.stringify(state));
    this.channel.postMessage({ type: "state", state });
  }

  async appendEvent(event) {
    if (this.mode === "supabase") {
      const { error } = await this.supabase.from("wildfire_events").insert({
        session_id: this.sessionId,
        tick: event.tick,
        event_type: event.type,
        body: event
      });
      if (error) this.reportSupabaseError("Event save", error);
    }
  }

  async sendMessage(message) {
    if (this.mode === "supabase") {
      const { error } = await this.supabase.from("wildfire_messages").insert({
        session_id: this.sessionId,
        role: message.role,
        author: message.author,
        text: message.text,
        body: message
      });
      if (error) this.reportSupabaseError("Message save", error);
    }

    const messages = JSON.parse(localStorage.getItem(this.messageKey) || "[]");
    messages.push(message);
    localStorage.setItem(this.messageKey, JSON.stringify(messages.slice(-200)));
    this.channel.postMessage({ type: "message", message });
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

  reportSupabaseError(operation, error) {
    const detail = error?.message || error?.details || "unknown Supabase error";
    this.setConnection("supabase", "error", `${operation} failed: ${detail}`);
  }

  reportNetlifyError(operation, status) {
    this.setConnection("netlify", "error", `${operation} failed (HTTP ${status})`);
  }

  sessionUrl() {
    return `/.netlify/functions/session-state?sessionId=${encodeURIComponent(this.sessionId)}`;
  }

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollNetlify(), 700);
  }

  async pollNetlify() {
    if (this.mode !== "netlify" || this.pollBusy) return;
    this.pollBusy = true;
    try {
      const response = await fetch(this.sessionUrl(), { cache: "no-store" });
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
    if (this.channel) this.channel.close();
    if (this.supabase && this.remoteChannel) await this.supabase.removeChannel(this.remoteChannel);
    this.channel = null;
    this.remoteChannel = null;
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
