import { handler as agentHandler } from "./agent-ai.mjs";

export async function handler(event) {
  const body = JSON.parse(event.body || "{}");
  return agentHandler({
    ...event,
    body: JSON.stringify({ ...body, agent: "helicopter" })
  });
}
