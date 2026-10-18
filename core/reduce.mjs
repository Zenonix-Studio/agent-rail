import { basename } from 'node:path';
import { extractMeta } from './flow.mjs';

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
const AGENT_STATUS = new Set(['running', 'done', 'error']);
const PILL_KINDS = new Set(['ok', 'warn', 'active', 'info']);
const MAX_PILLS = 3;
const TITLE_MAX = 48;

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
      onPrompt(s, typeof e.text === 'string' ? e.text : '', at);
      break;
    case 'plan':
    case 'task-create':
    case 'task-update':
      onMilestones(s, e, at);
      break;
    case 'tool':
      onTool(s, agentId, e, at);
      break;
    case 'agent-start':
      if (agentId) {
        const a = agent(s, agentId, at);
        a.name = str(e.name) ?? a.name;
        a.status = 'running';
      }
      break;
    case 'agent-stop':
      if (agentId) agent(s, agentId, at).status = e.ok === false ? 'error' : 'done';
      break;
    case 'waiting': {
      const job = current(s);
      if (job && job.status !== 'done') {
        job.status = 'waiting';
        job.updatedAt = at;
      }
      break;
    }
    case 'stop':
      if (!agentId) finish(s, e.lastMessage, at);
      break;
    case 'session-end':
      finish(s, null, at);
      break;
    default:
      break;
  }
}

/** Rule 1: start a job, reopen a done one (pending split decision), or ignore. */
function onPrompt(s, text, at) {
  const job = current(s);
  if (!job) {
    s.jobs.push(newJob(s, 1, text, 'planning', at));
    return;
  }
  if (job.status === 'done') {
    s.pendingPrompt = text;
    job._prevEndedAt = job.endedAt;
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

/** Rules 2 and 3: split on a disjoint plan after a follow-up prompt, then apply the change. */
function onMilestones(s, e, at) {
  let job = ensureJob(s, at);

  if (s.pendingPrompt !== null && (e.type === 'plan' || e.type === 'task-create')) {
    if (isDisjoint(job, e)) {
      job.status = 'done';
      job.endedAt = job._prevEndedAt ?? at;
      delete job._prevEndedAt;
      job.updatedAt = at;
      job = newJob(s, job.seq + 1, s.pendingPrompt, 'running', at);
      s.jobs.push(job);
    } else {
      delete job._prevEndedAt;
    }
    s.pendingPrompt = null;
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
 * R10: Codex plans are snapshots keyed by step title; Claude task ids never
 * reset, so a created task is compared by title against current milestones.
 * @param {Job} job @param {Record<string, any>} e @returns {boolean}
 */
function isDisjoint(job, e) {
  if (e.type === 'task-create') {
    return typeof e.title === 'string' && !job.milestones.some((m) => m.title === e.title);
  }
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
    const job = current(s);
    if (job && job.status === 'waiting') {
      job.status = 'running';
      job.updatedAt = at;
    }
    return;
  }

  const job = ensureJob(s, at);
  if (job.status === 'waiting') job.status = 'running';
  const key = activeKey(job);
  if (!job.now || job.now.milestone !== key) job.now = emptyNow(key);
  const now = job.now;
  const counts = now._counts;

  if (e.phase === 'pre') {
    now.pills.push({ label, kind: 'active' });
    counts[label] = (counts[label] ?? 0) + 1;
  } else {
    const kind = e.ok === true ? 'ok' : e.ok === false ? 'warn' : 'info';
    const pill = { label: e.ok === false ? `${label} failed` : label, kind };
    const last = now.pills[now.pills.length - 1];
    if (last && last.kind === 'active' && last.label === label) {
      now.pills[now.pills.length - 1] = pill;
    } else {
      // Post without a matching pre still counts as one occurrence.
      now.pills.push(pill);
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  now.pills = now.pills.slice(-MAX_PILLS);
  now.attempt = counts[label];
  if (file) now.file = file;
  job.updatedAt = at;
}

/** Rules 7-8: close the current job and adopt the agent-written title/summary. */
function finish(s, lastMessage, at) {
  s.pendingPrompt = null;
  const job = current(s);
  if (!job) return;
  if (job.status !== 'done') {
    job.status = 'done';
    job.endedAt = at;
  }
  delete job._prevEndedAt;
  const meta = extractMeta(lastMessage);
  if (meta) {
    if (job.title === fallbackTitle(job.prompt)) job.title = meta.title;
    if (job.summary === '') job.summary = meta.summary;
  }
  job.updatedAt = at;
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
    s.agents[id] = { id, name: 'agent', status: 'running', activity: '', updatedAt: at };
  }
  s.agents[id].updatedAt = at;
  return s.agents[id];
}

/** @param {Job} job @returns {string} key of the active milestone, or '' */
function activeKey(job) {
  return job.milestones.find((m) => m.status === 'active')?.key ?? '';
}

/** @param {string} milestone @returns {Now} `_counts` tracks label occurrences for `attempt`. */
function emptyNow(milestone) {
  return { milestone, pills: [], attempt: 0, file: null, _counts: {} };
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
    schema: 1,
    source,
    sessionId,
    cwd,
    project: cwd ? basename(cwd) : '',
    updatedAt: at,
    jobs: Array.isArray(p.jobs) ? p.jobs.filter(isObj).map((j, i) => fixJob(j, i, source, sessionId, at)) : [],
    agents,
    pendingPrompt: typeof p.pendingPrompt === 'string' ? p.pendingPrompt : null,
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
  return job;
}

function fixNow(n) {
  if (!isObj(n)) return null;
  const counts = {};
  if (isObj(n._counts)) {
    for (const [k, v] of Object.entries(n._counts)) if (Number.isFinite(v)) counts[k] = v;
  }
  return {
    milestone: typeof n.milestone === 'string' ? n.milestone : '',
    pills: Array.isArray(n.pills)
      ? n.pills
        .filter((x) => isObj(x) && typeof x.label === 'string' && PILL_KINDS.has(x.kind))
        .map((x) => ({ label: x.label, kind: x.kind }))
      : [],
    attempt: Number.isFinite(n.attempt) ? n.attempt : 0,
    file: str(n.file),
    _counts: counts,
  };
}

function fixAgent(id, a, at) {
  return {
    id,
    name: str(a.name) ?? 'agent',
    status: AGENT_STATUS.has(a.status) ? a.status : 'running',
    activity: typeof a.activity === 'string' ? a.activity : '',
    updatedAt: str(a.updatedAt) ?? at,
  };
}
