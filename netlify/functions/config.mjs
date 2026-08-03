export async function handler() {
  const provider = resolveProvider();
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({
      SUPABASE_URL: process.env.SUPABASE_URL || "",
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
      QUALTRICS_SURVEY_URL: process.env.QUALTRICS_SURVEY_URL || "https://example.qualtrics.com/jfe/form/SV_PLACEHOLDER",
      AI_ENABLED: Boolean(provider),
      AI_PROVIDER: provider || "deterministic",
      AI_MODEL: provider === "gemini"
        ? process.env.GEMINI_MODEL || "gemini-3.6-flash"
        : provider === "openai"
          ? process.env.OPENAI_MODEL || "gpt-5.4-mini"
          : "built-in"
    })
  };
}

function resolveProvider() {
  const requested = (process.env.AI_PROVIDER || "").toLowerCase();
  if (requested === "gemini") return process.env.GEMINI_API_KEY ? "gemini" : null;
  if (requested === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}
