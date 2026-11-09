import type { AgentId, CateringOutput, DesignOutput, EvaluationOutput, EventRecord, LeadOutput, Run } from '../shared/types';

export type PendingRun = 'plan' | 'revision' | null;
export interface TableState {
  planning: boolean;
  invitationReady: boolean;
  placeCount: number;
  decorated: boolean;
  reviewing: boolean;
  catering?: CateringOutput;
  design?: DesignOutput;
  evaluation?: EvaluationOutput;
  caption: string;
}

/** Construction follows agent starts; food, names and check marks require saved results. */
export function deriveTableState(record: EventRecord, run: Run | null, pending: PendingRun = null): TableState {
  const firstStep = run?.events.find(e => e.type === 'step' && e.state !== 'queued');
  const revising = pending === 'revision' || firstStep?.agent === 'evaluation';
  const reset = pending === 'plan';
  const started = (id: AgentId) => !reset && !!run && run.status !== 'failed' && run.events.some(e => e.type === 'step' && e.agent === id && e.state !== 'queued');
  const saved = (id: AgentId) => !reset && !!run?.events.some(e => e.type === 'output' && e.agent === id);
  const fresh = (id: AgentId) => record.outputs[id] && !record.outputs[id]!.stale && record.outputs[id]!.version === record.version;
  const usable = (id: AgentId) => !reset && (run ? saved(id) || revising : fresh(id));
  const lead = usable('lead') ? record.outputs.lead?.data as LeadOutput | undefined : undefined;
  const catering = usable('catering') ? record.outputs.catering?.data : undefined;
  const design = usable('design') ? record.outputs.design?.data : undefined;
  // A retained, outdated review must never look like approval of the revised table.
  const evaluation = usable('evaluation') && fresh('evaluation') ? record.outputs.evaluation?.data : undefined;
  const placing = started('catering');
  const styling = started('design');
  const latest = run?.events.filter(e => e.agent && e.state && e.state !== 'queued').at(-1);
  const active = !reset && run?.status === 'running' && latest && ['working', 'using tool', 'reviewing'].includes(latest.state!) ? latest.agent : undefined;
  let caption = 'A bare table, ready for your team.';
  if (active === 'lead') caption = saved('evaluation') ? 'Bringing the finished plan together.' : 'Organizing your guests and invitations.';
  else if (active === 'catering') caption = `Catering is setting out ${record.brief.guestCount} places.`;
  else if (active === 'design') caption = 'Design is adding the autumn details.';
  else if (active === 'evaluation') caption = 'Readiness is checking the whole table.';
  else if (evaluation) caption = evaluation.status === 'PASS' ? 'Table planned. Every required check passed.' : 'Some details still need your attention.';
  else if (run?.status === 'failed') caption = 'Planning stopped. Review the agent’s status.';
  else if (design || styling) caption = 'Table styled. Waiting for the readiness review.';
  else if (catering) caption = 'Places set. The menu is a proposal.';
  else if (lead) caption = 'Invitations drafted. Catering is next.';
  return {
    planning: started('lead') || !!lead,
    invitationReady: !!lead,
    placeCount: placing ? record.brief.guestCount : Math.min(record.brief.guestCount, catering?.mealCount || 0),
    decorated: styling || !!design,
    reviewing: started('evaluation') || !!evaluation,
    catering, design, evaluation, caption,
  };
}
