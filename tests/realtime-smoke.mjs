import { describeConnectionMode, SessionStore } from "../shared/realtime.js";

const localValues = new Map();
globalThis.localStorage = {
  getItem(key) {
    return localValues.get(key) || null;
  },
  setItem(key, value) {
    localValues.set(key, value);
  }
};

globalThis.BroadcastChannel = class {
  postMessage() {}
  close() {}
};

let savedState = null;
const fakeClient = {
  channel() {
    return {
      on() {
        return this;
      },
      subscribe(callback) {
        callback("SUBSCRIBED");
        return this;
      }
    };
  },
  from(table) {
    if (table === "wildfire_sessions") {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: savedState ? { state: savedState } : null, error: null };
        },
        async upsert(payload) {
          savedState = payload.state;
          return { error: null };
        }
      };
    }
    return {
      async insert() {
        return { error: null };
      }
    };
  },
  async removeChannel() {}
};

globalThis.window = {
  WILDFIRE_CONFIG: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "public-test-key"
  },
  supabase: {
    createClient() {
      return fakeClient;
    }
  }
};

const remoteStore = new SessionStore("realtime-test");
await remoteStore.connect();
assert(remoteStore.mode === "supabase", "Supabase mode is selected");
assert(remoteStore.realtimeStatus === "connected", "Realtime subscription is confirmed");
assert(describeConnectionMode(remoteStore).includes("Supabase connected"), "Connected status is visible");

await remoteStore.saveState({
  status: "running",
  paused: false,
  pendingEvents: [],
  tick: 3
});
assert(savedState.tick === 3, "State is written through the Supabase client");
await remoteStore.close();

window.WILDFIRE_CONFIG = {};
const localStore = new SessionStore("local-test");
await localStore.connect();
assert(localStore.mode === "local", "Missing Supabase config uses local mode");
assert(describeConnectionMode(localStore).startsWith("Local only"), "Local-only limitation is visible");
await localStore.close();

console.log(JSON.stringify({
  remote: "Cross-device: Supabase connected",
  local: describeConnectionMode(localStore)
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(`Realtime smoke test failed: ${message}`);
}
