import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function studySecret() {
  return process.env.STUDY_ACCESS_SECRET || "";
}

export function participantHash(prolificParticipantId) {
  const secret = studySecret();
  if (!secret) throw new Error("STUDY_ACCESS_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`participant:${prolificParticipantId}`)
    .digest("hex");
}

export function sessionAccessToken(sessionId) {
  const secret = studySecret();
  if (!secret) throw new Error("STUDY_ACCESS_SECRET is not configured");
  return createHmac("sha256", secret).update(`session:${sessionId}`).digest("base64url");
}

export function isResumeAuthorized(headers, participantHashValue, wave) {
  const cookie = headerValue(headers, "cookie");
  const name = `wf_resume_${wave}`;
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  const [hash, signature] = value.split(".");
  return hash === participantHashValue && safeEqual(signature, resumeSignature(hash, wave));
}

export function resumeCookie(participantHashValue, wave) {
  const value = `${participantHashValue}.${resumeSignature(participantHashValue, wave)}`;
  return `wf_resume_${wave}=${value}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
}

export function isParticipantAuthorized(headers, sessionId) {
  if (!studySecret()) return true;
  const authorization = headerValue(headers, "authorization");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return safeEqual(supplied, sessionAccessToken(sessionId));
}

export function isAdminAuthorized(headers) {
  const configured = process.env.STUDY_ADMIN_KEY || "";
  const supplied = headerValue(headers, "x-admin-key");
  return Boolean(configured && safeEqual(supplied, configured));
}

export function stableIndex(value, length) {
  const digest = createHash("sha256").update(value).digest();
  return length ? digest.readUInt32BE(0) % length : 0;
}

export function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const target = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === target);
  return String(entry?.[1] || "");
}

function safeEqual(first, second) {
  const left = Buffer.from(String(first));
  const right = Buffer.from(String(second));
  return left.length === right.length && timingSafeEqual(left, right);
}

function resumeSignature(participantHashValue, wave) {
  const secret = studySecret();
  if (!secret) return "";
  return createHmac("sha256", secret)
    .update(`resume:${participantHashValue}:${wave}`)
    .digest("base64url");
}
