import { createPublicKey, verify } from "node:crypto";

const PROLIFIC_ID_PATTERN = /^[a-f\d]{24}$/i;
const PROLIFIC_ISSUER = "https://www.prolific.com";
const PROLIFIC_JWKS_URL = "https://api.prolific.com/.well-known/study/jwks.json";

export async function verifyProlificEntry({
  prolificParticipantId,
  studyId,
  submissionId,
  prolificToken,
  entryUrl,
  requestOrigin
}) {
  if (process.env.PROLIFIC_TEST_MODE === "true") return { method: "test_mode" };
  for (const [label, value] of Object.entries({
    PROLIFIC_PID: prolificParticipantId,
    STUDY_ID: studyId,
    SESSION_ID: submissionId
  })) {
    if (!PROLIFIC_ID_PATTERN.test(value || "")) throw new Error(`${label} is invalid`);
  }

  if (prolificToken) {
    await verifySecureUrl({
      token: prolificToken,
      entryUrl,
      requestOrigin,
      prolificParticipantId,
      studyId,
      submissionId
    });
    return { method: "signed_url" };
  }

  if (process.env.PROLIFIC_REQUIRE_SECURE_URL === "true") {
    throw new Error("The signed Prolific study link is missing or expired");
  }
  if (process.env.PROLIFIC_API_TOKEN) {
    await verifySubmissionApi({ prolificParticipantId, studyId, submissionId });
    return { method: "submission_api" };
  }
  return { method: "parameter_format" };
}

async function verifySubmissionApi({ prolificParticipantId, studyId, submissionId }) {
  const response = await fetch(`https://api.prolific.com/api/v1/submissions/${encodeURIComponent(submissionId)}/`, {
    headers: { Authorization: `Token ${process.env.PROLIFIC_API_TOKEN}` },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`Prolific could not verify this submission (${response.status})`);
  const submission = await response.json();
  if (submission.participant !== prolificParticipantId || submission.study_id !== studyId) {
    throw new Error("The Prolific submission does not match this participant and study");
  }
}

async function verifySecureUrl({
  token,
  entryUrl,
  requestOrigin,
  prolificParticipantId,
  studyId,
  submissionId
}) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token).split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("The signed study link is invalid");
  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("The signed study link uses an unsupported key");

  const parsedEntry = new URL(entryUrl);
  parsedEntry.searchParams.delete("prolific_token");
  if (parsedEntry.origin !== requestOrigin) throw new Error("The signed study link has an unexpected origin");
  if (payload.iss !== PROLIFIC_ISSUER || Number(payload.exp) * 1000 <= Date.now()) {
    throw new Error("The signed Prolific study link has expired");
  }
  if (payload.aud !== parsedEntry.toString()) throw new Error("The signed study link audience does not match");
  if (
    payload.sub !== submissionId ||
    payload.prolific?.PROLIFIC_PID !== prolificParticipantId ||
    payload.prolific?.STUDY_ID !== studyId ||
    payload.prolific?.SESSION_ID !== submissionId ||
    !payload.prolific?.workspace_id
  ) {
    throw new Error("The signed Prolific identifiers do not match");
  }

  const response = await fetch(PROLIFIC_JWKS_URL, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error("Prolific signing keys are temporarily unavailable");
  const keys = (await response.json()).keys || [];
  const jwk = keys.find((key) => key.kid === header.kid && key.alg === "RS256");
  if (!jwk) throw new Error("The Prolific signing key was not found");
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url")
  );
  if (!valid) throw new Error("The Prolific study link signature is invalid");
}

function decodeJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("The signed study link could not be decoded");
  }
}
