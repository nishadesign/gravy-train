import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentIds, type Activity } from '../shared/types';
import { createRun } from '../server/workflow';
import { deriveAgentStatuses } from '../src/agentStatus';
import { fixture } from '../scripts/evaluate';
import { evaluation, markStale } from '../server/domain';

const event = (data: Omit<Activity, 'id' | 'timestamp'>): Activity => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...data });

test('a new run resets cards to waiting instead of showing previous completion', () => {
  const record = fixture();
  const run = createRun(record, 'preview');
  run.events = agentIds.map(agent => event({ type: 'step', agent, state: 'queued', title: 'Queued' }));
  for (const status of Object.values(deriveAgentStatuses(record, run, true))) assert.equal(status.tone, 'waiting');
  for (const status of Object.values(deriveAgentStatuses(record, null, true))) assert.equal(status.tone, 'waiting');
});

test('a tool submission is still working until the backend saves the output', () => {
  const record = fixture();
  const run = createRun(record, 'preview');
  run.events.push(event({ type: 'step', agent: 'catering', state: 'working', title: 'Choose meals' }));
  run.events.push(event({ type: 'tool', agent: 'catering', state: 'working', title: 'Result', tool: 'submit_output', result: { validated: true } }));
  let status = deriveAgentStatuses(record, run, true).catering;
  assert.equal(status.tone, 'working');
  assert.equal(status.task, 'Saving the menu & total cost');
  run.events.push(event({ type: 'output', agent: 'catering', state: 'complete', title: 'Output saved' }));
  status = deriveAgentStatuses(record, run, true).catering;
  assert.equal(status.tone, 'done');
  assert.equal(status.task, '12 meals proposed');
  assert.match(status.detail, /737.29/);
});

test('stale work never looks complete and waits for corrections during a run', () => {
  const record = fixture();
  markStale(record, ['catering']);
  const run = createRun(record, 'preview');
  run.events.push(event({ type: 'output', agent: 'catering', state: 'complete', title: 'Old output saved' }));
  assert.equal(deriveAgentStatuses(record, run, true).catering.tone, 'waiting');
  assert.equal(deriveAgentStatuses(record, null, false).catering.tone, 'outdated');
});

test('failed runs distinguish the failed agent from work that never ran', () => {
  const record = fixture();
  const run = createRun(record, 'preview');
  run.status = 'failed';
  run.events = [event({ type: 'error', agent: 'catering', state: 'needs attention', title: 'No valid menu was submitted.' }), event({ type: 'step', agent: 'design', state: 'queued', title: 'Queued' })];
  const statuses = deriveAgentStatuses(record, run, false);
  assert.equal(statuses.catering.label, 'Failed');
  assert.equal(statuses.catering.detail, 'No valid menu was submitted.');
  assert.equal(statuses.design.label, 'Not run');
});

test('evaluation cards retain issues and consolidation is a distinct lead task', () => {
  const record = fixture('over_budget');
  record.outputs.evaluation = { version: record.version, stale: false, updatedAt: new Date().toISOString(), data: evaluation(record, { summary: 'Budget exceeds the host limit.', issues: [] }, 'preview', ['budget']) };
  const run = createRun(record, 'preview');
  run.events = [event({ type: 'step', agent: 'evaluation', state: 'reviewing', title: 'Review corrections', round: 2 }), event({ type: 'output', agent: 'evaluation', state: 'needs attention', title: 'Reviewed' }), event({ type: 'step', agent: 'lead', state: 'working', title: 'Consolidate the evaluated result.' })];
  const statuses = deriveAgentStatuses(record, run, true);
  assert.equal(statuses.evaluation.tone, 'attention');
  assert.equal(statuses.evaluation.phase, 'Correction 2');
  assert.match(statuses.evaluation.detail, /expense.*budget/);
  assert.equal(statuses.lead.phase, 'Final summary');
  assert.equal(statuses.lead.task, 'Bringing the checked plan together');
});

test('a correction handoff leaves only the agent doing the work active', () => {
  const record = fixture('over_budget');
  const run = createRun(record, 'preview');
  run.events = [
    event({ type: 'handoff', agent: 'lead', state: 'working', title: 'Assigning corrections', round: 1 }),
    event({ type: 'step', agent: 'catering', state: 'working', title: 'Correct the menu cost', round: 1 }),
  ];
  let statuses = deriveAgentStatuses(record, run, true);
  assert.deepEqual(agentIds.filter(id => statuses[id].tone === 'working'), ['catering']);
  assert.equal(statuses.lead.label, 'Waiting');
  run.events.push(event({ type: 'output', agent: 'catering', state: 'complete', title: 'Updated quote saved' }));
  statuses = deriveAgentStatuses(record, run, true);
  assert.deepEqual(agentIds.filter(id => statuses[id].tone === 'working'), []);
});
