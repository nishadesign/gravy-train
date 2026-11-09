import type { PreviewSpeed } from './pacing';
import { z } from 'zod';

export const agentIds = ['lead', 'catering', 'design', 'evaluation'] as const;
export type AgentId = typeof agentIds[number];
export type AgentState = 'queued' | 'working' | 'using tool' | 'reviewing' | 'complete' | 'needs attention';
export const briefSchema = z.object({
  description: z.string().min(10).max(4000), guestCount: z.number().int().min(1).max(40),
  budget: z.number().min(1).max(100000), capacity: z.number().int().min(1).max(40),
  vegetarianCount: z.number().int().min(0).max(40), nutAllergyCount: z.number().int().min(0).max(40),
  atmosphere: z.string().min(1).max(200), serviceStyle: z.enum(['buffet', 'staffed buffet']),
  dinnerTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  changeAfterDeadline: z.boolean().default(false),
});
export type Brief = z.infer<typeof briefSchema>;
export interface Guest { id: string; name: string; rsvp: 'confirmed' | 'pending' | 'declined'; vegetarian: boolean; nutAllergy: boolean; accessibility: string; }
export const timelineSchema = z.array(z.object({ kind: z.enum(['delivery', 'setup', 'guests', 'dinner', 'entertainment', 'cleanup']), label: z.string(), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), owner: z.string() })).min(4);
export const leadSchema = z.object({
  eventBrief: z.string().min(10), requirements: z.array(z.string()).min(3), invitationDraft: z.string().min(20),
  taskAssignments: z.array(z.object({ agent: z.enum(agentIds), task: z.string() })).min(3),
  timeline: timelineSchema, summary: z.string().min(10),
});
export const cateringSchema = z.object({
  vendorId: z.string(), comparison: z.array(z.object({ vendorId: z.string(), reason: z.string() })).min(2),
  mealCount: z.number().int().min(0).max(100), vegetarianMeals: z.number().int().min(0).max(100),
  menu: z.array(z.object({ dish: z.string(), quantity: z.number().int().positive(), dietary: z.string() })).min(3),
  serviceChecklist: z.array(z.string()).min(4), vendorQuestions: z.array(z.string()),
  deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), setupMinutes: z.number().int().min(0),
  orderStatus: z.literal('proposed'),
});
export const designSchema = z.object({
  moodboard: z.object({ title: z.string(), colors: z.array(z.object({ name: z.string(), hex: z.string().regex(/^#[a-fA-F0-9]{6}$/) })).min(3).max(6), materials: z.array(z.string()).min(2) }),
  seats: z.array(z.object({ guestId: z.string(), seat: z.number().int().positive(), accessible: z.boolean() })),
  decorChecklist: z.array(z.string()).min(3), entertainment: z.array(z.object({ time: z.string(), activity: z.string() })).min(2),
  layoutNotes: z.string().min(10),
});
export const issueSchema = z.object({ id: z.string(), title: z.string(), evidence: z.string(), responsible: z.enum(agentIds), correction: z.string(), hostInput: z.boolean() });
export const reviewSchema = z.object({ summary: z.string().min(10), issues: z.array(issueSchema) });
export type Issue = z.infer<typeof issueSchema>;
export type LeadOutput = z.infer<typeof leadSchema> & { guestRoster: Guest[] };
export type CateringDraft = z.infer<typeof cateringSchema>;
export type CateringOutput = CateringDraft & { quote: Quote; vendorName: string; dietaryEvidence: string[]; source: string };
export type DesignOutput = z.infer<typeof designSchema>;
export interface Check { id: string; label: string; passed: boolean; evidence: string; responsible: AgentId; correction: string; hostInput: boolean; }
export interface EvaluationOutput { status: 'PASS' | 'NEEDS_REVISION' | 'NEEDS_HOST_INPUT'; checks: Check[]; issues: Issue[]; summary: string; reviewedVersion: number; reviewKind: 'Gemini review' | 'Local preview'; }
export interface Quote { items: { name: string; amount: number }[]; total: number; currency: 'USD'; source: string; }
export interface Vendor {
  id: string; name: string; tagline: string; perPerson: number; deliveryFee: number; serviceRate: number; taxRate: number;
  staffingFee: number; equipmentFee: number; minimumGuests: number; readyToServe: boolean; setupMinutes: number;
  vegetarian: string | null; nutAllergy: string | null; accessibility: string; menu: { dish: string; dietary: string }[];
  deadlineHours: number; serviceDetails: string[];
}
export interface Output<T> { version: number; stale: boolean; updatedAt: string; data: T; }
export interface EventRecord {
  id: string; version: number; revision: number; brief: Brief; guests: Guest[];
  outputs: { lead?: Output<LeadOutput>; catering?: Output<CateringOutput>; design?: Output<DesignOutput>; evaluation?: Output<EvaluationOutput> };
  simulations: { kind: string; note: string; timestamp: string }[];
}
export interface Activity {
  id: string; timestamp: string; type: 'run' | 'step' | 'tool' | 'output' | 'handoff' | 'revision' | 'error';
  title: string; agent?: AgentId; state?: AgentState; model?: string; input?: string; responsibility?: string;
  tool?: string; args?: unknown; result?: unknown; durationMs?: number; round?: number; record?: EventRecord;
}
export interface Run { id: string; mode: 'live' | 'preview'; previewSpeed?: PreviewSpeed; startedAt: string; finishedAt?: string; status: 'running' | 'complete' | 'failed'; events: Activity[]; initial: EventRecord; final?: EventRecord; }
export interface AgentConfig { id: AgentId; name: string; shortName: string; objective: string; skill: string; model: string; tools: string[]; settings: { temperature: number; maxOutputTokens: number }; }
export interface PublicConfig { agents: AgentConfig[]; tools: { name: string; purpose: string; inputs: string; outputs: string; dataSource: string; modifiesState: boolean }[]; workflow: { order: AgentId[]; consolidate: AgentId; correctionLimit: number; handoffs: Record<string, string>; invalidation: Record<AgentId, AgentId[]>; gates: string[] }; diagram: string; }
