import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setEnvironmentContext } from "@netlify/blobs";
import { BlobsServer } from "@netlify/blobs/server";
import { handler as agentAi } from "../netlify/functions/agent-ai.mjs";
import { handler as config } from "../netlify/functions/config.mjs";
import sessionState from "../netlify/functions/session-state.mjs";
import studyAdmin from "../netlify/functions/study-admin.mjs";
import studyComplete from "../netlify/functions/study-complete.mjs";
import studyEnrollment from "../netlify/functions/study-enrollment.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "wildfire-prolific-dev-"));
const blobToken = "wildfire-local-blob-token";
const blobs = new BlobsServer({ directory, port: 0, token: blobToken });
const { address } = await blobs.start();
setEnvironmentContext({ edgeURL: address, uncachedEdgeURL: address, token: blobToken, siteID: "wildfire-local" });

process.env.PROLIFIC_TEST_MODE ||= "true";
process.env.STUDY_ACCESS_SECRET ||= "local-study-access-secret-not-for-production";
process.env.STUDY_ADMIN_KEY ||= "local-admin";

const port = Number(process.env.PORT || 8888);
const functions = {
  "/.netlify/functions/session-state": sessionState,
  "/.netlify/functions/study-enrollment": studyEnrollment,
  "/.netlify/functions/study-complete": studyComplete,
  "/.netlify/functions/study-admin": studyAdmin
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host}`);
    if (url.pathname === "/.netlify/functions/config") return sendLegacy(outgoing, await config());
    if (url.pathname === "/.netlify/functions/agent-ai") {
      return sendLegacy(outgoing, await agentAi(await legacyEvent(incoming)));
    }
    if (functions[url.pathname]) {
      return sendResponse(outgoing, await functions[url.pathname](await webRequest(incoming, url)));
    }
    if (url.pathname === "/") {
      outgoing.writeHead(302, { Location: "/client/?preview=1&wave=1" });
      return outgoing.end();
    }
    return serveStatic(url.pathname, outgoing);
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ error: "Local development server error" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CREW Wildfire local study: http://127.0.0.1:${port}/client/?preview=1&wave=1`);
  console.log(`Administrator dashboard: http://127.0.0.1:${port}/server/ (key: local-admin)`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await blobs.stop();
    await rm(directory, { recursive: true, force: true });
    process.exit(0);
  });
}

async function webRequest(incoming, url) {
  const body = ["GET", "HEAD"].includes(incoming.method) ? undefined : await readBody(incoming);
  return new Request(url, { method: incoming.method, headers: incoming.headers, body });
}

async function legacyEvent(incoming) {
  return {
    httpMethod: incoming.method,
    headers: incoming.headers,
    body: ["GET", "HEAD"].includes(incoming.method) ? "" : await readBody(incoming)
  };
}

async function readBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function sendResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function sendLegacy(outgoing, response) {
  outgoing.writeHead(response.statusCode, response.headers);
  outgoing.end(response.body);
}

async function serveStatic(pathname, outgoing) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  let filename = resolve(root, relative);
  if (!filename.startsWith(root)) return notFound(outgoing);
  try {
    if ((await stat(filename)).isDirectory()) filename = join(filename, "index.html");
    const content = await readFile(filename);
    outgoing.writeHead(200, { "Content-Type": contentType(filename), "Cache-Control": "no-store" });
    outgoing.end(content);
  } catch {
    notFound(outgoing);
  }
}

function notFound(outgoing) {
  outgoing.writeHead(404, { "Content-Type": "text/plain" });
  outgoing.end("Not found");
}

function contentType(filename) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extname(filename)] || "application/octet-stream";
}
