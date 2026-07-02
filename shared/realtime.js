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
  }

  async connect() {
    const config = await loadRuntimeConfig();
    if (window.supabase && config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
      this.supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      this.mode = "supabase";
      await this.subscribeSupabase();
    }
    return this;
  }

  async subscribeSupabase() {
    this.remoteChannel = this.supabase.channel(`wildfire-session-${this.sessionId}`);
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
      .subscribe();
  }

  async loadState() {
    if (this.mode === "supabase") {
      const { data, error } = await this.supabase
        .from("wildfire_sessions")
        .select("state")
        .eq("id", this.sessionId)
        .maybeSingle();
      if (!error && data?.state) return data.state;
    }

    const raw = localStorage.getItem(this.localKey);
    return raw ? JSON.parse(raw) : null;
  }

  async saveState(state) {
    const pendingEvents = [...(state.pendingEvents || [])];
    state.pendingEvents = [];
    state.updatedAt = Date.now();
    if (this.mode === "supabase") {
      await this.supabase.from("wildfire_sessions").upsert({
        id: this.sessionId,
        state,
        status: state.status,
        paused: state.paused,
        updated_at: new Date().toISOString()
      });
      if (pendingEvents.length) {
        await this.supabase.from("wildfire_events").insert(
          pendingEvents.map((event) => ({
            session_id: this.sessionId,
            tick: event.tick,
            event_type: event.eventType || event.type,
            body: event
          }))
        );
      }
    }

    localStorage.setItem(this.localKey, JSON.stringify(state));
    this.channel.postMessage({ type: "state", state });
  }

  async appendEvent(event) {
    if (this.mode === "supabase") {
      await this.supabase.from("wildfire_events").insert({
        session_id: this.sessionId,
        tick: event.tick,
        event_type: event.type,
        body: event
      });
    }
  }

  async sendMessage(message) {
    if (this.mode === "supabase") {
      await this.supabase.from("wildfire_messages").insert({
        session_id: this.sessionId,
        role: message.role,
        author: message.author,
        text: message.text,
        body: message
      });
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
