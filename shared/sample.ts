import type { Brief, Guest, EventRecord } from './types';
export const sampleDescription = 'Plan a cozy autumn Thanksgiving dinner for 12 guests with a $900 total budget. All food must arrive ready to serve, with buffet service at 5:30 PM. Two guests are vegetarian and one has a nut allergy. We have table capacity for 14. Include invitations, seating, simple decor, and relaxed entertainment.';
export const sampleBrief: Brief = { description: sampleDescription, guestCount: 12, budget: 900, capacity: 14, vegetarianCount: 2, nutAllergyCount: 1, atmosphere: 'Cozy autumn', serviceStyle: 'buffet', dinnerTime: '17:30', eventDate: '2026-11-26', changeAfterDeadline: false };
const names = ['Alex', 'Jordan', 'Sam', 'Priya', 'Taylor', 'Morgan', 'Jamie', 'Casey', 'Riley', 'Avery', 'Cameron', 'Quinn', 'Rowan', 'Emery'];
export function makeGuests(brief: Brief): Guest[] {
  return Array.from({ length: brief.guestCount }, (_, i) => ({ id: `guest-${i + 1}`, name: names[i] || `Guest ${i + 1}`, rsvp: 'confirmed', vegetarian: i < brief.vegetarianCount, nutAllergy: i >= brief.guestCount - brief.nutAllergyCount, accessibility: i === 4 ? 'Step-free aisle access' : '' }));
}
export function newRecord(brief: Brief = sampleBrief): EventRecord { return { id: 'thanksgiving', version: 1, revision: 1, brief: structuredClone(brief), guests: makeGuests(brief), outputs: {}, simulations: [] }; }
export function clockLabel(time: string) { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; }
export function timeOffset(time: string, delta: number) { const [h, m] = time.split(':').map(Number); const t = Math.max(0, Math.min(1439, h * 60 + m + delta)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
