import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { newRecord, makeGuests } from '../shared/sample';
import { evaluation, calculateQuote, vendors, markStale } from '../server/domain';
import { previewOutput } from '../server/preview';
import { loadConfig } from '../server/config';
import { executeWorkflow } from '../server/workflow';
import type { EventRecord, AgentId, CateringOutput, LeadOutput, DesignOutput } from '../shared/types';
export function fixture(scenario = 'feasible'): EventRecord {
 const r = newRecord();
 const stamp = { version: r.version, stale: false, updatedAt: new Date().toISOString() };
 r.outputs.lead = { ...stamp, data: { ...previewOutput('lead', r) as LeadOutput, guestRoster: r.guests } };
 const c = previewOutput('catering', r) as CateringOutput;
 r.outputs.catering = { ...stamp, data: { ...c, quote: calculateQuote(c.vendorId,c.mealCount), vendorName: vendors[0].name, dietaryEvidence: [], source:'Fictional evaluation fixture' } };
 r.outputs.design = { ...stamp, data: previewOutput('design',r) as DesignOutput };
 if(scenario==='over_budget') r.brief.budget = 500;
 if(scenario==='missing_dietary'||scenario==='home_cooking') { const v=vendors[scenario==='home_cooking'?2:1]; r.outputs.catering.data.vendorId=v.id;r.outputs.catering.data.quote=calculateQuote(v.id,c.mealCount); }
 if(scenario==='insufficient_seating') r.brief.capacity=10;
 if(scenario==='late_deadline') r.brief.changeAfterDeadline=true;
 if(scenario==='late_rsvp') { r.brief.guestCount=14;r.guests=makeGuests(r.brief);r.version++;markStale(r,['lead','catering','design','evaluation']); }
 return r;
}
async function main() {
 let failed=0,passed=0,skipped=0;
 console.log('DETERMINISTIC CHECKS · fictional local fixtures');
 const llm: {skill:string;test: { id:string;scenario:string;expectedBehavior:string }}[]=[];
 for(const skill of readdirSync('.agents/skills')) { const file=path.join('.agents/skills',skill,'evals.yaml'); const cases=parse(readFileSync(file,'utf8')).cases;
 for(const test of cases) { if(test.kind==='llm'){llm.push({skill,test});continue;} const r=fixture(test.scenario); const result=evaluation(r,{summary:'Deterministic scenario; no LLM review.',issues:[]},'preview',loadConfig().workflow.gates); const ok=result.status===test.expectedStatus; ok?passed++:failed++; console.log(`${ok?'PASS':'FAIL'} ${skill}/${test.id}: ${result.status} (expected ${test.expectedStatus})`); }
 }
 console.log('\nLLM EVALUATIONS · real Gemini / Google ADK');
 if(!process.env.GEMINI_API_KEY) for(const {skill,test} of llm){skipped++;console.log(`SKIP ${skill}/${test.id}: GEMINI_API_KEY is not supplied`);}
 else { const run=await executeWorkflow({config:loadConfig(),record:newRecord(),mode:'live',apiKey:process.env.GEMINI_API_KEY}); for(const {skill,test} of llm){const id=({ 'lead-planner':'lead','catering-logistics':'catering','design-experience':'design','evaluation-readiness':'evaluation' } as Record<string,AgentId>)[skill];const ok=run.status==='complete'&&!!run.final?.outputs[id]&&run.events.some(e=>e.agent===id&&e.tool==='submit_output'&&e.result)&&run.final.outputs.evaluation?.data.status==='PASS';ok?passed++:failed++;console.log(`${ok?'PASS':'FAIL'} ${skill}/${test.id}: actual live submission, allowed tools, saved output, required gates`); } }
 console.log(`\n${passed} passed · ${failed} failed · ${skipped} skipped`); process.exitCode=failed?1:0;
}
if(process.argv[1]?.endsWith('evaluate.ts')) await main();
