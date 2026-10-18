// State contract of the agent-rail mod: what the session's timer writes and the
// Pane / AbovePrompt hooks draw from. Mirrors the Job JSDoc in core/state.mjs.

export type RailPill = { label: string; kind: 'ok' | 'warn' | 'active' | 'info' };
export type RailMilestone = { key: string; title: string; status: 'pending' | 'active' | 'done' };
export type RailJob = {
  title: string;
  status: 'planning' | 'running' | 'waiting' | 'done' | 'error';
  milestones: RailMilestone[];
  startedAt: string;
  endedAt: string | null;
  now: { milestone: string; pills: RailPill[]; attempt: number; file: string | null } | null;
};
/** The current job and the clock it was read at (ms since the epoch). */
export type RailView = { job: RailJob | null; at: number };

declare module 'claude-code' {
  interface PluginState {
    'agent-rail': { view: RailView; isPaneShown: boolean };
  }
}
