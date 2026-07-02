import { helicopterAgentReply, parseHelicopterCommand } from "../../shared/simulation.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { message, state } = JSON.parse(event.body || "{}");
  if (!message || !state) return json({ error: "Missing message or state" }, 400);

  const baseReply = helicopterAgentReply(message, state);

  if (!process.env.OPENAI_API_KEY || baseReply.recovered) {
    return json(baseReply);
  }

  try {
    const command = baseReply.command || parseHelicopterCommand(message, state);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "You are the helicopter AI in a human-AI wildfire teaming experiment. Reply concisely. You may acknowledge movement, pickup/dropoff, lake refill, firefighter water-delivery, or standby commands. You cannot directly suppress wildfire. The browser simulation will execute the provided structured command."
          },
          {
            role: "user",
            content: JSON.stringify({
              participant_message: message,
              reliability: state.reliability?.helicopter,
              helicopter: state.agents?.helicopter,
              firefighter: state.agents?.firefighter,
              fires: (state.fires || []).slice(0, 12),
              proposed_command: command,
              malfunction_active: Boolean(state.experiment?.malfunctionActive)
            })
          }
        ]
      })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const text =
      data.output_text ||
      data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text ||
      "Copy. I will execute the command.";

    return json({
      text,
      command,
      confidence: state.reliability?.helicopter === "high" ? 0.88 : 0.52,
      statePatch: baseReply.statePatch || null
    });
  } catch {
    return json(baseReply);
  }
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
