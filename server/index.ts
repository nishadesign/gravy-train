import { previewSpeeds, type PreviewSpeed } from '../shared/pacing';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config';
import { createRun, executeWorkflow, redact, safeError } from './workflow';
import { markStale } from './domain';
import { newRecord, makeGuests, sampleBrief } from '../shared/sample';
import { agentIds, briefSchema, type Run, type AgentId } from '../shared/types';
const app = express(), config = loadConfig();
let record = newRecord(), busy = false, apiKey = process.env.GEMINI_API_KEY || '';
let models: Partial<Record<AgentId, string>> = {};
const runs = new Map<string, Run>(), dir = path.resolve('data/runs');
await mkdir(dir, { recursive: true });
for (const file of await readdir(dir)) if (/^[\w-]+\.json$/.test(file)) { try { const r = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Run; runs.set(r.id, r); } catch {} }
app.use(express.json({ limit: '32kb' }));
// This prototype binds to loopback and refuses cross-origin mutations.
app.use('/api', (req, res, next) => { const origin = req.headers.origin; if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:3001', 'http://localhost:3001'].includes(origin)) { res.status(403).json({ error: 'Use Gravy Train on localhost.' }); return; } res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/state', (_req, res) => res.json({ record, config, busy, settings: { hasKey: !!apiKey, models }, runs: [...runs.values()].map(r => ({ id: r.id, mode: r.mode, status: r.status, startedAt: r.startedAt })) }));
app.post('/api/settings', (req, res) => { if (busy) { res.status(409).json({ error: 'Wait for the active run before changing models.' }); return; } if (typeof req.body.apiKey === 'string' && req.body.apiKey.trim()) apiKey = req.body.apiKey.trim(); if (req.body.models) { for (const id of agentIds) { const m = req.body.models[id]; if (typeof m === 'string' && /^gemini-[\w.-]{1,80}$/.test(m)) models[id] = m; } } res.json({ hasKey: !!apiKey, models }); });
app.post('/api/test-connection', async (_req, res) => { try { if (!apiKey) throw new Error('Save your Gemini API key first.'); const client = new GoogleGenAI({ apiKey }); const r = await client.models.generateContent({ model: models.lead || config.agents[0].model, contents: 'Reply with OK.', config: { maxOutputTokens: 64, httpOptions: { timeout: 20000 } } }); if (!r.text) throw new Error('Gemini returned an empty response. Try another model.'); res.json({ message: 'Connected. Gemini returned a real response.' }); } catch (e) { res.status(400).json({ error: safeError(e) }); } });
app.post('/api/event', (req, res) => { if (busy) { res.status(409).json({ error: 'A run is already active.' }); return; } const b = briefSchema.safeParse(req.body.brief || sampleBrief); if (!b.success || b.data.vegetarianCount > b.data.guestCount || b.data.nutAllergyCount > b.data.guestCount) { res.status(400).json({ error: 'Check the event fields and dietary counts.' }); return; } const guests = makeGuests(b.data); record = { ...record, brief: b.data, version: record.version + 1, revision: record.revision + 1, guests }; markStale(record, [...agentIds]); res.json(record); });
app.post('/api/event/sample', (_req, res) => { if (busy) { res.status(409).json({ error: 'Wait for the current plan to finish.' }); return; } const version = record.version + 1; record = { ...newRecord(), version }; res.json({ record }); });
app.get('/api/runs/:id', (req, res) => { const r = runs.get(req.params.id); if (!r) { res.status(404).json({ error: 'Run not found.' }); return; } res.json(r); });
app.post('/api/run', (req, res) => {
  if (busy) { res.status(409).json({ error: 'A run is already active.' }); return; }
  const mode = req.body.mode === 'preview' ? 'preview' : 'live';
  const previewSpeed = req.body.previewSpeed ?? 'slow';
  if (typeof previewSpeed !== 'string' || !Object.hasOwn(previewSpeeds, previewSpeed)) { res.status(400).json({ error: 'Choose Slow, Normal or Quick planning speed.' }); return; }
  if (mode === 'live' && !apiKey) { res.status(400).json({ error: 'Add a Gemini key in Settings, or choose the labeled local preview.' }); return; }
  if (req.body.late) {
    if (!record.outputs.catering || record.brief.guestCount > 38) { res.status(400).json({ error: 'Complete a plan first; the maximum is 40 guests.' }); return; }
    record.brief.guestCount += 2; record.brief.changeAfterDeadline = !!req.body.afterDeadline;
    const full = makeGuests(record.brief); record.guests.push(...full.slice(-2).map(g => ({ ...g, vegetarian: false, nutAllergy: false })));
    record.version++; record.revision++; markStale(record, [...agentIds]);
    record.simulations.push({ kind: 'rsvp', note: 'SIMULATED: Two late RSVPs added by host. No guests were contacted.', timestamp: new Date().toISOString() });
  }
  busy = true; const run = createRun(record, mode, previewSpeed as PreviewSpeed); runs.set(run.id, run); res.json({ id: run.id });
  void executeWorkflow({ config, record, mode, previewSpeed: previewSpeed as PreviewSpeed, apiKey, models: { ...models }, evaluateFirst: !!req.body.late, persist: async r => { await writeFile(path.join(dir, `${r.id}.json`), JSON.stringify(redact(r, [apiKey]), null, 2), { mode: 0o600 }); } }, run).catch(e => { run.status = 'failed'; run.finishedAt = new Date().toISOString(); console.error(redact(safeError(e), [apiKey])); }).finally(() => { busy = false; });
});
app.use(express.static(path.resolve('dist')));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: safeError(error) }));
app.listen(3001, '127.0.0.1', () => console.log('Gravy Train API: http://127.0.0.1:3001'));
