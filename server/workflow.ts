import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LlmAgent, FunctionTool, Gemini, InMemoryRunner } from '@google/adk';
import type { AgentId, Run } from '../shared/types';
import { executeWorkflow as runWorkflow, type WorkflowOptions } from '../shared/workflow';
import { projectRoot } from './config';
export { createRun, redact, safeError } from '../shared/workflow';
export type { WorkflowOptions } from '../shared/workflow';

// Node-only Gemini integration stays out of the static browser sample.
export function executeWorkflow(options: WorkflowOptions, run?: Run): Promise<Run> {
  return runWorkflow({
    ...options,
    fastPreview: options.fastPreview ?? process.env.GATHER_FAST_PREVIEW === '1',
    prepareLiveSteps: toolsForAgent => {
      const agents = Object.fromEntries(options.config.agents.map(a => [a.id, new LlmAgent({
        name: a.id, description: a.objective,
        model: new Gemini({ model: options.models?.[a.id] || a.model, apiKey: options.apiKey, vertexai: false }),
        instruction: () => readFileSync(path.join(projectRoot, a.skill), 'utf8'),
        generateContentConfig: { ...a.settings, httpOptions: { timeout: 90000 } },
        tools: toolsForAgent(a.id).map(tool => new FunctionTool(tool)),
      })])) as Record<AgentId, LlmAgent>;
      return async (id, task, consolidate) => {
        if (!options.apiKey) throw new Error('Add a Gemini API key in Settings before starting a live run.');
        const runner = new InMemoryRunner({ agent: agents[id], appName: 'gather' });
        const session = await runner.sessionService.createSession({ appName: 'gather', userId: 'local-host' });
        const instruction = consolidate ? 'CONSOLIDATE: submit_output accepts only {output:{summary:"..."}}. Do not alter any plan details.' : 'Read current state, use allowed tools, then call submit_output with {output: your_complete_structured_output}.';
        const stream = runner.runAsync({ userId: 'local-host', sessionId: session.id, newMessage: { role: 'user', parts: [{ text: `${task}\n${instruction}\nCurrent feedback: ${JSON.stringify(options.record.outputs.evaluation?.data.issues || [])}` }] }, runConfig: { maxLlmCalls: 10 }, abortSignal: AbortSignal.timeout(120000) });
        for await (const event of stream) if (event.errorCode || event.errorMessage) throw new Error(event.errorMessage || event.errorCode);
      };
    },
  }, run);
}
