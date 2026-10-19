// State contract of the agent-rail mod: what the session's timer writes and the
// Pane / AbovePrompt hooks draw from. Mirrors the Job JSDoc in core/state.mjs
// (see docs/state-schema.md). The session file also holds `_`-prefixed internal
// fields (e.g. a pill's `_run`) and may gain fields: readers ignore both.

export type RailStage = 'plan' | 'analyse' | 'dev' | 'fix' | 'review';
export type RailPill = { label: string; kind: 'ok' | 'warn' | 'active' | 'info'; stage?: RailStage };
export type RailMilestone = {
  key: string;
  title: string;
  status: 'pending' | 'active' | 'done';
  stage?: RailStage;
  startedAt?: string;
  endedAt?: string;
};
export type RailJob = {
  seq: number;
  title: string;
  summary?: string;
  /** The main agent's own 1-2 sentence summary of the work done and left; '' when none. */
  progress?: string;
  status: 'planning' | 'running' | 'waiting' | 'done' | 'error';
  milestones: RailMilestone[];
  startedAt: string;
  endedAt: string | null;
  now: { milestone: string; pills: RailPill[]; attempt: number; file: string | null; stage?: RailStage | null } | null;
};
/** `summary`, `milestones`, `steps`, `stage` and `progress` are absent in files written before they existed. */
export type RailAgent = {
  name: string;
  status: 'running' | 'done' | 'error' | 'stale';
  activity: string;
  updatedAt?: string;
  summary?: string;
  milestones?: RailMilestone[];
  steps?: RailPill[];
  stage?: RailStage | null;
  /** The agent's own 1-2 sentence summary; '' when none. */
  progress?: string;
};
/** The current job, the clock it was read at (ms since the epoch), and the subagents that started in it. */
export type RailView = { job: RailJob | null; at: number; agents: RailAgent[] };

declare module 'claude-code' {
  interface PluginState {
    'agent-rail': { view: RailView; isPaneShown: boolean; expandAll: boolean };
  }
}
