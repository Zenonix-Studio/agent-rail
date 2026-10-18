import { basename } from 'node:path';
import { extractMeta } from './flow.mjs';
import { SCHEMA_VERSION } from './state.mjs';
import { runningAgents } from './progress.mjs';

/** @typedef {import('./state.mjs').Session} Session */
/** @typedef {import('./state.mjs').Job} Job */
/** @typedef {import('./state.mjs').Agent} Agent */
/** @typedef {import('./state.mjs').Now} Now */
/** @typedef {import('./state.mjs').Pill} Pill */
/** @typedef {import('./normalize-claude.mjs').Event} Event */
/**
 * @typedef {{source:'claude'|'codex', sessionId:string, cwd:string, agentId:string|null, event:Event}} ReduceInput
 */

const SOURCES = new Set(['claude', 'codex']);
const JOB_STATUS = new Set(['planning', 'running', 'waiting', 'done', 'error']);
const MILESTONE_STATUS = new Set(['pending', 'active', 'done']);
const AGENT_STATUS = new Set(['running', 'done', 'error', 'stale']);
const PILL_KINDS = new Set(['ok', 'warn', 'active', 'info']);
const MAX_PILLS = 3;
const MAX_OPEN = 20; // open call ids kept for pre/post pairing
const TITLE_MAX = 48;
// R18: these labels count every repeat as a retry; others only after they failed.
const RETRY_LABELS = new Set(['Build', 'Test']);

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {string|null} */
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Folds one normalized event into the session state. Pure: the previous
 * session is never mutated, and malformed state or events never throw.
 * @param {Session|null} session Previous state, or null for a new session.
 * @param {ReduceInput} input
 * @param {Date} now
 * @returns {Session}
 */
export function reduce(session, input, now) {
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date(0).toISOString();
  const inp = isObj(input) ? input : {};
  let s;
  try {
    s = sanitize(session, inp, at);
  } catch {
    s = sanitize(null, inp, at);
  }
  try {
    apply(s, inp, at);
  } catch {
    // Best effort: keep whatever was applied to the copy.
  }
  return s;
}

/**
 * Title shown until the agent writes a `rail:` marker.
 * @param {string} prompt
 * @returns {string} First 48 characters of the prompt, whitespace collapsed.
 */
export function fallbackTitle(prompt) {
  const t = typeof prompt === 'string' ? prompt.replace(/\s+/g, ' ').trim() : '';
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

/** @param {Session} s @param {Record<string, any>} input @param {string} at */
function apply(s, input, at) {
  const e = input.event;
  if (!isObj(e)) return;
  const agentId = str(input.agentId);
  switch (e.type) {
    case 'prompt':
      if (!agentId) onPrompt(s, typeof e.text === 'string' ? e.text : '', at);
      break;
    case 'plan':
    case 'task-create':
    case 'task-update':
      // Only the main agent's plan drives milestones and %.
      if (agentId) agent(s, agentId, at).activity = 'Planning';
      else onMilestones(s, e, at);
      break;
    case 'tool':
      onTool(s, agentId, e, at);
      break;
    case 'agent-start':
      if (agentId) {
        const a = agent(s, agentId, at);
        a.name = str(e.name) ?? a.name;
        a.status = 'running';
        a.job = current(s)?.seq ?? null;
        a.endedAt = null;
      }
      break;
    case 'agent-stop':
      if (agentId) {
        const a = agent(s, agentId, at);
        a.status = e.ok === false ? 'error' : 'done';
        a.endedAt = at;
      }
      break;
    case 'waiting': {
      const job = current(s);
      // R19: once its turn ended, the main agent's idle notice adds nothing; a subagent's request still counts.
      if (job && job.status !== 'done' && !(job._mainStopped && !agentId)) {
        job.status = 'waiting';
        job.updatedAt = at;
      }
      break;
    }
    case 'stop':
      if (!agentId) finish(s, e.lastMessage, at, false);
      break;
    case 'session-end':
      if (!agentId) finish(s, null, at, true);
      break;
    default:
      break;
  }
}

/** Rule 1: start a job, reopen a done or paused one (pending split decision), or ignore. */
function onPrompt(s, text, at) {
  const job = current(s);
  if (!job) {
    s.jobs.push(newJob(s, 1, text, 'planning', at));
    return;
  }
  if (job.status === 'done' || job.status === 'waiting' || job._mainStopped) {
    // A paused job (R16, R19) already holds its stop time in _prevEndedAt.
    delete job._mainStopped;
    s._pendingPrompt = text;
    if (job.status === 'done') job._prevEndedAt = job.endedAt;
    job.status = 'running';
    job.endedAt = null;
    job.updatedAt = at;
  } else if (job.prompt === '' && text !== '') {
    // Job was opened implicitly by an earlier event; adopt its first prompt.
    if (job.title === fallbackTitle(job.prompt)) job.title = fallbackTitle(text);
    job.prompt = text;
    job.updatedAt = at;
  }
}

/** Rules 2 and 3: after a follow-up prompt, decide split vs continue (R15), then apply the change. */
function onMilestones(s, e, at) {
  let job = ensureJob(s, at);

  if (s._pendingPrompt !== null) {
    // R15: a Codex plan splits when disjoint; a Claude task-create splits only
    // once every milestone is done; a task-update on a known key continues.
    const decided = e.type !== 'task-update' || job.milestones.some((m) => m.key === e.key);
    if (decided) {
      const split = e.type === 'plan' ? isDisjoint(job, e) : e.type === 'task-create' && job.milestones.every((m) => m.status === 'done');
      if (split) {
        job.status = 'done';
        job.endedAt = job._prevEndedAt ?? at;
        delete job._prevEndedAt;
        job.updatedAt = at;
        job = newJob(s, job.seq + 1, s._pendingPrompt, 'running', at);
        s.jobs.push(job);
      } else {
        delete job._prevEndedAt;
      }
      s._pendingPrompt = null;
    }
  }

  // R3: a Codex plan explanation / the first Claude task description is a stand-in summary.
  const hint = e.type === 'plan' ? str(e.explanation) : e.type === 'task-create' && job.milestones.length === 0 ? str(e.description) : null;
  if (hint && job.summary === '') {
    job.summary = hint;
    job._summaryFromPlan = true;
  }

  const changed = changeMilestones(job, e);
  if (changed || e.type === 'plan') {
    // Done jobs are only reopened by a prompt; a stray late update must not.
    if (job.status !== 'done') job.status = 'running';
    job.updatedAt = at;
  }
  const key = activeKey(job);
  if (job.now && job.now.milestone !== key) job.now = emptyNow(key);
}

/**
 * R10: Codex plans are snapshots keyed by step title; a new plan sharing no key
 * with the current milestones is a new job.
 * @param {Job} job @param {Record<string, any>} e @returns {boolean}
 */
function isDisjoint(job, e) {
  const items = planItems(e);
  if (items.length === 0) return false;
  const keys = new Set(job.milestones.map((m) => m.key));
  return items.every((it) => !keys.has(it.key));
}

/** @param {Job} job @param {Record<string, any>} e @returns {boolean} true when milestones changed */
function changeMilestones(job, e) {
  if (e.type === 'plan') {
    job.milestones = planItems(e);
    return true;
  }
  const key = str(e.key);
  if (!key) return false;
  const i = job.milestones.findIndex((m) => m.key === key);
  if (e.type === 'task-create') {
    const title = str(e.title) ?? key;
    if (i >= 0) job.milestones[i].title = title;
    else job.milestones.push({ key, title, status: 'pending' });
    return true;
  }
  if (i < 0) return false;
  if (e.status === 'deleted') job.milestones.splice(i, 1);
  else if (MILESTONE_STATUS.has(e.status)) job.milestones[i].status = e.status;
  else return false;
  return true;
}

/** @param {Record<string, any>} e @returns {import('./state.mjs').Milestone[]} */
function planItems(e) {
  if (!Array.isArray(e.items)) return [];
  return e.items
    .filter((it) => isObj(it) && str(it.key))
    .map((it) => ({
      key: it.key,
      title: str(it.title) ?? it.key,
      status: MILESTONE_STATUS.has(it.status) ? it.status : 'pending',
    }));
}

/** Rules 4-6: main-agent tools feed the "now" pills; subagent tools feed agent activity. */
function onTool(s, agentId, e, at) {
  const label = str(e.label) ?? str(e.name) ?? 'tool';
  const file = str(e.file);

  if (agentId) {
    const a = agent(s, agentId, at);
    const base = file ? basename(file) : null;
    a.activity = base && !label.includes(base) ? `${label} · ${base}` : label;
    // M3: only the main agent's activity clears a permission 'waiting'. R19: after a
    // main-agent Stop, a working subagent of the job means the job still runs.
    const job = current(s);
    if (job && job.status === 'waiting' && job._mainStopped && a.job === job.seq) {
      job.status = 'running';
      job.updatedAt = at;
    }
    return;
  }

  const job = ensureJob(s, at);
  // R17: main-agent tool activity means the job runs, plan or not.
  if (job.status === 'waiting' || job.status === 'planning') job.status = 'running';
  const key = activeKey(job);
  if (!job.now || job.now.milestone !== key) job.now = emptyNow(key);
  const now = job.now;
  const counts = now._counts;
  const id = str(e.id);

  if (e.phase === 'pre') {
    now.pills.push(id ? { label, kind: 'active', _id: id } : { label, kind: 'active' });
    counts[label] = (counts[label] ?? 0) + 1;
    if (id) now._open = [...now._open, id].slice(-MAX_OPEN);
  } else {
    const kind = e.ok === true ? 'ok' : e.ok === false ? 'warn' : 'info';
    const pill = { label: e.ok === false ? `${label} failed` : label, kind };
    // Parallel calls: pair by call id first, else by the latest active pill with this label.
    const opened = id !== null && now._open.includes(id);
    if (opened) now._open = now._open.filter((x) => x !== id);
    let i = -1;
    for (let k = now.pills.length - 1; k >= 0; k--) {
      const p = now.pills[k];
      if (p.kind !== 'active') continue;
      if (id !== null ? p._id === id : p.label === label) { i = k; break; }
    }
    if (i >= 0) now.pills[i] = pill;
    else now.pills.push(pill);
    // A post whose pre was never seen still counts as one occurrence.
    if (i < 0 && !opened) counts[label] = (counts[label] ?? 0) + 1;
    // R18: a failure starts a retry count for labels that do not always count.
    if (e.ok === false && !RETRY_LABELS.has(label) && !(label in now._retryBase)) now._retryBase[label] = (counts[label] ?? 1) - 1;
  }
  now.pills = now.pills.slice(-MAX_PILLS);
  const n = counts[label] ?? 1;
  now.attempt = RETRY_LABELS.has(label) ? n : label in now._retryBase ? n - now._retryBase[label] : 1;
  if (file) now.file = file;
  job.updatedAt = at;
}

/**
 * Rules 7-8: close the current job and adopt the agent-written title/summary.
 * R16: a main-agent Stop with unfinished milestones only pauses the job
 * ('waiting' for the user); session end always finishes it.
 * R19: a main-agent Stop while subagents of the job still run keeps it
 * 'running': the main agent waits on them, and its next Stop decides.
 * @param {boolean} final true on session end
 */
function finish(s, lastMessage, at, final) {
  s._pendingPrompt = null;
  const job = current(s);
  if (job && job.status !== 'done') {
    const busy = !final && runningAgents(s, job.seq) > 0;
    if (busy || (!final && job.milestones.some((m) => m.status !== 'done'))) {
      job.status = busy ? 'running' : 'waiting';
      job._prevEndedAt = at; // where the job ends if a follow-up splits off a new one
      job._mainStopped = true;
    } else {
      job.status = 'done';
      job.endedAt = at;
      delete job._prevEndedAt;
      delete job._mainStopped;
    }
  }
  // I5: subagents still marked running when the job or session ends never reported back.
  if (final || job?.status === 'done') closeAgents(s, at);
  if (!job) return;
  const meta = extractMeta(lastMessage);
  if (meta) {
    if (job.title === fallbackTitle(job.prompt)) job.title = meta.title;
    // The agent's own marker wins over a plan-derived stand-in summary.
    if (job.summary === '' || job._summaryFromPlan) job.summary = meta.summary;
    delete job._summaryFromPlan;
  }
  job.updatedAt = at;
}

/** @param {Session} s @param {string} at */
function closeAgents(s, at) {
  for (const a of Object.values(s.agents)) {
    if (a.status !== 'running') continue;
    a.status = 'stale';
    a.endedAt = at;
    a.updatedAt = at;
  }
}

/** @param {Session} s @returns {Job|null} */
function current(s) {
  return s.jobs.length > 0 ? s.jobs[s.jobs.length - 1] : null;
}

/** Events can arrive before any prompt (hooks installed mid-session). */
function ensureJob(s, at) {
  const job = current(s);
  if (job) return job;
  const created = newJob(s, 1, '', 'planning', at);
  s.jobs.push(created);
  return created;
}

/** @returns {Job} */
function newJob(s, seq, prompt, status, at) {
  return {
    id: `${s.source}:${s.sessionId}:${seq}`,
    seq,
    title: fallbackTitle(prompt),
    summary: '',
    prompt,
    status,
    milestones: [],
    startedAt: at,
    updatedAt: at,
    endedAt: null,
    now: null,
  };
}

/** @returns {Agent} */
function agent(s, id, at) {
  if (!isObj(s.agents[id])) {
    s.agents[id] = { id, name: 'agent', status: 'running', activity: '', job: current(s)?.seq ?? null, updatedAt: at, endedAt: null };
  }
  s.agents[id].updatedAt = at;
  return s.agents[id];
}

/** @param {Job} job @returns {string} key of the active milestone, or '' */
function activeKey(job) {
  return job.milestones.find((m) => m.status === 'active')?.key ?? '';
}

/**
 * @param {string} milestone
 * @returns {Now} `_counts` tracks label occurrences for `attempt`; `_open` holds
 *   call ids whose pre was counted but whose post has not arrived yet;
 *   `_retryBase[label]` is the count before that label's first failure (R18).
 */
function emptyNow(milestone) {
  return { milestone, pills: [], attempt: 0, file: null, _counts: {}, _open: [], _retryBase: {} };
}

// --- Defensive copy of stored state -------------------------------------

/** @returns {Session} a fresh, well-formed copy; never shares objects with `prev`. */
function sanitize(prev, input, at) {
  const p = isObj(prev) ? structuredClone(prev) : {};
  const source = SOURCES.has(input.source) ? input.source : SOURCES.has(p.source) ? p.source : 'claude';
  const sessionId = str(input.sessionId) ?? str(p.sessionId) ?? '';
  const cwd = str(p.cwd) ?? str(input.cwd) ?? '';
  const agents = {};
  if (isObj(p.agents)) {
    for (const [id, a] of Object.entries(p.agents)) if (isObj(a)) agents[id] = fixAgent(id, a, at);
  }
  return {
    schema: SCHEMA_VERSION,
    source,
    sessionId,
    cwd,
    project: cwd ? basename(cwd) : '',
    updatedAt: at,
    jobs: Array.isArray(p.jobs) ? p.jobs.filter(isObj).map((j, i) => fixJob(j, i, source, sessionId, at)) : [],
    agents,
    _pendingPrompt: typeof p._pendingPrompt === 'string' ? p._pendingPrompt : null,
  };
}

function fixJob(j, i, source, sessionId, at) {
  const seq = Number.isInteger(j.seq) && j.seq > 0 ? j.seq : i + 1;
  const prompt = typeof j.prompt === 'string' ? j.prompt : '';
  const job = {
    ...j,
    id: str(j.id) ?? `${source}:${sessionId}:${seq}`,
    seq,
    title: typeof j.title === 'string' ? j.title : fallbackTitle(prompt),
    summary: typeof j.summary === 'string' ? j.summary : '',
    prompt,
    status: JOB_STATUS.has(j.status) ? j.status : 'running',
    milestones: Array.isArray(j.milestones)
      ? j.milestones
        .filter((m) => isObj(m) && str(m.key))
        .map((m) => ({
          key: m.key,
          title: str(m.title) ?? m.key,
          status: MILESTONE_STATUS.has(m.status) ? m.status : 'pending',
        }))
      : [],
    startedAt: str(j.startedAt) ?? at,
    updatedAt: str(j.updatedAt) ?? at,
    endedAt: str(j.endedAt),
    now: fixNow(j.now),
  };
  if ('_prevEndedAt' in j) job._prevEndedAt = str(j._prevEndedAt);
  if (j._mainStopped !== true) delete job._mainStopped;
  return job;
}

function fixNow(n) {
  if (!isObj(n)) return null;
  const nums = (o) => {
    const out = {};
    if (isObj(o)) for (const [k, v] of Object.entries(o)) if (Number.isFinite(v)) out[k] = v;
    return out;
  };
  return {
    milestone: typeof n.milestone === 'string' ? n.milestone : '',
    pills: Array.isArray(n.pills)
      ? n.pills
        .filter((x) => isObj(x) && typeof x.label === 'string' && PILL_KINDS.has(x.kind))
        .map((x) => (str(x._id) ? { label: x.label, kind: x.kind, _id: x._id } : { label: x.label, kind: x.kind }))
      : [],
    attempt: Number.isFinite(n.attempt) ? n.attempt : 0,
    file: str(n.file),
    _counts: nums(n._counts),
    _open: Array.isArray(n._open) ? n._open.filter((x) => str(x)).slice(-MAX_OPEN) : [],
    _retryBase: nums(n._retryBase),
  };
}

function fixAgent(id, a, at) {
  return {
    id,
    name: str(a.name) ?? 'agent',
    status: AGENT_STATUS.has(a.status) ? a.status : 'running',
    activity: typeof a.activity === 'string' ? a.activity : '',
    job: Number.isInteger(a.job) ? a.job : null,
    updatedAt: str(a.updatedAt) ?? at,
    endedAt: str(a.endedAt),
  };
}
