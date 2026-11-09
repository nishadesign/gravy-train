import { agentIds, briefSchema, type PublicConfig, type Run } from '../shared/types';
import { makeGuests, newRecord, sampleBrief } from '../shared/sample';
import { markStale } from '../shared/domain';
import { previewSpeeds, type PreviewSpeed } from '../shared/pacing';
import { createRun, executeWorkflow, safeError } from '../shared/workflow';

/** A private, in-memory sample session. No API requests or credentials are used. */
export function createBrowserSample(config: PublicConfig, options: { fastPreview?: boolean } = {}) {
  let record = newRecord(), busy = false;
  const runs = new Map<string, Run>();
  return async function request<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
    const input = (body ?? {}) as Record<string, unknown>;
    const respond = (value: unknown) => structuredClone(value) as T;
    if (method === 'GET' && url === '/state') {
      return respond({ record, config, busy, settings: { hasKey: false, models: {} }, runs: [...runs.values()].map(({ id, mode, status, startedAt }) => ({ id, mode, status, startedAt })) });
    }
    if (method === 'GET' && url.startsWith('/runs/')) {
      const run = runs.get(url.slice('/runs/'.length));
      if (!run) throw new Error('Run not found.');
      return respond(run);
    }
    if (method !== 'POST') throw new Error('This action is not available in the browser sample.');
    if (busy) throw new Error('Wait for the current plan to finish.');
    if (url === '/event') {
      const parsed = briefSchema.safeParse(input.brief ?? sampleBrief);
      if (!parsed.success || parsed.data.vegetarianCount > parsed.data.guestCount || parsed.data.nutAllergyCount > parsed.data.guestCount) throw new Error('Check the event fields and dietary counts.');
      record = { ...record, brief: parsed.data, guests: makeGuests(parsed.data), version: record.version + 1, revision: record.revision + 1 };
      markStale(record, [...agentIds]);
      return respond(record);
    }
    if (url === '/event/sample') {
      record = { ...newRecord(), version: record.version + 1 };
      runs.clear();
      return respond({ record });
    }
    if (url !== '/run') throw new Error('This action is not available in the browser sample.');
    if (input.mode !== 'preview') throw new Error('The browser sample supports local planning only.');
    const speed = input.previewSpeed ?? 'slow';
    if (typeof speed !== 'string' || !Object.hasOwn(previewSpeeds, speed)) throw new Error('Choose Slow, Normal or Quick planning speed.');
    if (input.late) {
      if (!record.outputs.catering || record.outputs.catering.stale || !record.outputs.design || record.outputs.design.stale || record.brief.guestCount > 38) throw new Error('Complete a current plan first; the maximum is 40 guests.');
      record.brief.guestCount += 2;
      record.brief.changeAfterDeadline = !!input.afterDeadline;
      record.guests.push(...makeGuests(record.brief).slice(-2).map(guest => ({ ...guest, vegetarian: false, nutAllergy: false })));
      record.version++; record.revision++;
      markStale(record, [...agentIds]);
      record.simulations.push({ kind: 'rsvp', note: 'SIMULATED: Two late RSVPs added by host. No guests were contacted.', timestamp: new Date().toISOString() });
    }
    busy = true;
    const run = createRun(record, 'preview', speed as PreviewSpeed);
    runs.clear(); runs.set(run.id, run);
    void executeWorkflow({ config, record, mode: 'preview', previewSpeed: speed as PreviewSpeed, evaluateFirst: !!input.late, fastPreview: options.fastPreview }, run)
      .catch(error => {
        run.status = 'failed'; run.finishedAt = new Date().toISOString();
        markStale(record, ['evaluation']);
        run.events.push({ id: crypto.randomUUID(), timestamp: run.finishedAt, type: 'error', title: safeError(error), record: structuredClone(record) });
        run.final = structuredClone(record);
      })
      .finally(() => { busy = false; });
    return respond({ id: run.id });
  };
}
