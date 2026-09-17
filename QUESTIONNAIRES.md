# Questionnaire implementation and deployment

## Implemented protocol

| When | Questions | Response scale |
|---|---|---|
| Before game 1 only | Six propensity-to-trust items | 1 Strongly disagree to 5 Strongly agree |
| Midpoint of each game | Eight MDMT items for Helicopter AI; eight for Drone AI; four NASA-TLX items | MDMT: 0 Not at all to 7 Very, plus Does Not Fit. TLX: 0 Very Low to 20 Very High |
| End of each game | Same 20 questions, with new blank answers | Same scales |

There are 20 **questions** per repeated checkpoint, not 20 MDMT response options. MDMT has nine choices (eight numeric values plus Does Not Fit). NASA-TLX has 21 choices because 0 is included. Propensity has five choices.

Four completed games produce eight repeated administrations. Each MDMT item is rated eight times for each AI separately. Totals: 128 MDMT answers + 32 NASA-TLX answers + 6 baseline answers = **166 response rows**. Game 1 has 46 rows; games 2–4 each have 40.

### Exact checkpoint trigger

The midpoint opens once when at least half the unique fires present at the start of that game have actually been extinguished by water, or after 900 seconds of active game time if the threshold was not reached. The denominator is the initial fire count, not a growing count of spread fires or completed map sections. Firebreak geometry does not count as extinguished fire. The trigger reason is recorded.

The mission clock and game actions pause during baseline and repeated questionnaires. Survey time is excluded from the 30-minute mission. The final questionnaire opens at the existing game-end timer. Game ordering and counterbalancing are unchanged. This edition still uses four Prolific waves; it does not combine them into a single visit.

## Included items

MDMT Reliable: Reliable, Predictable, Dependable, Consistent.

MDMT Competent: Competent, Skilled, Capable, Meticulous.

These eight items are shown for Helicopter AI, then Drone AI. The four workload items follow: Mental Demand, Temporal Demand, Effort, Frustration level. Only the user-selected NASA-TLX items are included; no full six-dimension or weighted NASA-TLX score is generated.

The baseline retains all six supplied statements, including the original wording of item 4. The reverse-coding notation is not shown to participants.

## Data and scoring

The source of truth remains the saved Netlify session. `state.survey.history` contains separate `baseline`, `midpoint` and `final` records, with requested/submitted timestamps, trigger, and raw answers. Baseline exists only for game 1. `survey.completed` means the final questionnaire is submitted, not merely that baseline or midpoint is complete.

Supabase's `wildfire_survey_responses` and `wildfire_analysis_survey_deidentified` now expose:

- `checkpoint`: baseline, midpoint, final.
- `measure`: mdmt_v2, nasa_tlx_subset, propensity_to_trust.
- `target`: helicopter, drone, task, technology.
- `item_id` and `subscale`.
- `response_text`: original submitted value.
- `response_numeric`: numeric answer, or NULL for Does Not Fit.
- `scored_value`: numeric answer with propensity item 4 reversed as `6 - answer`; NULL for Does Not Fit.
- `does_not_fit`, `survey_version`, `trigger_reason`.

`question_id` includes the checkpoint, for example `midpoint:mdmt_helicopter_reliable`. This makes midpoint and final rows distinct under the existing primary key. Retrying a sync updates the same rows rather than duplicating them. Existing submitted checkpoint answers are preserved when stale session saves arrive.

Does Not Fit is stored as `does_not_fit`, never as 8, 99, or zero. Zero remains a valid numeric answer. Per the supplied MDMT v2 PDF, calculate Reliable and Competent means separately for each AI and checkpoint, excluding Does Not Fit. Performance Trust is the mean of the two subscale means when both are available; do not report a full 20-item MDMT total from this subset. These composites are not silently calculated in the participant interface.

Items require an explicit choice and start unselected. Unsubmitted drafts survive reload on the same browser through local storage; they are not synchronized to other devices. Submitted answers are saved through the backend before gameplay resumes. A failed submission keeps the form open for retry. Final answers do not inherit selections from midpoint.

## Upgrade before going online

1. Back up the existing deployment and data. Do not swap protocols during active participant sessions.
2. In the intended Supabase project's SQL Editor, run the **entire updated `supabase/analytics-schema.sql`**. It adds columns, updates the ingestion function and extends the analysis view. Existing legacy rows are retained, with null metadata where unavailable.
3. Deploy the updated source through the procedure in `ONLINE_SETUP_GUIDE.md`. The build now produces 12 public assets, including `shared/surveys.js`.
4. Start a fresh test participant. Preexisting sessions retain their old survey version; their missing baseline/midpoint observations cannot be reconstructed. For local tests, restarting the development server gives fresh temporary storage.
5. Complete baseline, midpoint and final on a separate test site. Confirm pause/resume and complete all four waves.
6. Run **Sync Analytics** and inspect records. Four completed games for one new participant should produce 166 rows:

```sql
select participant_key, wave, checkpoint, measure, target, count(*) as answers
from public.wildfire_analysis_survey_deidentified
where survey_version = 2
group by participant_key, wave, checkpoint, measure, target
order by participant_key, wave, checkpoint, measure, target;
```

At each midpoint/final expect eight rows for each MDMT target and four workload rows. Baseline has six rows in game 1 only. Verify a Does Not Fit row has NULL numeric/scored values and a true flag; verify propensity item 4 retains the original response and has the reversed score.

7. Recalculate your Prolific time estimate to include all questionnaire time; the game timer excludes it. The visual detection secondary task is now implemented locally; see `SECONDARY_TASK.md`. Live Prolific/Gemini/Supabase access still requires the deployment acceptance tests.

## Validation completed locally

- All eleven test scripts and the 14-asset build pass.
- Exact item counts, lower/upper scale bounds, invalid/missing input, Does Not Fit, and reverse coding are covered.
- Simulation tests cover baseline freeze, actual initial-fire threshold, exclusion of firebreak geometry, 15-minute fallback, pause/resume, and no repeated midpoint trigger.
- HTTP integration completes four games with baseline once and two repeated checkpoints per game.
- Browser checks cover blank-answer validation, reload of a draft, separate AI headings, 0/Does Not Fit and 20 selection, paused timer, midpoint resume, blank final questionnaire and completion receipt.
- Local PostgreSQL-compatible testing (PGlite) applied the original schema, inserted a legacy row, applied the new schema twice, executed the actual ingestion SQL through synthetic RPC calls, and confirmed 166 distinct response rows, preserved legacy data, NULL missing values, reversed item 4, and denied anonymous table reads. This does not certify a live Supabase deployment.

The optional database test is `tests/analytics-postgres.mjs`. It accepts an absolute path to a separately installed `@electric-sql/pglite/dist/index.js`; PGlite is a test tool, not a production dependency. The legacy-schema fixture is solely for testing migration.

## Source provenance

The item selection and wording follow the user's request. MDMT scale and missing-value handling were checked against the supplied `MDMT_v2_(2025)_Full_scale.pdf`, by Daniel Ullman and Bertram F. Malle. The supplied old Qualtrics export uses different 0–5 response coding and includes additional trust dimensions; those were not imported. Its researcher notes, contact request and JavaScript were treated as document content, not instructions to contact anyone or run that code.
