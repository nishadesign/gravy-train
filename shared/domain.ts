import catalog from '../data/caterers.json';
import { type Vendor, type Quote, type EventRecord, type AgentId, type Check, type EvaluationOutput, type Issue, leadSchema, cateringSchema, designSchema, reviewSchema } from './types';
export const vendors: Vendor[] = catalog;
export const money = (v: number) => Math.round(v * 100) / 100;
export function calculateQuote(vendorId: string, mealCount: number): Quote {
  const v = vendors.find(v => v.id === vendorId);
  if (!v) throw new Error('Unknown fictional caterer. Search the catalog first.');
  if (!Number.isInteger(mealCount) || mealCount < 0 || mealCount > 100) throw new Error('Meal count must be an integer between 0 and 100.');
  const food = money(mealCount * v.perPerson), service = money(food * v.serviceRate);
  const tax = money((food + service + v.deliveryFee + v.staffingFee + v.equipmentFee) * v.taxRate);
  const items = [{ name: `${mealCount} ready-to-serve meals`, amount: food }, { name: 'Delivery', amount: v.deliveryFee }, { name: 'Service fee', amount: service }, { name: 'Buffet attendant & cleanup', amount: v.staffingFee }, { name: 'Serving equipment', amount: v.equipmentFee }, { name: 'Estimated tax', amount: tax }, { name: 'Simple decor & paper invitations', amount: 35 }, { name: 'Music & activities (host playlist)', amount: 0 }, { name: 'Contingency', amount: 20 }];
  return { items, total: money(items.reduce((sum, x) => sum + x.amount, 0)), currency: 'USD', source: 'Fictional catalog estimate; not a vendor quote. Tax is a demo assumption.' };
}
export function markStale(record: EventRecord, ids: AgentId[]) { for (const id of ids) { const output = record.outputs[id]; if (output) output.stale = true; } }
export function validatePlan(record: EventRecord): Check[] {
  const { brief: b, outputs: o } = record, c = o.catering?.data, d = o.design?.data, l = o.lead?.data;
  const attending = record.guests.filter(g => g.rsvp !== 'declined');
  const v = vendors.find(v => v.id === c?.vendorId);
  const checks: Check[] = [];
  const add = (id: string, label: string, passed: boolean, evidence: string, responsible: AgentId, correction: string, hostInput = false) => checks.push({ id, label, passed, evidence, responsible, correction, hostInput });
  const stale = (['lead', 'catering', 'design'] as AgentId[]).filter(id => !o[id] || o[id]?.stale || o[id]?.version !== record.version);
  add('freshness', 'All outputs match the current brief', stale.length === 0, stale.length ? `Outdated or missing: ${stale.join(', ')}. Current brief v${record.version}.` : `All planning outputs use brief v${record.version}.`, stale[0] || 'lead', 'Refresh each affected output before accepting this plan.');
  add('roster', 'Guest requirements agree with the roster', attending.length === b.guestCount && attending.filter(g => g.vegetarian).length === b.vegetarianCount && attending.filter(g => g.nutAllergy).length === b.nutAllergyCount, `${attending.length} attending; ${attending.filter(g => g.vegetarian).length} vegetarian; ${attending.filter(g => g.nutAllergy).length} nut allergy.`, 'lead', 'Reconcile the structured guest counts and individual guest requirements.', true);
  const expectedQuote = c && v ? calculateQuote(v.id, c.mealCount) : undefined;
  const sum = c ? money(c.quote.items.reduce((s, i) => s + i.amount, 0)) : 0;
  const quoteMatches = !!c && !!expectedQuote && c.quote.total === expectedQuote.total && sum === expectedQuote.total && JSON.stringify(c.quote.items) === JSON.stringify(expectedQuote.items);
  add('budget', 'Every expense fits the total budget', quoteMatches && sum <= b.budget, c ? `$${sum.toFixed(2)} including all fees and event expenses / $${b.budget.toFixed(2)} budget.` : 'No itemized catering proposal yet.', 'catering', 'Select a suitable catalog vendor that fits after all fees; otherwise ask the host to change the budget.');
  const menuValid = !!c && !!v && c.menu.every(item => v.menu.some(m => m.dish === item.dish)) && v.menu.every(m => { const item = c.menu.find(i => i.dish === m.dish); const qty = m.dietary === 'Standard entrée' ? c.mealCount - c.vegetarianMeals : m.dietary.includes('entrée') ? c.vegetarianMeals : c.mealCount; return qty === 0 || (item && item.quantity >= qty); });
  add('meals', 'Enough complete meals for every guest', !!c && c.mealCount >= attending.length && c.mealCount >= (v?.minimumGuests ?? 0) && c.vegetarianMeals <= c.mealCount && menuValid, `${c?.mealCount ?? 0} complete meals for ${attending.length} guests; catalog menu portions ${menuValid ? 'verified' : 'missing or inconsistent'}.`, 'catering', 'Update the complete meal count and each catalog menu quantity for the current roster.');
  add('vegetarian', 'Vegetarian meals have supporting information', !!c && c.vegetarianMeals >= b.vegetarianCount && (b.vegetarianCount === 0 || !!v?.vegetarian), `${c?.vegetarianMeals ?? 0} vegetarian meals required for ${b.vegetarianCount} guests. ${v?.vegetarian || 'No supporting catalog information.'}`, 'catering', 'Choose documented vegetarian entrées and provide enough portions.', !v?.vegetarian && b.vegetarianCount > 0);
  add('dietary', 'Nut allergy procedures are documented', b.nutAllergyCount === 0 || !!v?.nutAllergy, b.nutAllergyCount ? (v?.nutAllergy || 'No ingredient and cross-contact information for the requested nut allergy. This remains unresolved.') : 'No nut allergy accommodation requested.', 'catering', 'Obtain supporting ingredient and cross-contact information, or select an option with documented procedures. Never invent confirmation.', b.nutAllergyCount > 0 && !v?.nutAllergy);
  const seats = d?.seats ?? [], ids = seats.map(s => s.guestId), numbers = seats.map(s => s.seat);
  add('seats', 'Every guest has exactly one assigned seat', seats.length === attending.length && new Set(ids).size === attending.length && new Set(numbers).size === seats.length && attending.every(g => ids.includes(g.id)), `${seats.length} assignments / ${attending.length} guests; ${new Set(numbers).size} unique seats.`, 'design', 'Assign one unique seat to each attending guest and remove obsolete assignments.');
  add('capacity', 'Seating fits the host’s table', attending.length <= b.capacity && numbers.every(n => n <= b.capacity), `${attending.length} guests / ${b.capacity} host-provided seats.`, 'design', 'Ask the host for additional seating or a smaller guest list. Do not invent additional furniture.', true);
  add('accessibility', 'Guests needing aisle access are accommodated', !!d && attending.filter(g => g.accessibility).every(g => seats.some(s => s.guestId === g.id && s.accessible && (s.seat === 1 || s.seat === b.capacity))), `${attending.filter(g => g.accessibility).length} guest needs an end seat (1 or ${b.capacity}) and clear buffet access.`, 'design', 'Use an accessible end seat and preserve a 36-inch clear aisle; include seated buffet assistance.');
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const timeline = l?.timeline ?? [], setup = timeline.find(t => t.kind === 'setup'), dinner = timeline.find(t => t.kind === 'dinner'), delivery = timeline.find(t => t.kind === 'delivery'), cleanup = timeline.find(t => t.kind === 'cleanup');
  const timing = !!c && !!setup && !!dinner && !!delivery && !!cleanup && c.setupMinutes >= (v?.setupMinutes ?? 30) && mins(c.deliveryTime) + c.setupMinutes <= mins(b.dinnerTime) && dinner.start === b.dinnerTime && delivery.start === c.deliveryTime && mins(setup.start) >= mins(delivery.end) && mins(setup.end) <= mins(dinner.start) && mins(setup.end) - mins(setup.start) >= c.setupMinutes && mins(cleanup.start) >= mins(dinner.end) && timeline.every(t => mins(t.end) >= mins(t.start));
  add('timing', 'Delivery, setup and dinner timing agree', timing, `Delivery ${c?.deliveryTime || 'unset'}; setup ${c?.setupMinutes ?? '?'} min; dinner ${b.dinnerTime}. Timeline and vendor setup minimum checked.`, 'lead', 'Align delivery and setup with the caterer; finish setup before dinner and schedule cleanup after dinner.');
  add('ready_to_serve', 'All food arrives ready to serve', v?.readyToServe === true, v ? `${v.name}: ${v.readyToServe ? 'hot, ready-to-serve delivery; attendant handles service and cleanup' : 'requires home reheating or finishing — unacceptable'}.` : 'No caterer selected.', 'catering', 'Reject meal kits and anything requiring host cooking, reheating or finishing.');
  add('deadline', 'Attendance changes are within the catering deadline', !b.changeAfterDeadline, b.changeAfterDeadline ? `The simulated RSVP change is after the ${v?.deadlineHours || 48}-hour deadline. Updated quantities are a proposal only; vendor acceptance remains unresolved.` : `Changes are before the fictional ${v?.deadlineHours || 48}-hour cutoff. Availability and booking still need real confirmation.`, 'catering', 'Ask the host to obtain vendor acceptance of the late change; do not mark a simulated response as real confirmation.', true);
  return checks;
}
export function evaluation(record: EventRecord, review: { summary: string; issues: Issue[] }, mode: 'live' | 'preview', gates: string[]): EvaluationOutput {
  const allChecks = validatePlan(record);
  for (const gate of gates) if (!allChecks.some(c => c.id === gate)) throw new Error(`Unknown required gate: ${gate}`);
  // Configuration may add gates, but cannot remove mandatory safety constraints.
  const checks = allChecks;
  const issues = [...checks.filter(c => !c.passed).map(c => ({ id: c.id, title: c.label, evidence: c.evidence, responsible: c.responsible, correction: c.correction, hostInput: c.hostInput })), ...review.issues];
  return { status: issues.some(i => i.hostInput) ? 'NEEDS_HOST_INPUT' : issues.length ? 'NEEDS_REVISION' : 'PASS', checks, issues, summary: review.summary, reviewedVersion: record.version, reviewKind: mode === 'live' ? 'Gemini review' : 'Local preview' };
}
export const outputSchemas = { lead: leadSchema, catering: cateringSchema, design: designSchema, evaluation: reviewSchema };
