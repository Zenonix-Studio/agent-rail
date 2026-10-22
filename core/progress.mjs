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

/** Finished steps needed before a time-left estimate. */
const ETA_MIN_DONE = 2;

/**
 * Rough time left: each open step is estimated by the finished steps of its stage (else all
 * finished steps), less what the active step already took. Needs two finished steps.
 * ponytail: this job's steps only; history from earlier jobs if estimates stay off.
 * @param {Pick<import('./state.mjs').Job, 'milestones'>} job
 * @param {number} [nowMs] current time, ms since epoch
 * @returns {number|null} milliseconds; null before two steps finished or once all are done
 */
export function eta(job, nowMs = Date.now()) {
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const spans = milestones
    .filter((m) => m?.status === 'done' && m.startedAt && m.endedAt)
    .map((m) => ({ stage: m.stage ?? null, ms: Date.parse(m.endedAt) - Date.parse(m.startedAt) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms > 0);
  const open = milestones.filter((m) => m?.status !== 'done');
  // One finished step says too little: no estimate before two.
  if (spans.length < ETA_MIN_DONE || open.length === 0) return null;
  const mean = (xs) => xs.reduce((a, x) => a + x.ms, 0) / xs.length;
  const avg = mean(spans);
  /** @type {Record<string, number>} */
  const byStage = {};
  for (const st of new Set(spans.map((x) => x.stage).filter(Boolean))) byStage[st] = mean(spans.filter((x) => x.stage === st));
  // Each open step takes as long as finished steps of its stage, else the overall average.
  let left = 0;
  for (const m of open) {
    const est = (m.stage && byStage[m.stage]) || avg;
    const spent = m.status === 'active' && m.startedAt ? Math.max(0, nowMs - Date.parse(m.startedAt)) : 0;
    left += est - Math.min(spent, est);
  }
  return Math.max(0, Math.round(left));
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
