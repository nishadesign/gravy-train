import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createBrowserSample } from '../src/browserSample';
import { loadConfig } from '../server/config';
import { sampleBrief } from '../shared/sample';
import type { Run } from '../shared/types';

const session = () => createBrowserSample(loadConfig(), { fastPreview: true });
async function finish(client: ReturnType<typeof session>, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await client<Run>('/runs/' + id);
    if (run.status !== 'running') return run;
    await wait(1);
  }
  throw new Error('Browser sample did not finish.');
}
async function plan(client: ReturnType<typeof session>, extra = {}) {
  const { id } = await client('/run', 'POST', { mode: 'preview', ...extra });
  return finish(client, id);
}

test('browser sample completes all four agents without network access', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Network is unavailable.'); });
  const client = session();
  const initial = await client('/state');
  assert.deepEqual(initial.record.outputs, {});
  const { id } = await client('/run', 'POST', { mode: 'preview' });
  assert.equal((await client('/state')).busy, true);
  await assert.rejects(client('/event/sample', 'POST'), /current plan/);
  await assert.rejects(client('/run', 'POST', { mode: 'preview' }), /current plan/);
  const run = await finish(client, id);
  assert.equal(run.status, 'complete');
  assert.equal(run.previewSpeed, 'slow');
  assert.equal(run.final?.outputs.evaluation?.data.status, 'PASS');
  assert.equal(run.final?.outputs.catering?.data.quote.total, 737.29);
  assert.deepEqual(run.events.filter(e => e.type === 'output').map(e => e.agent), ['lead', 'catering', 'design', 'evaluation', 'lead']);
  assert.equal((await client('/state')).busy, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test('browser late RSVPs review the old plan, then update meals, seats and costs', async () => {
  const client = session();
  await plan(client);
  const run = await plan(client, { late: true, previewSpeed: 'quick' });
  const review = run.events.find(e => e.type === 'output' && e.agent === 'evaluation')?.record?.outputs.evaluation?.data;
  assert.ok(review?.issues.some(issue => issue.id === 'meals'));
  assert.ok(review?.issues.some(issue => issue.id === 'seats'));
  assert.equal(run.final?.brief.guestCount, 14);
  assert.equal(run.final?.outputs.catering?.data.mealCount, 14);
  assert.equal(run.final?.outputs.catering?.data.quote.total, 824.79);
  assert.equal(run.final?.outputs.design?.data.seats.length, 14);
  assert.equal(run.final?.outputs.evaluation?.data.status, 'PASS');
  assert.equal(run.final?.guests.filter(guest => guest.nutAllergy).length, 1);
  assert.ok(run.events.some(e => e.round === 1));
});

test('editing, rerunning and resetting work entirely in the browser session', async () => {
  const client = session();
  await plan(client);
  const record = await client('/event', 'POST', { brief: { ...sampleBrief, budget: 100 } });
  assert.equal(record.outputs.evaluation.stale, true);
  await assert.rejects(client('/run', 'POST', { mode: 'preview', late: true }), /current plan/);
  const run = await plan(client);
  assert.equal(run.final?.outputs.evaluation?.data.status, 'NEEDS_HOST_INPUT');
  assert.ok(run.final?.outputs.evaluation?.data.issues.some(issue => issue.id === 'budget'));
  const reset = await client('/event/sample', 'POST');
  assert.deepEqual(reset.record.outputs, {});
  assert.equal(reset.record.brief.budget, 900);
  assert.deepEqual((await client('/state')).runs, []);
});

test('unsupported modes and invalid event details cannot mutate sample state', async () => {
  const client = session();
  await assert.rejects(client('/run', 'POST', { mode: 'live' }), /local planning only/);
  await assert.rejects(client('/run', 'POST', { mode: 'preview', previewSpeed: 'instant', late: true }), /planning speed/);
  await assert.rejects(client('/event', 'POST', { brief: { ...sampleBrief, vegetarianCount: 13 } }), /dietary counts/);
  await assert.rejects(client('/settings', 'POST', { apiKey: 'unused' }), /not available/);
  assert.deepEqual((await client('/state')).record.brief, sampleBrief);
});

test('browser sessions and returned snapshots cannot alter each other', async () => {
  const first = session(), second = session();
  const snapshot = await first('/state');
  snapshot.record.brief.budget = 1;
  assert.equal((await first('/state')).record.brief.budget, 900);
  await plan(first);
  assert.deepEqual((await second('/state')).record.outputs, {});
  assert.equal((await second('/state')).busy, false);
});
