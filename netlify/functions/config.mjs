import { isStudyConfigured } from "./lib/study-config.mjs";
import { analyticsConfigured } from "./lib/supabase-analytics.mjs";

export async function handler() {
  const provider = resolveProvider();
  const health = await checkProviderHealth(provider);
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify({
      AI_ENABLED: health.ok,
      AI_CONFIGURED: Boolean(provider),
      AI_STATUS_CODE: health.code,
      AI_DIAGNOSTIC: health.diagnostic,
      ANALYTICS_CONFIGURED: analyticsConfigured(),
      STUDY_CONFIGURED: isStudyConfigured(),
      STUDY_TEST_MODE: process.env.PROLIFIC_TEST_MODE === "true"
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

async function checkProviderHealth(provider) {
  if (!provider) {
    return {
      ok: false,
      code: "missing_configuration",
      diagnostic: "No AI key is available to the deployed Netlify Function. Check variable scope and deploy context, then redeploy."
    };
  }

  const request = provider === "gemini"
    ? {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.6-flash")}`,
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY }
      }
    : {
        url: `https://api.openai.com/v1/models/${encodeURIComponent(process.env.OPENAI_MODEL || "gpt-5.4-mini")}`,
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      };

  try {
    const response = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(6000)
    });
    if (response.ok) return { ok: true, code: "ready", diagnostic: "AI provider access verified." };
    return providerHealthFailure(response.status);
  } catch {
    return {
      ok: false,
      code: "provider_unreachable",
      diagnostic: "The AI provider health check could not be reached. Check the Netlify Function log and try again."
    };
  }
}

function providerHealthFailure(status) {
  if (status === 401) return { ok: false, code: "key_rejected", diagnostic: "The configured AI key was rejected." };
  if (status === 403) return { ok: false, code: "access_denied", diagnostic: "The AI key lacks access or is blocked by API restrictions." };
  if (status === 404) return { ok: false, code: "model_unavailable", diagnostic: "The configured AI model is unavailable to this key or project." };
  if (status === 429) return { ok: false, code: "quota_exceeded", diagnostic: "The AI provider quota or rate limit was exceeded." };
  return { ok: false, code: "provider_error", diagnostic: `The AI provider health check failed with status ${status}.` };
}
