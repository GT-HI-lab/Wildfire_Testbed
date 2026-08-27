export const STUDY_STORE_NAME = "wildfire-prolific-study-v1";
export const SESSION_STORE_NAME = "wildfire-prolific-sessions-v1";
export const WAVE_COUNT = 4;

export const COMMUNICATION_STYLES = ["transparent", "explainable", "adaptive"];
export const COUNTERBALANCE_SEQUENCES = ["A", "B", "C", "D"];
export const STUDY_CELLS = COMMUNICATION_STYLES.flatMap((communicationStyle) =>
  COUNTERBALANCE_SEQUENCES.map((sequence) => ({
    id: `${communicationStyle}-${sequence}`,
    communicationStyle,
    sequence
  }))
);

export function normalizeWave(value) {
  const wave = Number(value);
  return Number.isInteger(wave) && wave >= 1 && wave <= WAVE_COUNT ? wave : null;
}

export function parseJsonEnvironment(name, fallback = {}) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function expectedStudyId(wave) {
  return String(parseJsonEnvironment("PROLIFIC_STUDY_IDS")[String(wave)] || "");
}

export function completionCode(wave) {
  return String(parseJsonEnvironment("PROLIFIC_COMPLETION_CODES")[String(wave)] || "");
}

export function isStudyConfigured() {
  if (process.env.PROLIFIC_TEST_MODE === "true") return Boolean(process.env.STUDY_ACCESS_SECRET);
  const studyIds = parseJsonEnvironment("PROLIFIC_STUDY_IDS");
  const completionCodes = parseJsonEnvironment("PROLIFIC_COMPLETION_CODES");
  return Boolean(
    process.env.STUDY_ACCESS_SECRET &&
    Array.from({ length: WAVE_COUNT }, (_, index) => String(index + 1)).every(
      (wave) => studyIds[wave] && completionCodes[wave]
    )
  );
}

export function responseOptions(status = 200) {
  return {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json"
    }
  };
}
