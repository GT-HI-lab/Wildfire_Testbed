import { droneAgentReply, helicopterAgentReply } from "../../shared/simulation.js";
import { isAdminAuthorized, isParticipantAuthorized } from "./lib/study-auth.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") return json({ error: "Method not allowed" }, 405);

  let request;
  try {
    request = JSON.parse(event.body || "{}");
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  const { agent, message = "", intent = "status", state, fallbackText = "" } = request;
  if (!state || !["helicopter", "drone"].includes(agent)) {
    return json({ error: "Missing or invalid agent state" }, 400);
  }
  if (!isParticipantAuthorized(event.headers, state.id) && !isAdminAuthorized(event.headers)) {
    return json({ error: "Session access is not authorized" }, 401);
  }

  const fallback = agent === "helicopter" && message
    ? helicopterAgentReply(message, state)
    : agent === "drone" && message
      ? droneAgentReply(message, state)
      : { text: fallbackText || defaultAgentStatus(agent) };
  if (agent === "helicopter" && message) {
    fallback.statePatch = {
      ...(fallback.statePatch || {}),
      helicopterKnowledge: state.agents?.helicopter?.knowledge
    };
  }

  const provider = resolveProvider();
  if (!provider) {
    return json({
      ...fallback,
      ai: false,
      provider: "deterministic",
      model: "built-in",
      diagnosticCode: "missing_configuration",
      diagnostic: "No supported AI provider key is configured"
    });
  }

  try {
    const context = agentContext(agent, message, intent, state, fallback.text);
    const result = provider === "gemini"
      ? await callGemini(systemPrompt(agent, state.communicationStyle), context)
      : await callOpenAI(systemPrompt(agent, state.communicationStyle), context);
    if (!isDetailedAgentReply(result.text)) {
      throw new Error("The model returned an empty or overly short reply");
    }
    return json({ ...fallback, text: result.text || fallback.text, ai: true, provider, model: result.model });
  } catch (error) {
    console.error("Wildfire agent request failed", error);
    return json({
      ...fallback,
      ai: false,
      provider,
      model: configuredModel(provider),
      diagnosticCode: diagnosticCode(error),
      diagnostic: safeDiagnostic(error)
    });
  }
}

function resolveProvider() {
  const requested = (process.env.AI_PROVIDER || "").toLowerCase();
  if (requested === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

async function callGemini(systemInstruction, context) {
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
        generationConfig: {
          maxOutputTokens: 384,
          thinkingConfig: model.startsWith("gemini-2.5")
            ? { thinkingBudget: 0 }
            : { thinkingLevel: "low" }
        }
      })
    }
  );
  if (!response.ok) throw providerRequestError(response.status, await response.text());
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text || "")
    .join("")
    .trim();
  return { text, model };
}

async function callOpenAI(systemInstruction, context) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 260,
      input: [
        { role: "system", content: systemInstruction },
        { role: "user", content: JSON.stringify(context) }
      ]
    })
  });
  if (!response.ok) throw providerRequestError(response.status, await response.text());
  const data = await response.json();
  return { text: extractOpenAIText(data), model };
}

function systemPrompt(agent, communicationStyle = "transparent") {
  const styleInstruction = communicationStyleInstruction(communicationStyle);
  if (agent === "drone") {
    return [
      "You are Drone AI in a timed human-AI wildfire teaming study.",
      "Answer the participant's message directly in 2 to 4 complete operational sentences.",
      "Never answer with one word or a fragment.",
      "Use only the confirmed detections and coordinates in the supplied context.",
      "Your primary role is paced reconnaissance for fire and water and visual verification of the helicopter.",
      "Accept participant waypoint requests, including requests to come to their current position or move to explicit coordinates; fallback_text contains the accepted action.",
      "Do not infer, reveal, or verify the helicopter's route or destination until the participant explicitly requests a helicopter check.",
      "State what is currently known, your confidence or limitation, and what you will scout next.",
      "Never imply that you scanned the full map.",
      "Preserve the facts in fallback_text and do not invent detections."
      , styleInstruction
    ].join(" ");
  }
  return [
    "You are Helicopter AI in a timed human-AI wildfire teaming study.",
    "Answer the participant's message directly in 2 to 4 complete operational sentences.",
    "Never answer with one word or a fragment.",
    "You know only helicopter_knowledge explicitly shared by Drone AI or the human.",
    "Never claim knowledge of ground-truth fire or water outside that knowledge.",
    "Acknowledge the constrained command, describe the action you will take, and state any operational limitation.",
    "You can move, pick up or drop off the firefighter, refill at known water, deliver water, or stand by.",
    "Do not reveal hidden experiment or malfunction state."
    , styleInstruction
  ].join(" ");
}

function communicationStyleInstruction(style) {
  if (style === "explainable") {
    return "Use an explainable style: state what you are doing and explicitly explain why, including causal dependencies, evidence, and operational limits.";
  }
  if (style === "adaptive") {
    return "Use an adaptive style: when under five minutes remain, communicate only the most urgent action and risk; otherwise give what, why, confidence, and next step, and expand when asked for an explanation.";
  }
  return "Use a transparent style: disclose what you know, what you are doing, the target, confidence, and limits without adding extended causal explanation.";
}

function agentContext(agent, message, intent, state, fallbackText) {
  const shared = {
    mission_seconds_remaining: state.mission?.remainingSeconds,
    reliability: state.reliability?.[agent],
    reliability_condition: state.reliabilityCondition,
    communication_style: state.communicationStyle,
    fallback_text: fallbackText
  };
  if (agent === "drone") {
    return {
      ...shared,
      intent,
      participant_message: message,
      drone: state.agents?.drone,
      confirmed_detections: (state.detected || []).filter((item) => item.confidence >= 0.7).slice(-16),
      explored_cell_count: state.droneKnowledge?.discoveredCells?.length || 0,
      participant_position: state.agents?.firefighter
        ? { x: state.agents.firefighter.x, y: state.agents.firefighter.y }
        : null,
      helicopter_check_requested: Boolean(state.coordination?.helicopterAreaCheckRequested),
      helicopter_observation: state.coordination?.droneInspectingHelicopter
        ? state.agents?.helicopter
        : null
    };
  }
  return {
    ...shared,
    participant_message: message,
    helicopter: {
      x: state.agents?.helicopter?.x,
      y: state.agents?.helicopter?.y,
      water: state.agents?.helicopter?.water,
      waterCapacity: state.agents?.helicopter?.waterCapacity,
      knowledge: state.agents?.helicopter?.knowledge
    },
    team_explored_cell_count: state.clientKnowledge?.discoveredCells?.length || 0,
    firefighter: state.agents?.firefighter,
    constrained_command: fallbackText
  };
}

function defaultAgentStatus(agent) {
  return agent === "drone"
    ? "I am continuing the paced reconnaissance sweep. I will report only confirmed fire, water, and helicopter observations."
    : "I am continuing the assigned task. I will report when the action completes or when I need additional coordinates.";
}

function isDetailedAgentReply(text) {
  if (!text) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((part) => part.trim());
  return words.length >= 12 && sentences.length >= 2;
}

function configuredModel(provider) {
  return provider === "gemini"
    ? process.env.GEMINI_MODEL || "gemini-3.6-flash"
    : process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

function safeDiagnostic(error) {
  const code = diagnosticCode(error);
  const messages = {
    key_rejected: "The configured AI key was rejected.",
    access_denied: "The AI key lacks access or is blocked by API restrictions.",
    model_unavailable: "The configured AI model is unavailable to this key or project.",
    quota_exceeded: "The AI provider quota or rate limit was exceeded.",
    invalid_request: "The AI provider rejected the request configuration.",
    short_response: "The AI returned an incomplete response, so deterministic dialogue was used.",
    provider_error: "The AI provider request failed. Check the Netlify agent-ai Function log."
  };
  return messages[code] || messages.provider_error;
}

function diagnosticCode(error) {
  if (error?.message?.includes("overly short")) return "short_response";
  if (error?.status === 400) return "invalid_request";
  if (error?.status === 401) return "key_rejected";
  if (error?.status === 403) return "access_denied";
  if (error?.status === 404) return "model_unavailable";
  if (error?.status === 429) return "quota_exceeded";
  return "provider_error";
}

function providerRequestError(status, providerMessage) {
  const error = new Error(`AI provider request failed with status ${status}`);
  error.status = status;
  error.providerMessage = String(providerMessage || "").slice(0, 1000);
  return error;
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  return data.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text" || item.text)?.text;
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}
