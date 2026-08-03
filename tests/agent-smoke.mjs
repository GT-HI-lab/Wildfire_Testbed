import { handler } from "../netlify/functions/agent-ai.mjs";
import { handler as configHandler } from "../netlify/functions/config.mjs";
import { createInitialSession } from "../shared/simulation.js";

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_PROVIDER;

const state = createInitialSession("agent-test");
process.env.QUALTRICS_SURVEY_URL = "https://example.qualtrics.com/jfe/form/SV_TEST";
const configResponse = await configHandler();
const runtimeConfig = JSON.parse(configResponse.body);
assert(runtimeConfig.QUALTRICS_SURVEY_URL === process.env.QUALTRICS_SURVEY_URL, "runtime config exposes the external survey URL");
delete process.env.QUALTRICS_SURVEY_URL;
const helicopterResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({ agent: "helicopter", message: "Fly to 180, 60", state })
});
const helicopter = JSON.parse(helicopterResponse.body);
assert(helicopter.command?.x === 180 && helicopter.command?.y === 60, "helicopter command remains constrained");
assert(helicopter.statePatch?.helicopterKnowledge?.fires?.length === 1, "human coordinates persist through API boundary");

const droneResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({
    agent: "drone",
    intent: "share_intel",
    fallbackText: "Drone AI: No confirmed detections yet.",
    state
  })
});
const drone = JSON.parse(droneResponse.body);
assert(drone.text === "Drone AI: No confirmed detections yet.", "drone fallback preserves simulation facts");

const droneChatResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({
    agent: "drone",
    message: "What have you found?",
    state
  })
});
const droneChat = JSON.parse(droneChatResponse.body);
assert(droneChat.text.split(/[.!?]+/).filter((part) => part.trim()).length >= 2, "drone chat fallback is detailed");

const locateResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({
    agent: "drone",
    message: "Please locate and check the helicopter",
    state
  })
});
const locate = JSON.parse(locateResponse.body);
assert(locate.teamAction === "check_helicopter", "drone locate request survives the serverless API boundary");

const originalFetch = globalThis.fetch;
let geminiRequest = null;
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-only-key";
process.env.GEMINI_MODEL = "gemini-3.6-flash";
globalThis.fetch = async (url, options) => {
  geminiRequest = { url: String(url), options };
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [{
          content: {
            parts: [{
              text: "I have confirmed the supplied reconnaissance facts. I will continue the paced sweep and report the next verified detection."
            }]
          }
        }]
      };
    }
  };
};

const geminiResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({ agent: "drone", intent: "status", fallbackText: "fallback", state })
});
const gemini = JSON.parse(geminiResponse.body);
assert(gemini.ai && gemini.provider === "gemini", "Gemini provider is selected");
assert(gemini.text.includes("paced sweep"), "Gemini response text is returned");
assert(geminiRequest.url.includes("gemini-3.6-flash:generateContent"), "Gemini model endpoint is correct");
assert(geminiRequest.options.headers["x-goog-api-key"] === "test-only-key", "Gemini key uses a server-side header");
const geminiBody = JSON.parse(geminiRequest.options.body);
assert(geminiBody.generationConfig.maxOutputTokens === 384, "Gemini has enough output tokens");
assert(geminiBody.generationConfig.thinkingConfig.thinkingLevel === "low", "Gemini uses low thinking for chat");

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return { candidates: [{ content: { parts: [{ text: "Copy." }] } }] };
  }
});
const shortResponse = await handler({
  httpMethod: "POST",
  body: JSON.stringify({ agent: "helicopter", message: "Fly to 180, 60", state })
});
const shortReply = JSON.parse(shortResponse.body);
assert(!shortReply.ai, "an overly short provider reply is rejected");
assert(shortReply.text.split(/\s+/).length >= 12, "short provider reply uses the detailed deterministic fallback");
assert(shortReply.diagnostic.includes("overly short"), "short reply reason is visible");

globalThis.fetch = originalFetch;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.AI_PROVIDER;

console.log(JSON.stringify({
  helicopterCommand: helicopter.command,
  droneText: drone.text,
  droneChatText: droneChat.text,
  geminiProvider: gemini.provider,
  geminiModel: gemini.model
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(`Agent smoke test failed: ${message}`);
}
