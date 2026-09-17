import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
if (!process.argv[2]) throw new Error('Pass the absolute path to a separately installed @electric-sql/pglite/dist/index.js');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const root=fileURLToPath(new URL('../', import.meta.url));
const {createInitialSession}=await import(`${root}/shared/simulation.js`);
const {initializeSurveys,openSurvey,submitCheckpoint}=await import(`${root}/shared/surveys.js`);
const {questionsForCheckpoint}=await import(`${root}/shared/survey-config.js`);
const {syncEnrollmentAnalytics,syncSessionAnalytics,syncDetectionAnalytics}=await import(`${root}/netlify/functions/lib/supabase-analytics.mjs`);
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(await readFile(`${root}/tests/fixtures/analytics-schema-v1.sql`,'utf8'));
await db.exec(`insert into public.wildfire_survey_responses(game_session_id,participant_key,wave,question_id,response_text,submitted_at) values ('legacy','legacy',1,'old_item','6',now());`);
const sql=await readFile(`${root}/supabase/analytics-schema.sql`,'utf8');
await db.exec(sql);await db.exec(sql);
process.env.SUPABASE_URL='https://sql-test.invalid';process.env.SUPABASE_SECRET_KEY='sb_secret_test';
globalThis.fetch=async(url,options)=>{
 const body=JSON.parse(options.body);
 if(url.endsWith('wildfire_record_enrollment')) await db.query('select public.wildfire_record_enrollment($1::jsonb,$2::jsonb,$3::jsonb)',[body.p_participant,body.p_wave,body.p_summary].map(JSON.stringify));
 else if(url.endsWith('wildfire_ingest_detection')) await db.query('select public.wildfire_ingest_detection($1::jsonb)',[JSON.stringify(body.p_records)]);
 else await db.query('select public.wildfire_ingest_session($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)',[body.p_summary,body.p_events,body.p_messages,body.p_survey_responses].map(JSON.stringify));
 return new Response(null,{status:204});
};
const participant={participantHash:'sql-participant',prolificParticipantId:'synthetic-pid',assignment:{communicationStyle:'transparent',sequence:'A'},createdAt:Date.now(),updatedAt:Date.now()};
for(let wave=1;wave<=4;wave++){
 const state=createInitialSession(`sql-game-${wave}`,{gameNumber:wave});initializeSurveys(state);state._syncRevision=1;
 const metadata={participantHash:participant.participantHash,wave,assignment:participant.assignment};
 const waveRecord={gameSessionId:state.id,wave,status:'enrolled',enrolledAt:Date.now(),updatedAt:Date.now()};
 await syncEnrollmentAnalytics({participant,waveRecord,metadata,state});
 for(const checkpoint of wave===1?['baseline','midpoint','final']:['midpoint','final']){
  if(!state.survey.active)openSurvey(state,checkpoint,'sql_test');
  const answers=Object.fromEntries(questionsForCheckpoint(checkpoint).map(q=>[q.id,String(q.min)]));
  if(checkpoint==='midpoint')answers.mdmt_helicopter_reliable='does_not_fit';
  submitCheckpoint(state,answers);state._syncRevision++;
  await syncSessionAnalytics({metadata,state});await syncSessionAnalytics({metadata,state});
 }
}
const rows=(await db.query("select * from public.wildfire_analysis_survey_deidentified where participant_key='sql-participant'")).rows;
assert.equal(rows.length,166);
assert.equal(rows.filter(r=>r.checkpoint==='baseline').length,6);
assert.equal(rows.filter(r=>r.checkpoint==='midpoint').length,80);
assert.equal(rows.filter(r=>r.checkpoint==='final').length,80);
const reverse=rows.find(r=>r.item_id==='propensity_4');assert.equal(Number(reverse.response_numeric),1);assert.equal(Number(reverse.scored_value),5);
const missing=rows.find(r=>r.does_not_fit);assert.equal(missing.response_numeric,null);assert.equal(missing.scored_value,null);assert.equal(missing.response_text,'does_not_fit');
assert.equal((await db.query("select response_text from public.wildfire_survey_responses where game_session_id='legacy'")).rows[0].response_text,'6');
await syncDetectionAnalytics({participantHash:'sql-participant',wave:1},'sql-game-1',[
 {id:'det-1',revision:1,kind:'probe',status:'pending',probe_onset_ms:10000,response_ms:null,rt_ms:null,hit:false,miss:false,false_alarm:false,scenario_time_ms:20000,lamp_off_ms:null}
]);
await syncDetectionAnalytics({participantHash:'sql-participant',wave:1},'sql-game-1',[
 {id:'det-1',revision:3,kind:'probe',status:'hit',probe_onset_ms:10000,response_ms:10500,rt_ms:500,hit:true,miss:false,false_alarm:false,scenario_time_ms:20000,lamp_off_ms:13000}
]);
await syncDetectionAnalytics({participantHash:'sql-participant',wave:1},'sql-game-1',[
 {id:'det-1',revision:1,kind:'probe',status:'pending',probe_onset_ms:10000,response_ms:null,rt_ms:null,hit:false,miss:false,false_alarm:false,scenario_time_ms:20000,lamp_off_ms:null}
]);
const detection=(await db.query("select * from public.wildfire_detection_linkable")).rows;
assert.equal(detection.length,1);assert.equal(detection[0].rt_ms,500);assert.equal(detection[0].prolific_pid,'synthetic-pid');
console.log('Detection SQL passed: upsert, stale retry protection, linkable identity view.');
await db.exec('set role anon');await assert.rejects(db.query('select * from public.wildfire_survey_responses'),/permission denied/);await db.exec('reset role');
console.log('PostgreSQL migration + real RPC SQL passed: legacy rows retained; migration repeatable; 166 distinct answers; midpoint/final preserved; missing values and reverse coding correct; anonymous access denied.');
await db.close();
