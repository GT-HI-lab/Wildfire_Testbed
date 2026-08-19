import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import sessionState from "../netlify/functions/session-state.mjs";

const directory = await mkdtemp(join(tmpdir(), "wildfire-blobs-"));
const token = "local-test-token";
const siteID = "wildfire-test-site";
const blobs = new BlobsServer({ directory, port: 0, token });

try {
  const { address } = await blobs.start();
  setEnvironmentContext({ edgeURL: address, uncachedEdgeURL: address, token, siteID });
  const url = "http://localhost/.netlify/functions/session-state?sessionId=two-computers";
  const state = { id: "two-computers", tick: 12, status: "running", pendingEvents: [] };
  const write = await sessionState(new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state })
  }));
  assert(write.status === 200, "shared state write succeeds");
  const saved = (await write.json()).state;
  assert(saved._syncRevision === 1, "shared state receives a revision");

  const read = await sessionState(new Request(url));
  assert(read.status === 200, "shared state read succeeds from a separate request");
  assert((await read.json()).state.tick === 12, "second request reads the persisted session");
  console.log(JSON.stringify({ backend: "netlify-blobs", revision: saved._syncRevision, tick: 12 }, null, 2));
} finally {
  await blobs.stop();
  await rm(directory, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Session backend smoke test failed: ${message}`);
}
