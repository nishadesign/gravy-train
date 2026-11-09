import { agentIds, type AgentId, type EventRecord, type Run } from '../shared/types';

export type StatusTone = 'ready' | 'waiting' | 'working' | 'done' | 'attention' | 'outdated';
export interface AgentStatus {
  tone: StatusTone;
  label: string;
  task: string;
  detail: string;
  phase: string;
}
const responsibilities: Record<AgentId, string> = {
  lead: 'Guest list, invitations & timeline',
  catering: 'Catered menu, portions & total cost',
  design: 'Table styling, seating & activities',
  evaluation: 'Budget, dietary, seating & timing checks',
};

function plannedTask(id: AgentId, record: EventRecord) {
  const count = record.brief.guestCount;
  return { lead: `Organize ${count} guests`, catering: `Choose ${count} catered meals`, design: `Set ${count} places at the table`, evaluation: 'Check the whole dinner plan' }[id];
}
function finishedTask(id: AgentId, record: EventRecord): Pick<AgentStatus, 'task' | 'detail'> {
  const o = record.outputs;
  if (id === 'lead') return { task: `${record.brief.guestCount} guests coordinated`, detail: 'Invitation drafted · timeline ready' };
  if (id === 'catering' && o.catering) return { task: `${o.catering.data.mealCount} meals proposed`, detail: `$${o.catering.data.quote.total.toFixed(2)} total · ${o.catering.data.vegetarianMeals} vegetarian` };
  if (id === 'design' && o.design) return { task: `${o.design.data.seats.length} seats assigned`, detail: 'Moodboard, decor & activities ready' };
  if (id === 'evaluation' && o.evaluation) {
    const e = o.evaluation.data;
    return { task: e.status === 'PASS' ? 'Every required check passed' : `${e.issues.length} ${e.issues.length === 1 ? 'issue needs' : 'issues need'} attention`, detail: e.status === 'PASS' ? `${e.checks.length} checks · no vendor booked` : e.issues[0]?.title || 'Review the unresolved host decisions' };
  }
  return { task: plannedTask(id, record), detail: responsibilities[id] };
}

/** Current-run events take precedence over old outputs. Only a saved output is done. */
export function deriveAgentStatuses(record: EventRecord, run: Run | null, busy: boolean): Record<AgentId, AgentStatus> {
  // The workflow is sequential: a routing event must not leave the lead looking
  // active after another agent has picked up the correction.
  const currentEvent = run?.events.filter(e => e.agent && e.state && e.state !== 'queued').at(-1);
  return Object.fromEntries(agentIds.map(id => {
    const out = record.outputs[id];
    const events = run?.events.filter(e => e.agent === id) || [];
    const latest = events.filter(e => e.state).at(-1);
    const step = events.filter(e => e.type === 'step' && e.state !== 'queued').at(-1);
    const consolidating = id === 'lead' && !!step?.title.toLowerCase().includes('consolidate');
    const phase = consolidating ? 'Final summary' : step?.round ? `Correction ${step.round}` : run ? 'This run' : 'Your event';
    let status: AgentStatus = { tone: 'ready', label: 'Ready', task: plannedTask(id, record), detail: responsibilities[id], phase };

    if (busy && !run || latest?.state === 'queued') {
      status = { ...status, tone: 'waiting', label: run?.status === 'failed' ? 'Not run' : 'Waiting', detail: run?.status === 'failed' ? 'The run stopped before this task.' : responsibilities[id] };
    } else if (latest && ['working', 'using tool', 'reviewing'].includes(latest.state!)) {
      let task = { lead: 'Drafting invitations & timeline', catering: 'Choosing a catered menu', design: `Arranging ${record.brief.guestCount} seats`, evaluation: 'Checking every requirement' }[id];
      if (latest.tool === 'read_event') task = id === 'evaluation' ? 'Comparing the plan to the brief' : 'Reading the brief & guest list';
      if (latest.tool === 'search_caterers') task = 'Comparing catering options';
      if (latest.tool === 'calculate_costs') task = 'Adding meals, fees & expenses';
      if (latest.tool === 'validate_plan') task = id === 'design' ? 'Checking seating & access' : 'Checking budget, meals & seats';
      if (latest.tool === 'submit_output') task = { lead: 'Saving invitations & timeline', catering: 'Saving the menu & total cost', design: 'Saving seating & table styling', evaluation: 'Saving the readiness review' }[id];
      if (consolidating) task = 'Bringing the checked plan together';
      if (latest.type === 'handoff') task = 'Assigning the needed corrections';
      status = { ...status, tone: 'working', label: id === 'evaluation' ? 'Checking' : 'Working', task };
      if (run?.status === 'failed') status = { ...status, tone: 'attention', label: 'Stopped', detail: 'This task did not finish.' };
      else if (currentEvent?.agent !== id) status = { ...status, tone: 'waiting', label: 'Waiting', task: plannedTask(id, record), detail: id === 'lead' ? 'Corrections assigned; waiting for results.' : 'Waiting for the current agent to finish.' };
    } else if (latest?.type === 'error') {
      status = { ...status, tone: 'attention', label: 'Failed', task: 'This task could not finish', detail: latest.title };
    } else if (latest?.state === 'needs attention') {
      status = { ...status, tone: 'attention', label: 'Needs attention', ...finishedTask(id, record) };
    } else if (out && !out.stale && out.version === record.version) {
      status = { ...status, tone: id === 'evaluation' && record.outputs.evaluation?.data.status !== 'PASS' ? 'attention' : 'done', label: id === 'evaluation' && record.outputs.evaluation?.data.status !== 'PASS' ? 'Needs attention' : 'Done', ...finishedTask(id, record) };
    }
    // A previous completed result cannot approve newer requirements or upstream work.
    if (out && (out.stale || out.version !== record.version) && !['working', 'waiting'].includes(status.tone) && latest?.type !== 'error') {
      status = { ...status, tone: busy ? 'waiting' : 'outdated', label: busy ? 'Waiting' : 'Needs update', task: plannedTask(id, record), detail: busy ? 'Waiting for the corrected inputs.' : 'The event changed. Run the plan again.' };
    }
    return [id, status];
  })) as Record<AgentId, AgentStatus>;
}
