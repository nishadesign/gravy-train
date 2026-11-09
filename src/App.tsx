import { useEffect, useRef, useState } from 'react';
import { Accessibility, Check, CircleHelp, Leaf, LoaderCircle, Play, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { agentIds, type AgentId, type EventRecord, type Run, type Brief } from '../shared/types';
import { newRecord, sampleBrief, clockLabel } from '../shared/sample';
import { api } from './api';
import { deriveAgentStatuses } from './agentStatus';
import { deriveTableState, type PendingRun } from './tableState';
import { previewSpeeds, type PreviewSpeed } from '../shared/pacing';
import TableScene from './components/TableScene';
import { agentNames } from './components/AgentIcon';
import { OutputView, Readiness } from './components/Outputs';

export default function App() {
  const [record, setRecord] = useState<EventRecord>(newRecord());
  const [brief, setBrief] = useState<Brief>(sampleBrief);
  const [run, setRun] = useState<Run | null>(null);
  const [speed, setSpeed] = useState<PreviewSpeed>('slow');
  const [busy, setBusy] = useState(false);
  const [pendingRun, setPendingRun] = useState<PendingRun>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AgentId | 'brief' | 'about' | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dialog = useRef<HTMLDialogElement>(null), pollToken = useRef(0);
  const statuses = deriveAgentStatuses(record, run, busy);
  const table = deriveTableState(record, run, pendingRun);
  const activeId = agentIds.find(id => statuses[id].tone === 'working');
  const hasPlan = agentIds.some(id => record.outputs[id]);
  const date = new Date(`${record.brief.eventDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const runLabel = busy ? activeId ? `${agentNames[activeId]} is working` : !run ? 'Starting your run…' : run.events.at(-1)?.type === 'handoff' ? 'Handing off to the next agent…' : agentIds.every(id => ['done', 'attention'].includes(statuses[id].tone)) ? 'Finalizing your plan…' : 'Task complete · next agent up' : run?.status === 'failed' ? 'Run stopped' : run?.status === 'complete' ? 'Run finished' : hasPlan ? 'Your latest plan' : 'Ready to plan';

  useEffect(() => {
    let cancelled = false;
    void api('/state').then(s => {
      if (cancelled) return;
      setRecord(s.record); setBrief(s.record.brief); setBusy(s.busy);
      const running = s.runs?.find((r: Run) => r.status === 'running');
      if (running) void connect(running.id);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; pollToken.current++; };
  }, []);
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', reduced); }, [reduced]);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    else if (!selected) dialog.current?.close();
  }, [selected]);

  async function connect(id: string) {
    const token = ++pollToken.current;
    try {
      while (token === pollToken.current) {
        const current = await api<Run>('/runs/' + id);
        if (token !== pollToken.current) return;
        setRun(current); setPendingRun(null);
        if (current.previewSpeed) setSpeed(current.previewSpeed);
        const snapshot = current.final || current.events.filter(e => e.record).at(-1)?.record;
        if (snapshot) { setRecord(snapshot); setBrief(snapshot.brief); }
        if (current.status !== 'running') {
          setBusy(false);
          if (current.status === 'failed') setError(current.events.filter(e => e.type === 'error').at(-1)?.title || 'Planning did not finish. Please try again.');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 180));
      }
    } catch (e) { if (token === pollToken.current) { setBusy(false); setPendingRun(null); setError((e as Error).message); } }
  }
  async function start(late = false) {
    setError(''); setBusy(true); setRun(null); setPendingRun(late ? 'revision' : 'plan');
    try { const result = await api('/run', 'POST', { mode: 'preview', previewSpeed: speed, late, afterDeadline: false }); void connect(result.id); }
    catch (e) { setError((e as Error).message); setBusy(false); setPendingRun(null); }
  }
  async function sample() {
    setError('');
    try { const result = await api('/event', 'POST', { brief: sampleBrief }); setRecord(result); setBrief(result.brief); setRun(null); }
    catch (e) { setError((e as Error).message); }
  }
  async function saveBrief(e: React.FormEvent) {
    e.preventDefault(); setError('');
    try { const result = await api('/event', 'POST', { brief }); setRecord(result); setRun(null); setSelected(null); }
    catch (e) { setError((e as Error).message); }
  }

  return <div className="app-shell" style={{ '--agent-move-duration': `${previewSpeeds[speed].movementMs}ms` } as React.CSSProperties}>
    <header className="app-header">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setSelected(null); }}><img src={`${import.meta.env.BASE_URL}gravy-train.svg`} alt=""/>Gravy Train</a>
      <span className="current-page">The gathering</span>
      <div className="header-actions">
        <span className="demo-label"><span className="tiny-dot"/> Local sample</span>
        <button className="icon-button" onClick={() => setReduced(!reduced)} aria-label="Reduce motion" aria-pressed={reduced} title={reduced ? 'Reduced motion is on' : 'Reduce motion'}><Accessibility size={18}/></button>
        <button className="icon-button" onClick={() => setSelected('about')} aria-label="About Gravy Train"><CircleHelp size={18}/></button>
      </div>
    </header>
    <main className="gathering-page">
      <div className="page-heading">
        <div><h1>Thanksgiving dinner</h1><p className="event-summary">{date}<span>·</span>{record.brief.guestCount} guests<span>·</span>${record.brief.budget.toLocaleString()} budget<span>·</span>{clockLabel(record.brief.dinnerTime)}</p></div>
        <div className="planning-actions">
          <button className="button secondary" disabled={busy} onClick={() => { setBrief(record.brief); setSelected('brief'); }}><Settings2 size={15}/>Edit event</button>
          <button className="button primary" disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Play size={15}/>} {busy ? 'Planning…' : hasPlan ? 'Run again' : 'Plan dinner'}</button>
        </div>
      </div>
      {error && <div className="notice warning" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
      <section className="table-workspace" aria-label="Dinner planning workspace">
        <div className="run-heading">
          <div><span className={`run-dot ${busy ? 'running' : ''}`}/><strong>{runLabel}</strong><span className="run-context">{run ? `Brief v${record.version}` : 'Select any agent to see its work'}</span></div>
          <div className="run-controls">
            {!busy && <Readiness record={record}/>}
            <label className="speed-control"><span>Speed</span><select aria-label="Planning speed" value={speed} disabled={busy} onChange={e => setSpeed(e.target.value as PreviewSpeed)}>{Object.entries(previewSpeeds).map(([value, pace]) => <option key={value} value={value}>{pace.label}</option>)}</select></label>
          </div>
        </div>
        <span className="sr-only" role="status">{activeId ? `${agentNames[activeId]}: ${statuses[activeId].task}` : runLabel}</span>
        <TableScene record={record} statuses={statuses} table={table} onOpen={setSelected}/>
        <div className="table-summary"><span><Leaf size={13}/>{record.brief.vegetarianCount} vegetarian · {record.brief.nutAllergyCount} nut allergy · {record.brief.capacity} seats available</span><span className="table-action-caption">{table.caption}</span></div>
      </section>
      <div className="below-table">
        <p>Sample planning only. No invitations sent or caterer booked.</p>
        <div><button className="text-button" disabled={busy} onClick={() => void sample()}><RotateCcw size={13}/>Reset sample</button><button className="button secondary small" disabled={busy || record.brief.guestCount !== 12 || !record.outputs.design || !record.outputs.catering || record.outputs.design.stale || record.outputs.catering.stale} onClick={() => void start(true)}><Plus size={14}/>Add two late RSVPs</button></div>
      </div>
    </main>
    <dialog ref={dialog} onCancel={() => setSelected(null)} onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}><div className="dialog-shell"><button className="dialog-close icon-button" aria-label="Close details" onClick={() => setSelected(null)}><X size={21}/></button>{selected && agentIds.includes(selected as AgentId) && <OutputView id={selected as AgentId} record={record}/>} {selected === 'about' && <div className="about-dialog"><img src={`${import.meta.env.BASE_URL}gravy-train.svg`} alt=""/><h2>A little help hosting.</h2><p>Gravy Train is an interactive college capstone prototype. Four local planning helpers turn your event details into a catered menu, invitations, table styling, seating and readiness checks.</p><p>This version uses clearly labeled sample outputs and fictional caterers. It needs no API key. No guests are contacted and no food is booked.</p><p>Select any agent’s status card to explore its full output. Use “Add two late RSVPs” after planning for 12 to see the meal quantities, costs and seats update for 14.</p></div>}{selected === 'brief' && <form className="brief-form" onSubmit={saveBrief}><span className="eyebrow">MAKE IT YOUR GATHERING</span><h2>The evening you have in mind.</h2><p>Use these details to tailor the local sample plan.</p><label>Your event notes<textarea value={brief.description} onChange={e => setBrief({ ...brief, description: e.target.value })} rows={4} minLength={10} required/></label><p className="field-help">Local preview uses the structured details below. Free-text notes are saved for reference.</p><div className="form-grid">{([{ key: 'guestCount', label: 'Guests', min: 1, max: 40 }, { key: 'budget', label: 'Total budget ($)', min: 1, max: 100000 }, { key: 'capacity', label: 'Seats available', min: 1, max: 40 }, { key: 'vegetarianCount', label: 'Vegetarian guests', min: 0, max: 40 }, { key: 'nutAllergyCount', label: 'Guests with nut allergy', min: 0, max: 40 }] as const).map(f => <label key={f.key}>{f.label}<input type="number" min={f.min} max={f.max} required value={brief[f.key]} onChange={e => setBrief({ ...brief, [f.key]: Number(e.target.value) })}/></label>)}<label>Dinner time<input type="time" value={brief.dinnerTime} required onChange={e => setBrief({ ...brief, dinnerTime: e.target.value })}/></label><label>Date<input type="date" value={brief.eventDate} required onChange={e => setBrief({ ...brief, eventDate: e.target.value })}/></label><label>Atmosphere<input value={brief.atmosphere} required onChange={e => setBrief({ ...brief, atmosphere: e.target.value })}/></label></div><button className="button primary" type="submit">Save event details <Check size={16}/></button></form>}</div></dialog>
  </div>;
}
