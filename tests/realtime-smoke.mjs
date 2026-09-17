import { describeConnectionMode, SessionStore } from "../shared/realtime.js";

const localValues = new Map();
globalThis.localStorage = {
  getItem: (key) => localValues.get(key) || null,
  setItem: (key, value) => localValues.set(key, value)
};
globalThis.BroadcastChannel = class { postMessage() {} close() {} };

let sharedState = null;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/config")) return response(200, {});
  if (String(url).includes("health=1")) return response(200, { ok: true, backend: "netlify-blobs" });
  if (options.method === "PUT") {
    sharedState = JSON.parse(options.body).state;
    sharedState._syncRevision = (sharedState._syncRevision || 0) + 1;
    return response(200, { state: sharedState });
  }
  return sharedState ? response(200, { state: sharedState }) : response(404, { state: null });
};
globalThis.window = { WILDFIRE_CONFIG: {}, location: { hostname: "wildfire.example.netlify.app" } };

const store = new SessionStore("cross-device-test");
await store.connect();
assert(store.mode === "netlify", "Netlify shared mode is selected");
assert(store.realtimeStatus === "connected", "Netlify shared session endpoint is healthy");
assert(describeConnectionMode(store).includes("Netlify shared session connected"), "shared connection status is explicit");
await store.saveState({ id: "cross-device-test", status: "running", paused: false, pendingEvents: [], tick: 7 });
assert(sharedState.tick === 7, "state writes to the shared endpoint");
assert((await store.loadState()).tick === 7, "state reads from the shared endpoint");
await store.close();

globalThis.fetch = async (url) => String(url).includes("/config") ? response(200, {}) : response(503, {});
window.location.hostname = "localhost";
const localStore = new SessionStore("local-test");
await localStore.connect();
assert(localStore.mode === "local", "local development can fall back to browser storage");
assert(describeConnectionMode(localStore).startsWith("Local development only"), "local limitation is accurately labeled");
await localStore.close();

console.log(JSON.stringify({ shared: "connected", local: describeConnectionMode(localStore) }, null, 2));

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Realtime smoke test failed: ${message}`);
}
