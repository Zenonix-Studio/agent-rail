/**
 * Pure job progress helpers, free of Node built-ins so the Claude Code mod
 * (which has no Node) can import them too. `core/state.mjs` re-exports these.
 */

/**
 * @param {Pick<import('./state.mjs').Job, 'milestones'>} job A job without a `milestones` array counts as 0/0.
 * @returns {{done: number, total: number, pct: number|null}}
 */
export function progress(job) {
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const total = milestones.length;
  const done = milestones.filter((m) => m?.status === 'done').length;
  return { done, total, pct: total === 0 ? null : Math.round((100 * done) / total) };
}

/**
 * @param {Pick<import('./state.mjs').Session, 'agents'>|null|undefined} session
 * @param {number} seq A job's `seq`.
 * @returns {number} Subagents of that job still marked `running`.
 */
export function runningAgents(session, seq) {
  const agents = session?.agents && typeof session.agents === 'object' ? Object.values(session.agents) : [];
  return agents.filter((a) => a?.status === 'running' && a.job === seq).length;
}

/**
 * @param {Pick<import('./state.mjs').Session, 'agents'>|null|undefined} session
 * @param {number} seq A job's `seq`.
 * @returns {import('./state.mjs').Agent[]} Subagents that started in that job, in the order they were first seen.
 */
export function jobAgents(session, seq) {
  const agents = session?.agents && typeof session.agents === 'object' ? Object.values(session.agents) : [];
  return agents.filter((a) => a && typeof a === 'object' && a.job === seq);
}

/**
 * Rough time left: the average length of the finished steps times the steps still open,
 * less what the active step already took.
 * ponytail: naive average over all steps; weight by stage if estimates prove off.
 * @param {Pick<import('./state.mjs').Job, 'milestones'>} job
 * @param {number} [nowMs] current time, ms since epoch
 * @returns {number|null} milliseconds; null before any step finished or once all are done
 */
export function eta(job, nowMs = Date.now()) {
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const spans = milestones
    .filter((m) => m?.status === 'done' && m.startedAt && m.endedAt)
    .map((m) => Date.parse(m.endedAt) - Date.parse(m.startedAt))
    .filter((d) => Number.isFinite(d) && d > 0);
  const open = milestones.filter((m) => m?.status !== 'done');
  if (spans.length === 0 || open.length === 0) return null;
  const avg = spans.reduce((x, y) => x + y, 0) / spans.length;
  const active = open.find((m) => m.status === 'active');
  const spent = active?.startedAt ? Math.max(0, nowMs - Date.parse(active.startedAt)) : 0;
  return Math.max(0, Math.round(avg * open.length - Math.min(spent, avg)));
}

/**
 * @param {Pick<import('./state.mjs').Milestone, 'startedAt'|'endedAt'>} m
 * @param {number} [nowMs]
 * @returns {number|null} how long a step took (or has taken so far), ms; null before it started
 */
export function stepDuration(m, nowMs = Date.now()) {
  if (!m?.startedAt) return null;
  const d = (m.endedAt ? Date.parse(m.endedAt) : nowMs) - Date.parse(m.startedAt);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}
