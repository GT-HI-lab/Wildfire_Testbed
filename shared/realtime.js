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
  return `Local only: ${store.connectionError || "Supabase is not configured"}`;
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
    this.mode = "local";
    this.realtimeStatus = "local";
    this.connectionError = "";
  }

  async connect() {
    const config = await loadRuntimeConfig();
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      this.setConnection("local", "local", "Supabase URL or anon key is missing");
      return this;
    }
    if (!window.supabase) {
      this.setConnection("local", "local", "Supabase browser library did not load");
      return this;
    }

    this.supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    this.setConnection("supabase", "connecting", "");
    await this.subscribeSupabase();
    return this;
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

  async close() {
    this.handlers = {};
    if (this.channel) this.channel.close();
    if (this.supabase && this.remoteChannel) await this.supabase.removeChannel(this.remoteChannel);
    this.channel = null;
    this.remoteChannel = null;
  }
}

export function formatTime(at) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(at));
}
