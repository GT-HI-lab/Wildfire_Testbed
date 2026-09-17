// User-specified MDMT performance-trust subset and four NASA-TLX items.
// Does Not Fit is a missing response, never an 8 or a numeric zero.
export const SURVEY_VERSION = 2;
export const DOES_NOT_FIT = "does_not_fit";
const reliable = ["Reliable", "Predictable", "Dependable", "Consistent"];
const competent = ["Competent", "Skilled", "Capable", "Meticulous"];
export const MDMT_QUESTIONS = ["helicopter", "drone"].flatMap((target) =>
  [["reliable", reliable], ["competent", competent]].flatMap(([subscale, items]) => items.map((label) => ({
    id: `mdmt_${target}_${label.toLowerCase()}`, label, measure: "mdmt_v2", target, subscale,
    type: "rating", min: 0, max: 7, minLabel: "Not at all", maxLabel: "Very", allowDoesNotFit: true
  })))
);
export const TLX_QUESTIONS = [
  ["mental_demand", "Mental Demand", "How much mental and perceptual activity was required?"],
  ["temporal_demand", "Temporal Demand", "How much time pressure did you feel due to the rate or pace at which tasks or task elements occurred?"],
  ["effort", "Effort", "How hard did you have to work to accomplish your level of performance"],
  ["frustration", "Frustration level", "How insecure, discouraged, irritated, stressed and annoyed versus secure, gratified, content, relaxed and complacent did you feel during the task?"]
].map(([id, label, description]) => ({ id: `tlx_${id}`, label, description, measure: "nasa_tlx_subset", target: "task", type: "rating", min: 0, max: 20, minLabel: "Very Low", maxLabel: "Very High" }));
export const BASELINE_QUESTIONS = [
  "Generally, I trust technology.",
  "Technology helps me solve many problems.",
  "I think it’s a good idea to rely on technology for help.",
  "I don’t trust the information I get from technology.",
  "Technology is reliable.",
  "I rely on technology."
].map((label, index) => ({ id: `propensity_${index + 1}`, label, measure: "propensity_to_trust", target: "technology", type: "rating", min: 1, max: 5, minLabel: "Strongly disagree", maxLabel: "Strongly agree", reverse: index === 3 }));
export const SURVEY_QUESTIONS = [...MDMT_QUESTIONS, ...TLX_QUESTIONS];
export function questionsForCheckpoint(checkpoint) {
  return checkpoint === "baseline" ? BASELINE_QUESTIONS : SURVEY_QUESTIONS;
}
export function validateResponses(checkpoint, responses) {
  const questions = questionsForCheckpoint(checkpoint);
  if (!responses || Object.keys(responses).length !== questions.length) throw new Error("Please answer every item before continuing.");
  for (const question of questions) {
    const value = responses[question.id];
    if (question.allowDoesNotFit && value === DOES_NOT_FIT) continue;
    if (value === "" || value === null || value === undefined || typeof value === "boolean" || !/^\d+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < question.min || Number(value) > question.max) {
      throw new Error(`Please select a valid answer for ${question.label}.`);
    }
  }
}
export function scoredResponse(question, raw) {
  if (raw === DOES_NOT_FIT) return null;
  return question.reverse ? question.min + question.max - Number(raw) : Number(raw);
}
