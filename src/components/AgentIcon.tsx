import { ClipboardList, Utensils, Flower2, ShieldCheck } from 'lucide-react';
import type { AgentId } from '../../shared/types';
export const agentColors: Record<AgentId, string> = { lead: '#776393', catering: '#bb7d38', design: '#6a8465', evaluation: '#5d8294' };
export const agentNames: Record<AgentId, string> = { lead: 'Lead planner', catering: 'Catering & logistics', design: 'Design & experience', evaluation: 'Evaluation & readiness' };
export function AgentIcon({ id, size = 20 }: { id: AgentId; size?: number }) { const Icon = { lead: ClipboardList, catering: Utensils, design: Flower2, evaluation: ShieldCheck }[id]; return <Icon size={size} strokeWidth={1.6} />; }
