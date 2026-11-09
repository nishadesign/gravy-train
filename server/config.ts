import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { agentIds, type PublicConfig } from '../shared/types';
const ids = z.enum(agentIds);
const agentSchema = z.object({ id: ids, name: z.string(), shortName: z.string(), objective: z.string(), skill: z.string(), model: z.string().startsWith('gemini-'), tools: z.array(z.string()).min(1), settings: z.object({ temperature: z.number().min(0).max(2), maxOutputTokens: z.number().int().positive() }).strict() });
const toolSchema = z.object({ name: z.enum(['read_event', 'search_caterers', 'calculate_costs', 'validate_plan', 'record_simulated_response', 'submit_output']), purpose: z.string(), inputs: z.string(), outputs: z.string(), dataSource: z.string(), modifiesState: z.boolean() });
const workflowSchema = z.object({ order: z.array(ids), consolidate: z.literal('lead'), correctionLimit: z.number().int().min(0).max(2), handoffs: z.record(z.string(), z.string()), invalidation: z.record(ids, z.array(ids)), gates: z.array(z.string()).min(1) });
export const projectRoot = process.cwd();
const readYaml = (name: string) => parse(readFileSync(path.join(projectRoot, 'config', name), 'utf8'));
export function loadConfig(): PublicConfig {
  const agents = z.object({ agents: z.array(agentSchema).length(4) }).parse(readYaml('agents.yaml')).agents;
  const tools = z.object({ tools: z.array(toolSchema) }).parse(readYaml('tools.yaml')).tools;
  const workflow = workflowSchema.parse(readYaml('workflow.yaml'));
  if (new Set(agents.map(a => a.id)).size !== 4 || new Set(workflow.order).size !== 4 || workflow.order.length !== 4 || workflow.order.at(-1) !== 'evaluation') throw new Error('Workflow must include all four agents once, ending with evaluation.');
  for (const a of agents) {
    if (a.tools.some(t => !tools.some(x => x.name === t)) || !a.tools.includes('submit_output')) throw new Error(`Invalid tools for ${a.id}`);
    if (!a.skill.startsWith('.agents/skills/') || a.skill.includes('..')) throw new Error('Skill path must be local to .agents/skills');
    readFileSync(path.join(projectRoot, a.skill), 'utf8');
  }
  const lines = ['flowchart TD', '  host["Host brief / requirement changes"] --> lead', '  state[("Shared event record · version + revision")]', ...agents.map(a => `  ${a.id}["${a.name.replaceAll('&', 'and')}"]`), ...workflow.order.slice(0, -1).map((id, i) => `  ${id} -->|"${workflow.handoffs[id]}"| ${workflow.order[i + 1]}`), `  evaluation -->|"Consolidate result"| ${workflow.consolidate}`, ...agents.flatMap(a => [`  ${a.id} <--> state`, `  ${a.id} --- ${a.id}_tools["${a.tools.join('<br/>')}"]`]), '  evaluation -->|"Issues + responsible agent"| correction{"Required gates pass?"}', '  correction -->|"Yes"| result["Checked plan · no booking"]', `  correction -->|"Revise · max ${workflow.correctionLimit} rounds"| lead`, '  correction -->|"Unresolved"| host_input["Host choices required"]'];
  return { agents, tools, workflow, diagram: lines.join('\n') };
}
