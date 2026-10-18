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
