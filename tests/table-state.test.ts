import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newRecord } from '../shared/sample';
import { type Activity, type Run, type EventRecord } from '../shared/types';
import { createRun, executeWorkflow } from '../server/workflow';
import { loadConfig } from '../server/config';
import { fixture } from '../scripts/evaluate';
import { evaluation, markStale } from '../server/domain';
import { deriveTableState } from '../src/tableState';
import { deriveAgentStatuses } from '../src/agentStatus';
import TableScene from '../src/components/TableScene';
process.env.GATHER_FAST_PREVIEW = '1';
const event = (data: Omit<Activity, 'id' | 'timestamp'>): Activity => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...data });
const markup = (record: EventRecord, run: Run | null) => renderToStaticMarkup(createElement(TableScene, { record, table: deriveTableState(record, run), statuses: deriveAgentStatuses(record, run, !!run && run.status === 'running'), onOpen() {} }));

test('a new event starts with bare furniture and no settings or decoration', () => {
  const record = newRecord();
  const scene = deriveTableState(record, null);
  assert.equal(scene.placeCount, 0);
  assert.equal(scene.decorated, false);
  assert.equal(scene.invitationReady, false);
  const html = markup(record, null);
  assert.doesNotMatch(html, /data-artifact="(place-setting|table-runner|centerpiece|candle|catered-dish|place-card|readiness-checklist)"/);
});

test('a fresh rerun hides previous setup immediately and does not reuse old output', () => {
  const record = fixture();
  const pending = deriveTableState(record, null, 'plan');
  assert.equal(pending.placeCount, 0);
  assert.equal(pending.decorated, false);
  const run = createRun(record, 'preview');
  run.events.push(event({ type: 'step', agent: 'lead', state: 'working', title: 'Plan the event' }));
  const scene = deriveTableState(record, run);
  assert.equal(scene.planning, true);
  assert.equal(scene.invitationReady, false);
  assert.equal(scene.catering, undefined);
  assert.equal(scene.decorated, false);
});

test('catering starts the settings, but food requires its own saved output', () => {
  const record = fixture();
  const run = createRun(record, 'preview');
  run.events.push(event({ type: 'step', agent: 'catering', state: 'working', title: 'Plan the menu' }));
  let scene = deriveTableState(record, run);
  assert.equal(scene.placeCount, 12);
  assert.equal(scene.catering, undefined);
  let html = markup(record, run);
  assert.equal((html.match(/data-artifact="place-setting"/g) || []).length, 12);
  assert.doesNotMatch(html, /data-artifact="(catered-dish|napkin|candle|place-card)"/);
  run.events.push(event({ type: 'output', agent: 'catering', state: 'complete', title: 'Menu saved' }));
  scene = deriveTableState(record, run);
  assert.equal(scene.catering?.mealCount, 12);
  assert.match(markup(record, run), /data-artifact="catered-dish"/);
});

test('design adds decor while working and names only after seating is saved', () => {
  const record = fixture();
  const run = createRun(record, 'preview');
  run.events = [event({ type: 'output', agent: 'catering', state: 'complete', title: 'Saved menu' }), event({ type: 'step', agent: 'design', state: 'working', title: 'Style the table' })];
  const scene = deriveTableState(record, run);
  assert.equal(scene.decorated, true);
  assert.equal(scene.design, undefined);
  let html = markup(record, run);
  assert.match(html, /data-artifact="table-runner"/);
  assert.match(html, /data-artifact="candle"/);
  assert.doesNotMatch(html, /data-artifact="place-card"/);
  run.events.push(event({ type: 'output', agent: 'design', state: 'complete', title: 'Saved seating' }));
  html = markup(record, run);
  assert.equal((html.match(/data-artifact="place-card"/g) || []).length, 12);
});

test('late RSVPs preserve the old table until catering begins the correction', () => {
  const record = fixture('late_rsvp');
  const run = createRun(record, 'preview');
  run.events.push(event({ type: 'step', agent: 'evaluation', state: 'reviewing', title: 'Review changed guest list' }));
  let scene = deriveTableState(record, run);
  assert.equal(scene.placeCount, 12);
  assert.equal(scene.decorated, true);
  assert.equal(scene.design?.seats.length, 12);
  assert.equal(scene.evaluation, undefined);
  run.events.push(event({ type: 'step', agent: 'catering', state: 'working', title: 'Update meals', round: 1 }));
  scene = deriveTableState(record, run);
  assert.equal(scene.placeCount, 14);
  assert.equal(scene.design?.seats.length, 12, 'New guests do not receive invented assignments.');
  assert.equal((markup(record, run).match(/data-artifact="napkin"/g) || []).length, 12, 'The new places are not styled before the design agent works.');
});

test('failure removes unfinished construction and stale evaluation never shows checks', () => {
  const record = fixture();
  record.outputs.evaluation = { version: record.version, stale: false, updatedAt: new Date().toISOString(), data: evaluation(record, { summary: 'Review complete for this version.', issues: [] }, 'preview', ['budget']) };
  markStale(record, ['evaluation']);
  const run = createRun(record, 'preview');
  run.events = [event({ type: 'step', agent: 'catering', state: 'working', title: 'Prepare menu' }), event({ type: 'error', agent: 'catering', state: 'needs attention', title: 'Failed to save a menu' })];
  run.status = 'failed';
  const scene = deriveTableState(record, run);
  assert.equal(scene.placeCount, 0);
  assert.equal(scene.decorated, false);
  assert.equal(scene.evaluation, undefined);
  assert.doesNotMatch(markup(record, run), /data-artifact="check-pass"/);
});

test('real workflow milestones reveal each owner’s artifacts in sequence', async () => {
  const record = newRecord(), run = createRun(record, 'preview');
  const observed: { agent?: string; type: string; scene: ReturnType<typeof deriveTableState> }[] = [];
  await executeWorkflow({ config: loadConfig(), record, mode: 'preview', emit: e => {
    if (e.type === 'output' || e.type === 'step' && e.state !== 'queued') observed.push({ agent: e.agent, type: e.type, scene: deriveTableState(record, run) });
  } }, run);
  const lead = observed.find(e => e.agent === 'lead' && e.type === 'output')!;
  const catering = observed.find(e => e.agent === 'catering' && e.type === 'step')!;
  const design = observed.find(e => e.agent === 'design' && e.type === 'step')!;
  const review = observed.find(e => e.agent === 'evaluation' && e.type === 'output')!;
  assert.equal(lead.scene.invitationReady, true);
  assert.equal(lead.scene.placeCount, 0);
  assert.equal(catering.scene.placeCount, 12);
  assert.equal(catering.scene.decorated, false);
  assert.equal(design.scene.decorated, true);
  assert.equal(review.scene.evaluation?.status, 'PASS');
});
