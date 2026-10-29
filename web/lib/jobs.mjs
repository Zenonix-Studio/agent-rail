import { loadLimits, loadSessions } from './sessions.mjs';

export function tokenSum(t) {
  if (!t || typeof t !== 'object') return 0;
  return ['input', 'output', 'cacheWrite'].reduce((n, k) => n + (Number(t[k]) || 0), 0);
}

const steps = (list) => (Array.isArray(list) ? list : []).map((m) => ({ title: m.title, status: m.status, stage: m.stage ?? null }));

/** Without a plan, the observed phases, the last one active until the job is done (the menubar's railMilestones). */
function railMilestones(job) {
  if (Array.isArray(job.milestones) && job.milestones.length) return steps(job.milestones);
  const phases = Array.isArray(job.phases) ? job.phases : [];
  return phases.map((p, i) => ({ title: p.title, status: i < phases.length - 1 || job.status === 'done' ? 'done' : 'active', stage: p.stage ?? null }));
}

export function summarize(session, job) {
  const milestones = Array.isArray(job.milestones) ? job.milestones : [];
  const done = milestones.filter((m) => m.status === 'done').length;
  const total = milestones.length;
  const pills = Array.isArray(job.now?.pills) ? job.now.pills : [];
  const agents = Object.values(session.agents ?? {}).filter((a) => a && a.job === job.seq)
    // Running first, then in start order, so rows do not jump around while the agents work.
    .sort((a, b) => (b.status === 'running') - (a.status === 'running') || time(a.startedAt) - time(b.startedAt))
    .map((a) => ({ id: a.id, name: a.name, status: a.status, activity: a.activity ?? '', updatedAt: a.updatedAt, tokens: tokenSum(a.tokens),
      milestones: steps(a.milestones), steps: (Array.isArray(a.steps) ? a.steps : []).slice(-6).map((p) => ({ label: p.label, kind: p.kind })) }));
  return {
    id: job.id, title: job.title || job.prompt || session.project, status: job.status, project: session.project, source: session.source ?? null,
    updatedAt: job.updatedAt, startedAt: job.startedAt, endedAt: job.endedAt ?? null, progress: job.progress ?? '',
    // Liveness inputs: only a session's last job is live, and a session gone quiet makes its card stale.
    latest: Array.isArray(session.jobs) && session.jobs.at(-1) === job, sessionUpdatedAt: session.updatedAt ?? job.updatedAt,
    toolInFlight: pills.at(-1)?.kind === 'active', warn: pills.findLast((p) => p.kind === 'warn')?.label ?? null,
    done, total, percent: total > 0 ? Math.round((done / total) * 100) : null,
    tokens: tokenSum(job.tokens) + agents.reduce((n, a) => n + a.tokens, 0), agents,
    milestones: railMilestones(job), proc: session.proc ?? null,
  };
}

function time(t) { const n = Date.parse(t); return Number.isNaN(n) ? 0 : n; }

export function allJobs(sessions = loadSessions()) {
  const byId = new Map();
  for (const s of sessions) {
    for (const j of s.jobs ?? []) {
      const prev = byId.get(j.id);
      if (!prev || time(j.updatedAt) > time(prev.job.updatedAt)) byId.set(j.id, { s, job: j });
    }
  }
  return [...byId.values()].map(({ s, job }) => summarize(s, job)).sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}

export function filterJobs(jobs, params) {
  const statuses = params.get('status') ? params.get('status').split(',').map((x) => x.trim()).filter(Boolean) : null;
  const project = params.get('project');
  const q = params.get('q') ? params.get('q').toLocaleLowerCase('tr') : null;
  return jobs.filter((j) => (!statuses || statuses.includes(j.status)) && (!project || j.project === project)
    && (!q || String(j.title ?? '').toLocaleLowerCase('tr').includes(q)));
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Tokens since the weekly limit reset, the same rules as agent-rail's core/stats.mjs: every job of any
 * status, timed by `endedAt ?? updatedAt`; without a future reset, the last 7 days.
 */
export function weekStats(jobs, limits, now = Date.now()) {
  const reset = time(limits?.sevenDay?.resetsAt);
  const fromReset = reset > now;
  const since = fromReset ? reset - 7 * DAY : now - 7 * DAY;
  const items = jobs.map((j) => ({ t: time(j.endedAt ?? j.updatedAt), tokens: j.tokens })).filter((i) => i.t >= since).sort((a, b) => b.t - a.t);
  const sum = (list) => list.reduce((n, i) => n + i.tokens, 0);
  return { fromReset, resetsAt: fromReset ? limits.sevenDay.resetsAt : null, percentUsed: limits?.sevenDay?.percentUsed ?? null,
    total: sum(items), jobs: items.length,
    days: [1, 3, 5].map((d) => ({ d, tokens: sum(items.filter((i) => i.t >= Math.max(since, now - d * DAY))) })),
    last: [3, 10, 25, 50].map((n) => ({ n, count: Math.min(n, items.length), tokens: sum(items.slice(0, n)) })) };
}

export function stats(sessions = loadSessions(), limits = loadLimits()) {
  const jobs = allJobs(sessions);
  const byProject = {};
  const byDay = {};
  for (const j of jobs) {
    const p = (byProject[j.project] ??= { jobs: 0, tokens: 0 });
    p.jobs++; p.tokens += j.tokens;
    const t = time(j.startedAt);
    if (t) { const d = new Date(t).toISOString().slice(0, 10); byDay[d] = (byDay[d] ?? 0) + 1; }
  }
  const agentsRunning = sessions.reduce((n, s) => n + Object.values(s.agents ?? {}).filter((a) => a?.status === 'running').length, 0);
  return { jobs: jobs.length, running: jobs.filter((j) => j.status === 'running').length, agentsRunning,
    tokens: jobs.reduce((n, j) => n + j.tokens, 0), byProject, byDay, week: weekStats(jobs, limits) };
}

export function findJob(id) {
  return allJobs().find((j) => j.id === id) ?? null;
}
