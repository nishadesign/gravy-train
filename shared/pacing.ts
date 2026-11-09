/** Presentation timing applies only to the explicitly labeled local sample. */
export const previewSpeeds = {
  slow: { label: 'Slow', movementMs: 1800, delays: { task: 900, tool: 900, complete: 1200, handoff: 1100 } },
  normal: { label: 'Normal', movementMs: 900, delays: { task: 250, tool: 350, complete: 450, handoff: 350 } },
  quick: { label: 'Quick', movementMs: 600, delays: { task: 0, tool: 180, complete: 0, handoff: 0 } },
} as const;
export type PreviewSpeed = keyof typeof previewSpeeds;
export type PresentationPhase = keyof typeof previewSpeeds.slow.delays;
