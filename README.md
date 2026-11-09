# Gravy Train · Table visualization

The presentation UI is focused on the interactive Thanksgiving table. No Gemini setup, architecture screen or tool-call feed is needed. Click **Plan dinner** to run the local sample workflow, explore the four helpers’ outputs, then **Add two late RSVPs** to update the plan from 12 to 14 guests.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. All caterers and guest data are fictional. No invitations are sent or food booked. Local preview uses the structured event details; free-text notes are saved for reference.

```sh
npm run build
npm test
npm run eval
```

The existing backend includes the original ADK implementation and portable agent configuration for future use. The presentation UI always selects local preview and requires no credentials. Live evaluations are skipped without a key.


The gathering page shows one table with a status card above each agent: its current task, state, correction round when relevant, and saved result. Click a card to open the full output.

Planning starts at **Slow** presentation speed (about 30 seconds for the sample plan), with longer agent movements and time to read each result before the next handoff. The Speed selector also offers Normal and Quick. Speed applies to the local sample workflow; it does not turn sample outputs into live AI calls. Reduced motion still works independently.

The scene builds from a bare wooden table and host-provided chairs. Catering sets out plates, glasses and cutlery; its saved menu adds dishes to the sideboard. Design unfurls the runner and places foliage, pumpkins, candles and napkins; saved seating adds guest name cards. Evaluation draws its actual check results. Full reruns clear the scene, while late-RSVP corrections retain the existing setup and add the new places. The sequence respects reduced motion and does not display unsaved food, guest assignments or approval as finished work.
