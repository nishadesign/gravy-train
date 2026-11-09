import { ArrowUpRight, Check, Clock3, LoaderCircle, AlertCircle } from 'lucide-react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { agentIds, type AgentId, type EventRecord, type Guest } from '../../shared/types';
import type { AgentStatus } from '../agentStatus';
import type { TableState } from '../tableState';
import { AgentIcon, agentColors, agentNames } from './AgentIcon';

const arrival = (index = 0, x = 0, y = 18): CSSProperties => ({
  '--arrival-delay': `${index * 50}ms`, '--arrival-x': `${x}px`, '--arrival-y': `${y}px`,
} as CSSProperties);

function Pumpkin({ x, y, s = 1, color = '#d79a58' }: { x: number; y: number; s?: number; color?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="3" rx="20" ry="17" fill={color}/>
    <ellipse cx="0" cy="3" rx="12" ry="17" fill="none" stroke="#a66f3c" strokeWidth="1.2" opacity=".45"/>
    <path d="M-1 -12 Q-6 -22 2 -21 L4 -14" stroke="#70815b" strokeWidth="4" fill="none"/>
    <path d="M6 -13 Q21 -22 22 -11 Q13 -9 6 -13" fill="#7d9165"/>
  </g>;
}
function Foliage({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
    <path d="M0 35 Q-4 0 4 -35" fill="none" stroke="#6d7d53" strokeWidth="2"/>
    {[-25, -10, 5, 20].map((yy, i) => <g key={yy}>
      <ellipse cx="-8" cy={yy} rx="6" ry="13" transform={`rotate(-45 -8 ${yy})`} fill={i % 2 ? '#9ba580' : '#798a60'}/>
      <ellipse cx="8" cy={yy + 5} rx="6" ry="12" transform={`rotate(42 8 ${yy + 5})`} fill={i % 2 ? '#889c72' : '#b0b491'}/>
    </g>)}
  </g>;
}
function Place({ x, y, rotation, index, guest, set, chair, decorated, scale = 1 }: {
  x: number; y: number; rotation: number; index: number; guest?: Guest; set: boolean; chair: boolean; decorated: boolean; scale?: number;
}) {
  return <g className="seat-position" style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
    {chair && <g transform={`rotate(${rotation})`}>
      <rect x="-20" y="-76" width="40" height="31" rx="9" fill="#c4ab90" stroke="#ae9277"/>
      <path d="M-14 -70 L14 -70" stroke="#e0cbb1" strokeWidth="3"/>
    </g>}
    {set && <g className="scene-place-arrival" style={arrival(index, (770 - x) * .55, (285 - y) * .45)} data-artifact="place-setting">
      <g transform={`rotate(${rotation})`}>
        <circle r="31" fill="#dcc8a1"/><circle r="25" fill="#fffaf1" stroke="#e5dcc9" strokeWidth="1.5"/><circle r="18" fill="none" stroke="#e9dfcc"/>
        <path d="M-39 -20 L-39 22 M-43 -20 L-43 -8 Q-39 -3 -35 -8 L-35 -20 M37 -20 L37 22 M37 -20 Q44 -6 37 -4" stroke="#a88a4c" fill="none" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="39" cy="-36" r="9" fill="#d8ae6b" fillOpacity=".35" stroke="#ba9a68"/><circle cx="39" cy="-36" r="5" fill="none" stroke="#f7eddb"/>
        {decorated && <g className="scene-decoration-arrival" style={arrival(index, -9, 14)} data-artifact="napkin">
          <path d="M-11 -13 L9 -10 L11 13 L-9 11 Z" fill={guest?.vegetarian ? '#97a484' : '#b7ae95'}/><path d="M-3 -12 L2 12" stroke="#ede4cd" strokeWidth="1.7"/>
        </g>}
      </g>
    </g>}
    {guest && <g transform={`translate(0 ${rotation === 180 ? 39 : rotation === 0 ? -42 : 43})`}>
      <g className="scene-decoration-arrival" style={arrival(index, -7, -15)} data-artifact="place-card">
        <rect x="-30" y="-8" width="60" height="18" rx="3" fill="#fffaf0" stroke="#d6c7af"/>
        <text textAnchor="middle" y="4" fontSize="10" fill="#4d5144" fontFamily="DM Sans, sans-serif">{guest.name}{guest.nutAllergy ? ' *' : ''}</text>
      </g>
    </g>}
  </g>;
}

export default function TableScene({ record, statuses, table, onOpen }: {
  record: EventRecord; statuses: Record<AgentId, AgentStatus>; table: TableState; onOpen: (id: AgentId) => void;
}) {
  const { catering, design, evaluation } = table;
  const visibleChecks = evaluation ? [...evaluation.checks].sort((a, b) => Number(a.passed) - Number(b.passed)).slice(0, 3) : [];
  const getGuest = (seat: number) => record.guests.find(g => g.id === design?.seats.find(s => s.seat === seat)?.guestId);
  const n = Math.min(14, Math.max(1, table.placeCount || record.brief.guestCount));
  const edgeCount = Math.ceil((n - 2) / 2);
  const places = [
    { x: 245, y: 275, rotation: -90 },
    ...Array.from({ length: Math.max(0, edgeCount) }, (_, i) => ({ x: 310 + i * (250 / Math.max(1, edgeCount - 1)), y: 200, rotation: 0 })),
    ...(n > 1 ? [{ x: 625, y: 275, rotation: 90 }] : []),
    ...Array.from({ length: Math.max(0, n - edgeCount - 2) }, (_, i) => ({ x: 560 - i * (250 / Math.max(1, edgeCount - 1)), y: 350, rotation: 180 })),
  ];
  const artifactProps = (id: AgentId, label: string) => ({
    role: 'button' as const, tabIndex: 0, 'aria-label': label, className: 'scene-artifact-button',
    onClick: () => onOpen(id), onKeyDown: (e: KeyboardEvent<SVGGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(id); } },
  });
  return <section className="scene-card" aria-label="Interactive Thanksgiving planning table">
    <div className="scene-wrap">
    <svg className="table-scene" viewBox="0 0 880 535" role="group" aria-label={`Thanksgiving planning scene. ${table.placeCount} places set. ${table.caption}`}>
      <defs>
        <pattern id="floor" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#b4a28b" strokeOpacity=".07"/></pattern>
        <pattern id="wood" width="85" height="24" patternUnits="userSpaceOnUse"><path d="M0 6Q35 1 85 6M0 19Q50 23 85 19" fill="none" stroke="#b29167" strokeOpacity=".16"/></pattern>
        <pattern id="linen" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0H5M0 0V5" stroke="#fff" strokeOpacity=".1"/></pattern>
        <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#796448" floodOpacity=".13"/></filter>
        <filter id="small-shadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#796448" floodOpacity=".16"/></filter>
      </defs>
      <rect width="880" height="535" fill="url(#floor)"/>
      <rect x="175" y="108" width="520" height="335" rx="150" fill="#e5dfcd" opacity=".32"/>
      <rect x="184" y="116" width="502" height="319" rx="145" fill="none" stroke="#cfc8b4" strokeDasharray="3 5" opacity=".5"/>
      <path d="M172 160 Q85 267 168 390 M710 162 Q802 270 714 401" fill="none" stroke="#d0c5b2" strokeDasharray="3 6"/>

      {/* Workstations begin empty. Their artifacts belong to the agent that creates them. */}
      <g transform="translate(73 236) rotate(-8)" filter="url(#small-shadow)">
        <rect width="77" height="74" rx="8" fill="#d8c9b6"/>
        {table.planning && <g className="scene-decoration-arrival" style={arrival()}>
          <rect x="10" y="8" width="43" height="53" rx="3" fill="#fff9ec"/><rect x="20" y="4" width="23" height="8" rx="3" fill="#a99ab9"/>
          <path d="M18 24H44M18 33H38M18 42H44M18 51H31" stroke="#b4a9c3" strokeWidth="2"/><rect x="60" y="12" width="4" height="43" rx="2" fill="#83718f"/>
        </g>}
        {table.invitationReady && <g {...artifactProps('lead', 'Open the invitation draft')}>
          <g className="scene-decoration-arrival" style={arrival(0, -20, -10)} data-artifact="invitation">
            <rect x="24" y="45" width="52" height="33" rx="3" fill="#fffaf0" stroke="#baacca"/><path d="M25 47L50 64L75 47" stroke="#baacca" fill="none"/>
            <circle cx="50" cy="63" r="4" fill="#a68bae"/>
          </g>
        </g>}
      </g>
      <g filter="url(#small-shadow)">
        <rect x="722" y="247" width="96" height="94" rx="10" fill="#c7aa85"/><rect x="729" y="253" width="82" height="80" rx="7" fill="#e4d2b6"/>
        {catering && <g {...artifactProps('catering', 'Open the proposed catered menu')}>
          {catering.menu.slice(0, 3).map((dish, i) => <g key={dish.dish} transform={`translate(${i === 2 ? 767 : 748 + i * 38} ${i === 2 ? 311 : 274})`}>
            <g className="scene-decoration-arrival" style={arrival(i, 30, -15)} data-artifact="catered-dish"><title>{`${dish.dish}: ${dish.quantity} portions, proposed`}</title>
              <ellipse rx="17" ry="12" fill="#fff9e9" stroke="#c6b290"/><ellipse rx="12" ry="8" fill={['#b57442', '#c49a50', '#7b9062'][i]}/>
              {[0, 1, 2].map(j => <circle key={j} cx={j * 6 - 6} cy={j % 2 ? 2 : -2} r="2" fill="#e6c583"/>)}
            </g>
          </g>)}
        </g>}
      </g>
      <text x="770" y="359" fontSize="10" textAnchor="middle" fill="#8c785f">{catering ? 'PROPOSED MENU' : 'CATERING SIDEBOARD'}</text>
      {table.decorated && <g transform="translate(78 409) rotate(-9)" filter="url(#small-shadow)" {...artifactProps('design', 'Open the table styling and seating')}>
        <g className="scene-decoration-arrival" style={arrival()} data-artifact="moodboard">
          <rect width="82" height="52" rx="5" fill="#f9f4e9"/>
          {(design?.moodboard.colors.map(c => c.hex) || ['#9ba684', '#dbac63', '#9d4c55', '#ddd0b8']).slice(0, 4).map((color, i) => <rect key={i} x={9 + i * 17} y="10" width="14" height="23" rx="2" fill={color}/>)}
          <path d="M10 41H48" stroke="#c6baa6" strokeWidth="2"/>
        </g>
      </g>}
      {table.reviewing && <g transform="translate(754 415) rotate(10)" filter="url(#small-shadow)" {...artifactProps('evaluation', 'Open the readiness review')}>
        <g className="scene-decoration-arrival" style={arrival()} data-artifact="readiness-checklist">
          <rect width="47" height="60" rx="4" fill="#f9f5ec" stroke="#d2c4b3"/><rect x="12" y="-3" width="23" height="9" rx="3" fill="#8da6ac"/>
          {['budget', 'meals', 'seats'].map((id, i) => {
            const y = 20 + i * 12, check = visibleChecks[i];
            return <g key={id}>{check && <title>{`${check.label}: ${check.passed ? 'passed' : 'needs attention'}`}</title>}<rect x="8" y={y - 4} width="7" height="7" rx="1" fill="none" stroke="#90a19a"/>
              {check && <path className="readiness-mark" style={arrival(i)} data-artifact={check.passed ? 'check-pass' : 'check-fail'} d={check.passed ? `M9 ${y}l2 2 4-5` : `M9 ${y - 3}l5 5m0-5-5 5`} stroke={check.passed ? '#698862' : '#b17c40'} strokeWidth="1.4" fill="none" pathLength="1"/>}
              <path d={`M21 ${y}H37`} stroke="#b8b1a3" strokeWidth="2"/>
            </g>;
          })}
        </g>
      </g>}

      {/* The table and host-provided chairs are the only starting furniture. */}
      <rect x="205" y="158" width="460" height="234" rx="91" fill="#b5956c" filter="url(#shadow)"/>
      <rect x="211" y="151" width="448" height="234" rx="88" fill="#d7b88f" stroke="#c8ad83" strokeWidth="1.5"/>
      <rect x="219" y="159" width="432" height="218" rx="80" fill="#e4c9a3" stroke="#ccb089"/>
      <rect x="219" y="159" width="432" height="218" rx="80" fill="url(#wood)"/>
      {table.decorated && <g className="scene-runner-arrival" data-artifact="table-runner">
        <path d="M278 233H594V306H278Z" fill={design?.moodboard.colors[0]?.hex || '#9ba684'} opacity=".9"/>
        <path d="M278 233H594V306H278Z" fill="url(#linen)"/><path d="M280 239H592M280 300H592" stroke="#f3ead7" strokeDasharray="2 3" opacity=".65"/>
      </g>}
      {places.map((p, i) => <Place key={i} {...p} index={i} scale={n > 12 ? .8 : 1} guest={getGuest(i + 1)} set={i < table.placeCount} chair={i < record.brief.capacity} decorated={table.decorated && (statuses.design.tone === 'working' || !!getGuest(i + 1))}/>)}
      {table.decorated && <g filter="url(#small-shadow)" data-artifact="centerpiece">
        <g className="scene-decoration-arrival" style={arrival(1, -15, 20)}><Foliage x={369} y={270} rotate={80}/></g>
        <g className="scene-decoration-arrival" style={arrival(2, -15, 20)}><Foliage x={503} y={272} rotate={-80}/></g>
        <g className="scene-decoration-arrival" style={arrival(3, -12, 22)}><Pumpkin x={433} y={271} s={1.2}/></g>
        <g className="scene-decoration-arrival" style={arrival(4, -12, 22)}><Pumpkin x={475} y={272} s={.65} color="#e9d6b2"/></g>
        <g className="scene-decoration-arrival" style={arrival(5, -12, 22)}><Pumpkin x={398} y={275} s={.58} color="#b68e56"/></g>
        {[332, 536].map((x, i) => <g key={x} className="scene-decoration-arrival" style={arrival(6 + i, -10, 20)} data-artifact="candle">
          <ellipse cx={x} cy="270" rx="12" ry="12" fill="#bfa06c"/><circle cx={x} cy="270" r="8" fill="#fff3ce"/>
          <ellipse className="candle-light" cx={x} cy="267" rx="2.5" ry="5" fill="#eab265"/>
        </g>)}
      </g>}
    </svg>
    {agentIds.map((id, i) => {
      const status = statuses[id], working = status.tone === 'working';
      const StatusIcon = working ? LoaderCircle : status.tone === 'done' ? Check : ['attention', 'outdated'].includes(status.tone) ? AlertCircle : Clock3;
      return <div key={id} className={`agent-station station-${id} ${working ? 'is-working' : 'is-inactive'}`} style={{ '--agent-color': agentColors[id] } as React.CSSProperties}>
        <button className={`agent-status-card tone-${status.tone}`} onClick={() => onOpen(id)} aria-label={`${agentNames[id]}: ${status.label}. ${status.task}. ${status.detail}. Open output.`}>
          <span className="status-card-heading"><strong>{agentNames[id]}</strong><ArrowUpRight size={14}/></span>
          <span className="status-card-badge"><StatusIcon size={12} className={working ? 'spin' : ''}/>{status.label}<span className="status-phase">{status.phase}</span></span>
          <span className="agent-task">{status.task}</span>
          <span className="agent-task-detail">{status.detail}</span>
        </button>
        <button className="scene-avatar" disabled={!working} onClick={() => onOpen(id)} aria-label={`${agentNames[id]}: ${working ? 'working — open output' : 'inactive'}`} title={working ? 'Agent is working' : 'Agent is inactive; select its status card to review the output'}><span className="agent-avatar"><AgentIcon id={id} size={23}/></span><span className="agent-number">{i + 1}</span></button>
      </div>;
    })}
    </div>
  </section>;
}
