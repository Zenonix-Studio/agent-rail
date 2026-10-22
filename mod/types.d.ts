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
/** API token usage read from a transcript; a total counts all four. */
export type RailTokens = { input: number; cacheRead: number; cacheWrite: number; output: number };
export type RailJob = {
  seq: number;
  title: string;
  /** The first prompt of the job. */
  prompt?: string;
  summary?: string;
  /** The main agent's own 1-2 sentence summary of the work done and left; '' when none. */
  progress?: string;
  status: 'planning' | 'running' | 'waiting' | 'done' | 'error';
  milestones: RailMilestone[];
  startedAt: string;
  endedAt: string | null;
  now: { milestone: string; pills: RailPill[]; attempt: number; file: string | null; stage?: RailStage | null } | null;
  /** The main agent's usage during the job (Claude only); absent until seen. */
  tokens?: RailTokens;
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
  /** Absent until usage is seen. */
  tokens?: RailTokens;
};
/** A finished job of any session, for the pane's history page: newest first, ended in ms since the epoch. */
export type RailHistoryItem = { id: string; project: string; ended: number; job: RailJob; agents: RailAgent[] };
/** The pane's page: this session's job, the history list, or one history job (`picked`, its id). */
export type RailPage = { name: 'now' } | { name: 'history' } | { name: 'job'; picked: string };
/** The current job, the clock it was read at (ms since the epoch), and the subagents that started in it. */
export type RailView = { job: RailJob | null; at: number; agents: RailAgent[] };

declare module 'claude-code' {
  interface PluginState {
    'agent-rail': { view: RailView; isPaneShown: boolean; expandAll: boolean; page: RailPage; history: RailHistoryItem[] };
  }
}
