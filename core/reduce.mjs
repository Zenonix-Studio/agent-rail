import { basename } from 'node:path';
import { agentTypeName, clipText, extractMeta, groupLabel, LABEL_MAX } from './flow.mjs';
import { SCHEMA_VERSION } from './state.mjs';
import { runningAgents } from './progress.mjs';

/** @typedef {import('./state.mjs').Session} Session */
/** @typedef {import('./state.mjs').Job} Job */
/** @typedef {import('./state.mjs').Agent} Agent */
/** @typedef {import('./state.mjs').Now} Now */
/** @typedef {import('./state.mjs').Pill} Pill */
/** @typedef {import('./normalize-claude.mjs').Event} Event */
/**
 * @typedef {{source:'claude'|'codex', sessionId:string, cwd:string, agentId:string|null, agentType?:string|null, event:Event}} ReduceInput
 */

const SOURCES = new Set(['claude', 'codex']);
const JOB_STATUS = new Set(['planning', 'running', 'waiting', 'done', 'error']);
const MILESTONE_STATUS = new Set(['pending', 'active', 'done']);
const AGENT_STATUS = new Set(['running', 'done', 'error', 'stale']);
const PILL_KINDS = new Set(['ok', 'warn', 'active', 'info']);
const MAX_PILLS = 4;
const MAX_AGENT_STEPS = 6; // story steps kept per subagent
const SUMMARY_MAX = 100;
const MAX_OPEN = 20; // open call ids kept for pre/post pairing
const MAX_ITEMS = 20; // items kept per collapsed run
const MAX_DISPATCH = 10; // recent Agent calls kept to name the agents they start
const TITLE_MAX = 48;
// R18: these step keys count every repeat as a retry; others only after they failed.
const RETRY_KEYS = new Set(['Build', 'Test']);

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
  // Claude's Stop / SubagentStop list background agents with their dispatch description: exact names.
  if (Array.isArray(e.names)) applyNames(s, e.names);
  // R20: Claude Code's own helper agents (prompt suggestion, internal forks) send an
  // agent_id with no agent_type and never a SubagentStart. A SubagentStart, or a typed
  // event, makes an id a subagent; untyped events from ids never seen are skipped.
  if (agentId && input.source === 'claude' && !str(input.agentType) && e.type !== 'agent-start' && !isObj(s.agents[agentId])) return;
  switch (e.type) {
    case 'prompt':
      if (!agentId) onPrompt(s, typeof e.text === 'string' ? e.text : '', at);
      break;
    case 'plan':
    case 'task-create':
    case 'task-update':
      // Only the main agent's plan drives the job's milestones and %; a subagent's plan is its own.
      if (agentId) onAgentMilestones(s, agentId, e, at);
      else onMilestones(s, e, at);
      break;
    case 'tool':
      onTool(s, agentId, e, at);
      break;
    case 'agent-start':
      if (agentId) {
        const a = agent(s, agentId, at);
        a._type = str(e.name) ?? a._type ?? null;
        // The dispatch's own description names it; else its agent type, humanized.
        const d = claimDispatch(s, agentId, a._type);
        a.name = d?.name ?? agentTypeName(a._type) ?? a.name;
        if (d) a.summary = dispatchSummary(d);
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
      // R19: once its turn ended, the main agent idling adds nothing; any real request still counts.
      if (job && job.status !== 'done' && !(e.idle === true && job._mainStopped)) {
        job.status = 'waiting';
        job.updatedAt = at;
      }
      break;
    }
    case 'stop':
      if (!agentId) finish(s, e.lastMessage, at, false, Array.isArray(e.background) ? e.background : null);
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
  // Dispatches of earlier jobs, or never claimed by an agent in the last turn, cannot name anything new.
  s._dispatch = s._dispatch.filter((d) => d.job === (job?.seq ?? null) && (d.claimed || d.agent));
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

  const prevKey = activeKey(job);
  const known = job.milestones.length;
  const isNewTask = e.type === 'task-create' && !job.milestones.some((m) => m.key === e.key);
  const changed = changeMilestones(job, e);
  if (changed || e.type === 'plan') {
    // Done jobs are only reopened by a prompt; a stray late update must not.
    if (job.status !== 'done') job.status = 'running';
    job.updatedAt = at;
  }
  const key = activeKey(job);
  if (job.now && job.now.milestone !== key) {
    // The story reads across milestones: pills carry over, the retry bookkeeping starts fresh,
    // and a finished milestone becomes a step of its own ("Plan the change ✓").
    const left = job.milestones.find((m) => m.key === job.now?.milestone);
    // Its own start pill ("Planning the change") is superseded by the ✓.
    const startOf = `@${left?.key}`;
    job.now = { ...emptyNow(key), pills: job.now.pills.filter((p) => !(left?.status === 'done' && p._run?.g === startOf)) };
    if (left?.status === 'done') pushPill(nowOf(job, key), donePill(left), MAX_PILLS);
  }
  if (!changed) return;
  planStory(nowOf(job, key), e, known, isNewTask, job.milestones, key !== prevKey ? key : '', MAX_PILLS);
}

/**
 * A subagent's own plan (Claude TaskCreate / TaskUpdate / TodoWrite, Codex update_plan
 * from a sub-thread): it fills `Agent.milestones` and adds the same story steps as the
 * main flow. It never touches the job's milestones.
 */
function onAgentMilestones(s, agentId, e, at) {
  const a = agent(s, agentId, at);
  const prevKey = activeKey(a);
  const known = a.milestones.length;
  const wasDone = new Set(a.milestones.filter((m) => m.status === 'done').map((m) => m.key));
  const isNewTask = e.type === 'task-create' && !a.milestones.some((m) => m.key === e.key);
  if (!changeMilestones(a, e)) return;
  const story = { pills: a.steps, _open: a._open };
  // A finished step of its plan becomes a step of its story, replacing its own start step.
  for (const m of a.milestones) {
    if (m.status !== 'done' || wasDone.has(m.key)) continue;
    story.pills = story.pills.filter((p) => p._run?.g !== `@${m.key}`);
    pushPill(story, donePill(m), MAX_AGENT_STEPS);
  }
  const key = activeKey(a);
  planStory(story, e, known, isNewTask, a.milestones, key !== prevKey ? key : '', MAX_AGENT_STEPS);
  a.steps = story.pills;
  a.activity = a.steps[a.steps.length - 1]?.label ?? 'Planning';
}

/**
 * The plan itself is a step of the story: "Planned 4 steps", then the step being worked on.
 * @param {{pills: Pill[]}} story @param {Record<string, any>} e
 * @param {number} known milestones before the event @param {boolean} isNewTask
 * @param {import('./state.mjs').Milestone[]} milestones after the event
 * @param {string} started key of a milestone that just became active, or ''
 * @param {number} max pills kept
 */
function planStory(story, e, known, isNewTask, milestones, started, max) {
  if (isNewTask) planPill(story, 1, max);
  else if (e.type === 'plan' && known === 0 && milestones.length > 0) planPill(story, milestones.length, max);
  if (started === '') return;
  // The task's own "-ing" form ("Writing the README") only when it says more than the title above.
  const m = milestones.find((x) => x.key === started);
  const label = (e.type === 'task-update' && str(e.activeForm)) || str(m?._activeForm);
  if (label && label !== m?.title) pushPill(story, newPill({ label: clipText(label, LABEL_MAX), group: `@${started}`, item: null }, 'info', null), max);
}

/** @param {import('./state.mjs').Milestone} m @returns {Pill} "<title> ✓" */
function donePill(m) {
  return newPill({ label: clipText(m.title, LABEL_MAX), group: null, item: null }, 'ok', null);
}

/** @param {Job} job @param {string} key @returns {Now} */
function nowOf(job, key) {
  return job.now ?? (job.now = emptyNow(key));
}

/** Adds `n` planned steps to a story, merging with a "Planned N steps" pill right before. */
function planPill(story, n, max) {
  const last = story.pills[story.pills.length - 1];
  if (last?._run?.g === 'plan') {
    last._run.n += n;
    last.label = groupLabel('plan', [], last._run.n, '');
    return;
  }
  pushPill(story, { label: groupLabel('plan', [], n, ''), kind: 'ok', _run: { g: 'plan', items: [], n, one: '', ids: [] } }, max);
}

/** @param {{pills: Pill[]}} story @param {Pill} pill @param {number} max */
function pushPill(story, pill, max) {
  story.pills.push(pill);
  story.pills = story.pills.slice(-max);
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

/** @param {{milestones: import('./state.mjs').Milestone[]}} job a job, or a subagent's own plan @param {Record<string, any>} e @returns {boolean} true when milestones changed */
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
    if (i < 0) job.milestones.push({ key, title, status: 'pending' });
    const m = job.milestones[i < 0 ? job.milestones.length - 1 : i];
    m.title = title;
    if (str(e.activeForm)) m._activeForm = e.activeForm;
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

/**
 * Rules 4-6: main-agent tools feed the "now" pills; subagent tools feed agent activity.
 * Each call is a human step (core/flow.mjs). Steps of the same group in a row
 * collapse into one pill ("Reading 5 files"); a failed step is never merged into.
 */
function onTool(s, agentId, e, at) {
  const step = stepOf(e);
  const file = str(e.file);
  const id = str(e.id);

  if (agentId) {
    onAgentTool(s, agentId, e, step, id, at);
    return;
  }

  const job = ensureJob(s, at);
  // The main agent works again (e.g. a turn after a hand-back): its next Stop decides anew.
  delete job._mainStopped;
  // R17: main-agent tool activity means the job runs, plan or not.
  if (job.status === 'waiting' || job.status === 'planning') job.status = 'running';
  const key = activeKey(job);
  if (!job.now || job.now.milestone !== key) job.now = emptyNow(key);
  const now = job.now;
  const counts = now._counts;
  const ck = step.key;
  if (step.group === 'dispatch') noteDispatch(s, e, id);

  if (storyTool(now, e, step, id, MAX_PILLS)) counts[ck] = (counts[ck] ?? 0) + 1;
  // R18: a failure starts a retry count for steps that do not always count.
  if (e.phase !== 'pre' && e.ok === false && !RETRY_KEYS.has(ck) && !(ck in now._retryBase)) now._retryBase[ck] = (counts[ck] ?? 1) - 1;
  const n = counts[ck] ?? 1;
  now.attempt = RETRY_KEYS.has(ck) ? n : ck in now._retryBase ? n - now._retryBase[ck] : 1;
  if (file) now.file = file;
  job.updatedAt = at;
}

/**
 * Folds one tool call into a story: pairs pre/post by call id, collapses steps of
 * the same group into one pill, and keeps a failed step visible on its own.
 * @param {{pills: Pill[], _open: string[]}} story mutated in place
 * @param {Record<string, any>} e @param {StepIn} step @param {string|null} id
 * @param {number} max pills kept
 * @returns {boolean} true when the call counts as a new occurrence of its step
 */
function storyTool(story, e, step, id, max) {
  let counted = true;
  if (e.phase === 'pre') {
    const last = story.pills[story.pills.length - 1];
    if (mergeable(last, step)) {
      addToRun(last, step, id);
      last.kind = 'active';
    } else {
      story.pills.push(newPill(step, 'active', id));
    }
    if (id) story._open = [...story._open, id].slice(-MAX_OPEN);
  } else {
    const kind = e.ok === true ? 'ok' : e.ok === false ? 'warn' : 'info';
    // Parallel calls: pair by call id first, else by the latest active pill of this group.
    const opened = id !== null && story._open.includes(id);
    if (opened) story._open = story._open.filter((x) => x !== id);
    let i = -1;
    for (let k = story.pills.length - 1; k >= 0; k--) {
      const p = story.pills[k];
      const run = p._run;
      if (id !== null ? run?.ids.includes(id) : p.kind === 'active' && run?.g === step.group) { i = k; break; }
    }
    if (i >= 0) {
      const p = story.pills[i];
      const run = /** @type {Run} */ (p._run);
      if (id !== null) run.ids = run.ids.filter((x) => x !== id);
      else run.ids = run.ids.slice(1);
      if (e.ok === false && run.n > 1) {
        // One call of a run failed: keep the run, show the failure as its own step after it.
        run.n -= 1;
        const j = step.item ? run.items.lastIndexOf(step.item) : -1;
        if (j >= 0) run.items.splice(j, 1);
        p.label = groupLabel(run.g, run.items, run.n, run.one);
        if (run.ids.length === 0) p.kind = 'ok';
        story.pills.splice(i + 1, 0, failPill(step));
      } else if (e.ok === false) {
        story.pills[i] = failPill(step);
      } else if (run.ids.length === 0) {
        p.kind = kind;
      }
    } else {
      const last = story.pills[story.pills.length - 1];
      if (e.ok !== false && mergeable(last, step)) {
        addToRun(last, step, null);
        if (/** @type {Run} */ (last._run).ids.length === 0) last.kind = kind;
      } else {
        story.pills.push(e.ok === false ? failPill(step) : newPill(step, kind, null));
      }
    }
    // A post whose pre was never seen still counts as one occurrence.
    counted = i < 0 && !opened;
  }
  story.pills = story.pills.slice(-max);
  return counted;
}

/** A subagent's tool call: a step of its own story, built like the main flow; `activity` is its latest step. */
function onAgentTool(s, agentId, e, step, id, at) {
  const a = agent(s, agentId, at);
  const story = { pills: a.steps, _open: a._open };
  storyTool(story, e, step, id, MAX_AGENT_STEPS);
  a.steps = story.pills;
  a._open = story._open;
  a.activity = a.steps[a.steps.length - 1]?.label ?? a.activity;
  // M3: only the main agent's activity clears a permission 'waiting'. R19: after a
  // main-agent Stop, a working subagent of the job means the job still runs.
  const job = current(s);
  if (job && job.status === 'waiting' && job._mainStopped && a.job === job.seq) {
    job.status = 'running';
    job.updatedAt = at;
  }
}

/**
 * @typedef {{g: string|null, items: string[], n: number, one: string, ids: string[]}} Run
 *  A collapsed run of steps: group, their items, how many, the first step's label, open call ids.
 * @typedef {{label: string, fail: string, key: string, group: string|null, item: string|null}} StepIn
 */

/** @param {Record<string, any>} e @returns {StepIn} */
function stepOf(e) {
  const label = str(e.label) ?? str(e.name) ?? 'Working';
  return { label, fail: str(e.fail) ?? `Failed: ${label}`, key: str(e.key) ?? label, group: str(e.group), item: str(e.item) };
}

/** @param {Pill|undefined} p @param {StepIn} step */
function mergeable(p, step) {
  return !!p && p.kind !== 'warn' && !!p._run && p._run.g !== null && p._run.g !== 'plan' && p._run.g === step.group;
}

/** @param {Pill} p @param {StepIn} step @param {string|null} id */
function addToRun(p, step, id) {
  const run = /** @type {Run} */ (p._run);
  run.n += 1;
  if (step.item) run.items = [...run.items, step.item].slice(-MAX_ITEMS);
  if (id) run.ids = [...run.ids, id].slice(-MAX_OPEN);
  p.label = groupLabel(run.g, run.items, run.n, run.one);
}

/** @param {Pick<StepIn, 'label'|'group'|'item'>} step @param {import('./state.mjs').PillKind} kind @param {string|null} id @returns {Pill} */
function newPill(step, kind, id) {
  return { label: step.label, kind, _run: { g: step.group, items: step.item ? [step.item] : [], n: 1, one: step.label, ids: id ? [id] : [] } };
}

/** @param {StepIn} step @returns {Pill} */
function failPill(step) {
  return { label: step.fail, kind: 'warn', _run: { g: step.group, items: step.item ? [step.item] : [], n: 1, one: step.label, ids: [] } };
}

/**
 * Remembers a main-agent Agent call so the agent it starts can be shown under
 * its description. Claude's PostToolUse names the agent (`spawned`): that link
 * is exact and corrects an earlier guess. A failed or denied call starts nothing.
 * @param {Session} s @param {Record<string, any>} e @param {string|null} id
 */
function noteDispatch(s, e, id) {
  if (!id) return;
  let d = s._dispatch.find((x) => x.id === id);
  if (e.phase === 'post' && e.ok === false) {
    if (!d) return;
    s._dispatch = s._dispatch.filter((x) => x !== d);
    const took = d.claimed ? s.agents[d.claimed] : null;
    if (isObj(took)) {
      took.name = agentTypeName(took._type) ?? 'agent';
      took.summary = '';
    }
    return;
  }
  if (!d) {
    d = { id, name: str(e.agentName), task: str(e.agentTask), type: str(e.agentType), agent: null, claimed: null, job: current(s)?.seq ?? null };
    s._dispatch = [...s._dispatch, d].slice(-MAX_DISPATCH);
  }
  d.name ??= str(e.agentName);
  d.task ??= str(e.agentTask);
  const spawned = str(e.spawned);
  if (!spawned || d.agent === spawned) return;
  d.agent = spawned;
  const guessed = d.claimed && d.claimed !== spawned ? d.claimed : null;
  d.claimed = null;
  const target = s.agents[spawned];
  if (isObj(target)) {
    // The named agent drops whatever it guessed, then takes this call's name.
    for (const x of s._dispatch) if (x !== d && x.claimed === spawned) x.claimed = null;
    d.claimed = spawned;
    if (d.name) target.name = d.name;
    target.summary = dispatchSummary(d);
  }
  // Another agent took this call's name by guess: it guesses again.
  const wrong = guessed ? s.agents[guessed] : null;
  if (isObj(wrong)) {
    const again = claimDispatch(s, wrong.id, wrong._type);
    wrong.name = again?.name ?? agentTypeName(wrong._type) ?? 'agent';
    wrong.summary = again ? dispatchSummary(again) : '';
  }
}

/**
 * The dispatch an agent belongs to: the one whose response named it, else the
 * open call of its type in this job when that is unambiguous. Two or more open
 * calls of the type with different names: no guess (the type name shows until
 * an exact link arrives). Untyped agents never guess.
 * @param {Session} s @param {string} agentId @param {string|null} type
 * @returns {{name: string|null, task: string|null}|null}
 */
function claimDispatch(s, agentId, type) {
  const list = s._dispatch;
  let d = list.find((x) => x.agent === agentId) ?? list.find((x) => x.claimed === agentId);
  if (!d && type) {
    const seq = current(s)?.seq ?? null;
    const open = list.filter((x) => !x.claimed && !x.agent && x.job === seq && (!x.type || x.type === type));
    if (new Set(open.map((x) => x.name)).size === 1) d = open[0];
  }
  if (!d) return null;
  d.claimed = agentId;
  return d;
}

/** What a dispatch asked its agent to do: the prompt's first sentence, else its description. */
function dispatchSummary(d) {
  return d.task ?? d.name ?? '';
}

/**
 * Names agents from a Stop's `background_tasks`: the description each was dispatched with.
 * @param {Session} s @param {unknown[]} names
 */
function applyNames(s, names) {
  for (const n of names) {
    if (!isObj(n) || !str(n.id) || !str(n.description)) continue;
    const a = s.agents[n.id];
    if (!isObj(a)) continue;
    const desc = n.description.replace(/\s+/g, ' ').trim();
    a.name = clipText(desc, 40);
    if (a.summary === '') a.summary = clipText(desc, SUMMARY_MAX);
  }
}

/**
 * Rules 7-8: close the current job and adopt the agent-written title/summary.
 * R16: a main-agent Stop with unfinished milestones only pauses the job
 * ('waiting' for the user); session end always finishes it.
 * R19: a main-agent Stop while subagents of the job still run keeps it
 * 'running': the main agent waits on them, and its next Stop decides.
 * @param {boolean} final true on session end
 * @param {string[]|null} [background] ids Claude's Stop lists as still running; null when unknown
 */
function finish(s, lastMessage, at, final, background = null) {
  s._pendingPrompt = null;
  const job = current(s);
  if (job && job.status !== 'done') {
    // R19: the Stop's own list is authoritative; a "running" agent missing from it never reported back.
    if (!final && background) closeAgents(s, at, job.seq, new Set(background));
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
  if (final) closeAgents(s, at, null);
  else if (job?.status === 'done') closeAgents(s, at, job.seq);
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

/**
 * Marks running agents `stale`.
 * @param {Session} s @param {string} at
 * @param {number|null} seq only agents of this job; null for all
 * @param {Set<string>} [keep] ids to leave running
 */
function closeAgents(s, at, seq, keep) {
  for (const a of Object.values(s.agents)) {
    if (a.status !== 'running' || (seq !== null && a.job !== seq) || keep?.has(a.id)) continue;
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
    s.agents[id] = {
      id, name: 'agent', status: 'running', activity: '', summary: '', milestones: [], steps: [],
      job: current(s)?.seq ?? null, updatedAt: at, endedAt: null, _type: null, _open: [],
    };
  }
  s.agents[id].updatedAt = at;
  return s.agents[id];
}

/** @param {{milestones: import('./state.mjs').Milestone[]}} job a job or an agent @returns {string} key of the active milestone, or '' */
function activeKey(job) {
  return job.milestones.find((m) => m.status === 'active')?.key ?? '';
}

/**
 * @param {string} milestone
 * @returns {Now} `_counts` tracks step-key occurrences for `attempt`; `_open` holds
 *   call ids whose pre was counted but whose post has not arrived yet;
 *   `_retryBase[key]` is the count before that step key's first failure (R18).
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
    _dispatch: Array.isArray(p._dispatch)
      ? p._dispatch
        .filter((d) => isObj(d) && str(d.id))
        .map((d) => ({ id: d.id, name: str(d.name), task: str(d.task), type: str(d.type), agent: str(d.agent), claimed: str(d.claimed), job: Number.isInteger(d.job) ? d.job : null }))
        .slice(-MAX_DISPATCH)
      : [],
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
    milestones: fixMilestones(j.milestones),
    startedAt: str(j.startedAt) ?? at,
    updatedAt: str(j.updatedAt) ?? at,
    endedAt: str(j.endedAt),
    now: fixNow(j.now),
  };
  if ('_prevEndedAt' in j) job._prevEndedAt = str(j._prevEndedAt);
  if (j._mainStopped !== true) delete job._mainStopped;
  return job;
}

/** @param {unknown} list @returns {import('./state.mjs').Milestone[]} */
function fixMilestones(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => isObj(m) && str(m.key))
    .map((m) => {
      const out = { key: m.key, title: str(m.title) ?? m.key, status: MILESTONE_STATUS.has(m.status) ? m.status : 'pending' };
      if (str(m._activeForm)) out._activeForm = m._activeForm;
      return out;
    });
}

/** @param {unknown} list @returns {Pill[]} */
function fixPills(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => isObj(x) && typeof x.label === 'string' && PILL_KINDS.has(x.kind))
    .map((x) => ({ label: x.label, kind: x.kind, _run: fixRun(x._run, x.label, x._id) }));
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
    pills: fixPills(n.pills),
    attempt: Number.isFinite(n.attempt) ? n.attempt : 0,
    file: str(n.file),
    _counts: nums(n._counts),
    _open: Array.isArray(n._open) ? n._open.filter((x) => str(x)).slice(-MAX_OPEN) : [],
    _retryBase: nums(n._retryBase),
  };
}

/**
 * @param {unknown} r stored run @param {string} label the pill's label
 * @param {unknown} [legacyId] `_id` of a pill written before runs existed
 * @returns {Run}
 */
function fixRun(r, label, legacyId) {
  const old = str(legacyId);
  if (!isObj(r)) return { g: `=${label}`, items: [], n: 1, one: label, ids: old ? [old] : [] };
  /** @type {(v: unknown, max: number) => string[]} */
  const strs = (v, max) => (Array.isArray(v) ? v.filter((x) => str(x)).slice(-max) : []);
  return {
    g: str(r.g),
    items: strs(r.items, MAX_ITEMS),
    n: Number.isInteger(r.n) && r.n > 0 ? r.n : 1,
    one: typeof r.one === 'string' ? r.one : label,
    ids: strs(r.ids, MAX_OPEN),
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
    summary: typeof a.summary === 'string' ? a.summary : '',
    milestones: fixMilestones(a.milestones),
    steps: fixPills(a.steps).slice(-MAX_AGENT_STEPS),
    _type: str(a._type),
    _open: Array.isArray(a._open) ? a._open.filter((x) => str(x)).slice(-MAX_OPEN) : [],
  };
}
