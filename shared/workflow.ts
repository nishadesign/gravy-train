import { previewSpeeds, type PreviewSpeed, type PresentationPhase } from './pacing';
import { z } from 'zod';
import { agentIds, type AgentId, type Activity, type EventRecord, type Run, type PublicConfig, type LeadOutput, type CateringOutput, type DesignOutput } from './types';
import { calculateQuote, evaluation, markStale, outputSchemas, validatePlan, vendors } from './domain';
import { previewOutput } from './preview';

export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') { let s = value.replace(/AIza[\w-]{15,}/g, '[REDACTED]').replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]'); for (const secret of secrets) if (secret) s = s.split(secret).join('[REDACTED]'); return s; }
  if (Array.isArray(value)) return value.map(v => redact(v, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /api.?key|authorization|secret|credential|token/i.test(k) ? '[REDACTED]' : redact(v, secrets)]));
  return value;
}
export function safeError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : error);
  if (/429|RESOURCE_EXHAUSTED/.test(raw)) return 'Gemini quota or rate limit reached. Check your AI Studio quota and billing, then try again.';
  if (/401|403|API_KEY_INVALID|API key not valid/.test(raw)) return 'Gemini rejected the API key. Check the key and its API permissions in Settings.';
  if (/404|NOT_FOUND/.test(raw)) return 'This Gemini model is unavailable for your key. Choose another model in Settings.';
  if (/abort|timeout|timed out/i.test(raw)) return 'The Gemini step timed out. Check your connection and retry; no replay was substituted.';
  return String(redact(raw)).slice(0, 1200);
}
export interface WorkflowTool { name: string; description: string; parameters: z.ZodObject; execute: (args: unknown) => Promise<unknown>; }
export type LiveStep = (id: AgentId, task: string, consolidate: boolean) => Promise<void>;
export interface WorkflowOptions { fastPreview?: boolean; prepareLiveSteps?: (toolsForAgent: (id: AgentId) => WorkflowTool[]) => LiveStep; config: PublicConfig; record: EventRecord; mode: Run['mode']; previewSpeed?: PreviewSpeed; apiKey?: string; models?: Partial<Record<AgentId, string>>; evaluateFirst?: boolean; authorizedSimulation?: { kind: 'rsvp' | 'vendor'; note: string }; emit?: (event: Activity) => void; persist?: (run: Run) => Promise<void>; }
export function createRun(record: EventRecord, mode: Run['mode'], previewSpeed: PreviewSpeed = 'slow'): Run { return { id: crypto.randomUUID(), mode, ...(mode === 'preview' ? { previewSpeed } : {}), startedAt: new Date().toISOString(), status: 'running', events: [], initial: structuredClone(record) }; }
export async function executeWorkflow(options: WorkflowOptions, run = createRun(options.record, options.mode, options.previewSpeed)): Promise<Run> {
  const { config, record, mode } = options;
  const pace = previewSpeeds[options.previewSpeed || run.previewSpeed || 'slow'];
  // These waits pace the actual local workflow, not a fabricated progress feed.
  // Saved output events still occur only after the step has succeeded.
  const pause = async (phase: PresentationPhase) => {
    if (mode !== 'preview' || options.fastPreview) return;
    const ms = pace.delays[phase];
    if (ms) await new Promise(resolve => setTimeout(resolve, ms));
  };
  let active: AgentId = 'lead', round = 0, consolidate = false, staged: unknown, stepVersion = record.version;
  const emit = (e: Omit<Activity, 'id' | 'timestamp'>) => { const event = redact({ ...e, id: crypto.randomUUID(), timestamp: new Date().toISOString() }, [options.apiKey || '']) as Activity; run.events.push(event); options.emit?.(event); };
  const cfg = (id: AgentId) => config.agents.find(a => a.id === id)!;
  const model = (id: AgentId) => options.models?.[id] || cfg(id).model;
  const inputSchema = (name: string, id: AgentId) => {
    if (name === 'search_caterers') return z.object({ readyToServeOnly: z.boolean() });
    if (name === 'calculate_costs') return z.object({ vendorId: z.string(), mealCount: z.number().int().min(0).max(100) });
    if (name === 'record_simulated_response') return z.object({ kind: z.enum(['rsvp', 'vendor']), note: z.string().max(500), guestId: z.string().optional(), rsvp: z.enum(['confirmed', 'pending', 'declined']).optional() });
    if (name === 'submit_output') return z.object({ output: id === 'lead' ? z.union([outputSchemas.lead, z.object({ summary: z.string().min(10) })]) : outputSchemas[id] });
    return z.object({});
  };
  async function callTool(id: AgentId, name: string, args: unknown) {
    if (id !== active || !cfg(id).tools.includes(name)) throw new Error('Tool is not authorized for this agent.');
    const metadata = config.tools.find(t => t.name === name)!;
    const start = Date.now();
    emit({ type: 'tool', agent: id, state: 'using tool', title: metadata.purpose, tool: name, args, model: model(id), round });
    try {
      await pause('tool');
      const parsed = inputSchema(name, id).parse(args) as Record<string, unknown>;
      let result: unknown;
      if (name === 'read_event') result = { notice: 'Fictional sample guests and vendors. Nothing has been sent or booked.', record: structuredClone(record) };
      else if (name === 'search_caterers') result = vendors.filter(v => !parsed.readyToServeOnly || v.readyToServe).map(v => ({ ...v, quote: calculateQuote(v.id, record.brief.guestCount) }));
      else if (name === 'calculate_costs') result = calculateQuote(String(parsed.vendorId), Number(parsed.mealCount));
      else if (name === 'validate_plan') result = validatePlan(record);
      else if (name === 'record_simulated_response') {
        const authorized = options.authorizedSimulation;
        if (!authorized || parsed.kind !== authorized.kind || parsed.note !== authorized.note) throw new Error('This simulation needs an explicit matching host authorization. Use the host’s simulation controls.');
        const note = `SIMULATED ${authorized.kind.toUpperCase()}: ${authorized.note}`;
        record.simulations.push({ kind: authorized.kind, note, timestamp: new Date().toISOString() });
        record.revision++; options.authorizedSimulation = undefined;
        result = { note, realConfirmation: false };
        emit({ type: 'revision', agent: id, title: note, record: structuredClone(record) });
      } else if (name === 'submit_output') {
        if (record.version !== stepVersion) throw new Error('Version conflict: event requirements changed.');
        staged = consolidate ? z.object({ summary: z.string().min(10) }).parse(parsed.output) : outputSchemas[id].parse(parsed.output);
        result = { validated: true, commit: 'Saved only after this agent step succeeds.', version: record.version, owner: id };
      } else throw new Error('No local implementation registered.');
      emit({ type: 'tool', agent: id, state: id === 'evaluation' ? 'reviewing' : 'working', title: `${name.replaceAll('_', ' ')} · result`, tool: name, args, result, durationMs: Date.now() - start, model: model(id), round });
      return result;
    } catch (error) {
      const message = safeError(error); emit({ type: 'error', agent: id, state: 'needs attention', title: `Tool error: ${name}`, tool: name, args, result: { error: message }, durationMs: Date.now() - start });
      return { error: message, retryWithCorrectedArguments: true };
    }
  }
  const liveStep = mode === 'live' ? options.prepareLiveSteps?.(id => cfg(id).tools.map(name => ({
    name, description: config.tools.find(t => t.name === name)!.purpose,
    parameters: inputSchema(name, id), execute: args => callTool(id, name, args),
  }))) : undefined;
  async function step(id: AgentId, task: string) {
    active = id; staged = undefined; stepVersion = record.version;
    const start = Date.now(), a = cfg(id);
    emit({ type: 'step', agent: id, state: id === 'evaluation' ? 'reviewing' : 'working', title: task, model: model(id), responsibility: a.objective, input: `${record.brief.guestCount} guests · $${record.brief.budget} · brief v${record.version}. ${mode === 'preview' ? 'Local fixture; configured model is not called.' : 'Real Gemini call through Google ADK.'}`, round });
    if (mode === 'preview') {
      await pause('task');
      await callTool(id, 'read_event', {});
      if (id === 'catering') { await callTool(id, 'search_caterers', { readyToServeOnly: false }); await callTool(id, 'calculate_costs', { vendorId: vendors[0].id, mealCount: record.brief.guestCount }); }
      if (id === 'evaluation' || id === 'design') await callTool(id, 'validate_plan', {});
      await callTool(id, 'submit_output', { output: previewOutput(id, record, consolidate) });
    } else {
      if (!liveStep) throw new Error('Live planning requires the local server and a Gemini API key.');
      await liveStep(id, task, consolidate);
    }
    if (!staged) throw new Error(`${a.shortName} did not submit valid structured output. No result was marked complete. Try the run again.`);
    if (record.version !== stepVersion) throw new Error('The brief changed while this step was running; result rejected.');
    const stamp = { version: record.version, stale: false, updatedAt: new Date().toISOString() };
    if (id === 'lead') {
      if (consolidate && record.outputs.lead) record.outputs.lead = { ...stamp, data: { ...record.outputs.lead.data, summary: (staged as { summary: string }).summary } };
      else record.outputs.lead = { ...stamp, data: { ...outputSchemas.lead.parse(staged), guestRoster: structuredClone(record.guests) } as LeadOutput };
    } else if (id === 'catering') {
      const data = outputSchemas.catering.parse(staged), vendor = vendors.find(v => v.id === data.vendorId);
      if (!vendor) throw new Error('Agent selected an unknown vendor.');
      record.outputs.catering = { ...stamp, data: { ...data, vendorName: vendor.name, quote: calculateQuote(vendor.id, data.mealCount), dietaryEvidence: [vendor.vegetarian, vendor.nutAllergy].filter(Boolean) as string[], source: 'Fictional local catalog · no vendor contacted' } as CateringOutput };
    } else if (id === 'design') record.outputs.design = { ...stamp, data: staged as DesignOutput };
    else record.outputs.evaluation = { ...stamp, data: evaluation(record, outputSchemas.evaluation.parse(staged), mode, config.workflow.gates) };
    if (!consolidate) markStale(record, config.workflow.invalidation[id]);
    record.revision++;
    emit({ type: 'output', agent: id, state: id === 'evaluation' && record.outputs.evaluation?.data.status !== 'PASS' ? 'needs attention' : 'complete', title: consolidate ? 'Your event plan is brought together' : `${a.shortName} ${id === 'evaluation' ? 'reviewed the plan' : 'saved its output'}`, result: record.outputs[id]?.data, model: model(id), durationMs: Date.now() - start, record: structuredClone(record), round });
    await pause('complete');
  }
  try {
    emit({ type: 'run', title: mode === 'live' ? 'Live Gemini planning started' : 'Local preview started · no AI calls', record: structuredClone(record) });
    for (const id of config.workflow.order) emit({ type: 'step', agent: id, state: 'queued', title: `${cfg(id).shortName} is queued`, model: model(id) });
    if (options.evaluateFirst) await step('evaluation', 'Review the changed guest list against existing meals and seating before corrections.');
    else for (const id of config.workflow.order) { await step(id, cfg(id).objective); emit({ type: 'handoff', agent: id, title: config.workflow.handoffs[id] }); await pause('handoff'); }
    while (record.outputs.evaluation?.data.status !== 'PASS' && round < config.workflow.correctionLimit) {
      const issues = record.outputs.evaluation?.data.issues || [];
      // Host-input issues stay visible; repair any independently repairable outputs.
      const responsible = new Set<AgentId>(issues.filter(i => !i.hostInput).map(i => i.responsible));
      for (const id of config.workflow.order) if (id !== 'evaluation' && record.outputs[id]?.stale) responsible.add(id);
      if (!responsible.size) break;
      round++;
      emit({ type: 'handoff', agent: 'lead', state: 'working', title: `Lead routes correction round ${round}/${config.workflow.correctionLimit}`, result: issues });
      await pause('handoff');
      for (const id of config.workflow.order.filter(id => id !== 'evaluation')) {
        if (responsible.has(id) || record.outputs[id]?.stale) await step(id, `Correction round ${round}: ${issues.filter(i => i.responsible === id).map(i => i.correction).join(' ') || 'Refresh this output using the corrected upstream work.'}`);
      }
      await step('evaluation', `Independently re-evaluate all required gates after correction round ${round}.`);
    }
    if (record.outputs.evaluation && record.outputs.evaluation.data.status !== 'PASS') {
      record.outputs.evaluation.data.status = 'NEEDS_HOST_INPUT'; record.revision++;
      emit({ type: 'revision', agent: 'evaluation', state: 'needs attention', title: 'Unresolved choices need the host’s input', record: structuredClone(record) });
    }
    consolidate = true; await step(config.workflow.consolidate, 'Consolidate the evaluated result, proposed cost, invitations and unresolved host choices.');
    run.status = 'complete';
    emit({ type: 'run', title: record.outputs.evaluation?.data.status === 'PASS' ? 'Plan checks passed · no invitations sent or vendor booked' : 'Plan is ready to review · host input needed', record: structuredClone(record) });
  } catch (error) {
    run.status = 'failed'; markStale(record, ['evaluation']);
    emit({ type: 'error', agent: active, state: 'needs attention', title: safeError(error), record: structuredClone(record) });
  }
  run.finishedAt = new Date().toISOString(); run.final = structuredClone(record);
  await options.persist?.(run);
  return run;
}
