import { describeTool, clipText, PROGRESS_MAX } from './flow.mjs';

/**
 * @typedef {{type:'prompt', text:string}
 *  |{type:'plan', items:{key:string,title:string,status:'pending'|'active'|'done'}[], explanation:string|null, scope?:string|null}
 *  |{type:'plan-step', advance?:boolean, done?:number[], start?:number|null, finish?:boolean}
 *  |{type:'task-create', key:string, title:string, description:string|null, activeForm:string|null}
 *  |{type:'task-update', key:string, status:'pending'|'active'|'done'|'deleted', activeForm:string|null}
 *  |({type:'tool', phase:'pre'|'post', name:string, file:string|null, ok:boolean|null, id:string|null, spawned?:string|null} & import('./flow.mjs').Step)
 *  |{type:'agent-start', name:string}|{type:'agent-stop', ok:boolean, names?:{id:string, description:string}[], lastMessage?:string|null}
 *  |{type:'waiting', idle?:boolean}|{type:'stop', lastMessage:string|null, background?:string[]|null, names?:{id:string, description:string}[]}|{type:'session-end'}} Event
 *  A tool event carries its human step (`label`, `fail`, `key`, `group`, `item`, see core/flow.mjs);
 *  `spawned`: the agent id a Claude Agent call's response names.
 *  `idle`: Claude's idle_prompt notice. `background`: ids of the background tasks a Claude Stop lists as running; null when absent.
 *  `names`: background agents with the description they were dispatched with (exact names).
 *  The collector adds `steps` (a subagent's `step:` lines from its transcript) to its tool-pre and agent-stop events.
 * @typedef {{sessionId:string, cwd:string, agentId:string|null, agentType?:string|null, event:Event}} Normalized
 *  `agentType`: Claude's agent_type, null when empty or missing (the reducer uses it to skip helper agents).
 */

/** Claude's task tools: only TaskCreate / TaskUpdate change milestones; the rest are not shown as pills. */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop']);

/** The Claude desktop app's task list (it replaces TaskCreate / TaskUpdate there). */
const DESKTOP_PLAN = 'mcp__ccd_turn__update_plan';
/** Closes the desktop app's turn and checks off its task list. */
const DESKTOP_WRAP_UP = 'mcp__ccd_turn__wrap_up';

/** @type {Record<string, 'pending'|'active'|'done'|'deleted'>} */
const STATUS = { pending: 'pending', in_progress: 'active', completed: 'done', deleted: 'deleted' };

/** Claude Code hands a finished background agent's result back to the main agent as this prompt. */
const NOTICE_PREFIX = '<task-notification>';

/** @param {unknown} v @returns {string|null} */
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Maps a Claude Code hook payload to a common event.
 * @param {unknown} input Parsed hook JSON.
 * @returns {Normalized|null} null for unknown or malformed input; never throws.
 */
export function normalize(input) {
  try {
    return convert(/** @type {any} */ (input));
  } catch {
    return null;
  }
}

/** @param {any} p @returns {Normalized|null} */
function convert(p) {
  if (!p || typeof p !== 'object') return null;
  const sessionId = str(p.session_id);
  if (!sessionId) return null;
  const cwd = typeof p.cwd === 'string' ? p.cwd : '';
  const agentId = str(p.agent_id);
  const event = toEvent(p);
  return event ? { sessionId, cwd, agentId, agentType: str(p.agent_type), event } : null;
}

/** @param {any} p @returns {Event|null} */
function toEvent(p) {
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      if (typeof p.prompt !== 'string') return null;
      // A background agent's result is delivered to the main agent as a prompt; it is not the user's.
      return p.prompt.startsWith(NOTICE_PREFIX) ? null : { type: 'prompt', text: p.prompt };
    case 'PreToolUse':
      return toolEvent(p, 'pre', null);
    case 'PostToolUse':
      return toolEvent(p, 'post', true);
    case 'PostToolUseFailure':
      return toolEvent(p, 'post', false);
    case 'PermissionRequest':
      return { type: 'waiting' };
    case 'Notification':
      return p.notification_type === 'idle_prompt' ? { type: 'waiting', idle: true } : { type: 'waiting' };
    case 'SubagentStart':
      return { type: 'agent-start', name: str(p.agent_type) ?? 'agent' };
    case 'SubagentStop':
      return { type: 'agent-stop', ok: true, names: taskNames(p.background_tasks), lastMessage: str(p.last_assistant_message) };
    case 'Stop':
      return { type: 'stop', lastMessage: str(p.last_assistant_message), background: runningTasks(p.background_tasks), names: taskNames(p.background_tasks), shells: runningShells(p.background_tasks) };
    case 'SessionEnd':
      return { type: 'session-end' };
    default:
      // TaskCreated / TaskCompleted are ignored on purpose: task events come from PostToolUse.
      return null;
  }
}

/**
 * @param {any} p
 * @param {'pre'|'post'} phase
 * @param {boolean|null} ok
 * @returns {Event|null}
 */
function toolEvent(p, phase, ok) {
  const name = str(p.tool_name);
  if (!name) return null;
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};

  if (name === 'TodoWrite') return phase === 'post' && ok ? todoPlan(input) : null;
  if (name === DESKTOP_PLAN) return phase === 'post' && ok ? withProgress(desktopPlan(input), input) : null;
  // Its recap says how the turn ended: a better job summary than the progress written when the last step began.
  if (name === DESKTOP_WRAP_UP) return phase === 'post' && ok ? withProgress({ type: 'plan-step', finish: true }, { progress: input.recap }) : null;
  if (TASK_TOOLS.has(name)) {
    if (phase !== 'post' || !ok) return null;
    if (name === 'TaskCreate') return withProgress(taskCreate(p, input), input);
    if (name === 'TaskUpdate') return withProgress(taskUpdate(p, input), input);
    return null;
  }

  const step = describeTool(name, input);
  if (!step) return null; // bookkeeping (ToolSearch, …), not a step of the work
  /** @type {Event} */
  const e = {
    type: 'tool',
    phase,
    name,
    ...step,
    file: str(input.file_path) ?? str(input.notebook_path),
    ok,
    id: str(p.tool_use_id), // pairs pre/post of parallel calls
  };
  // The Agent call's response names the agent it started: the link to its SubagentStart.
  if (step.group === 'dispatch' && phase === 'post') e.spawned = str(p.tool_response?.agentId);
  // A command started in the background: its task id, for the job that started it.
  const bg = phase === 'post' ? str(p.tool_response?.backgroundTaskId) : null;
  if (bg) e.background = { id: bg, label: str(input.description) ?? str(input.command) ?? bg };
  return e;
}

/**
 * The agent's own `progress` summary, passed in the plan call's input (update_plan's extra `progress`
 * field, TaskCreate / TaskUpdate's `metadata.progress`): assistant text before a tool call does not
 * always reach the transcript, a tool input always reaches the hook.
 * @param {Event|null} e @param {any} input @returns {Event|null}
 */
function withProgress(e, input) {
  const progress = str(input.progress) ?? str(input.metadata?.progress);
  return e && progress ? { ...e, progress: clipText(progress.replace(/\s+/g, ' '), PROGRESS_MAX) } : e;
}

/** @param {unknown} tasks Stop's `background_tasks` @returns {string[]|null} ids of the shell commands still running; null when absent */
function runningShells(tasks) {
  if (!Array.isArray(tasks)) return null;
  return tasks.filter((t) => t && t.type === 'shell' && t.status === 'running' && str(t.id)).map((t) => t.id);
}

/** @param {unknown} tasks Stop's `background_tasks` @returns {string[]|null} ids still running; null when absent */
function runningTasks(tasks) {
  if (!Array.isArray(tasks)) return null;
  return tasks.filter((t) => t && t.status === 'running' && str(t.id)).map((t) => t.id);
}

/**
 * @param {unknown} tasks `background_tasks` of a Stop / SubagentStop
 * @returns {{id: string, description: string}[]} agent ids with the description they were dispatched with
 */
function taskNames(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((t) => t && (t.type === undefined || t.type === 'subagent') && str(t.id) && str(t.description))
    .map((t) => ({ id: t.id, description: t.description }));
}

/** @param {any} p @param {any} input @returns {Event|null} */
function taskCreate(p, input) {
  const key = str(p.tool_response?.task?.id);
  const title = str(input.subject) ?? str(p.tool_response?.task?.subject);
  if (!key || !title) return null;
  return { type: 'task-create', key, title, description: str(input.description), activeForm: str(input.activeForm) };
}

/** @param {any} p @param {any} input @returns {Event|null} */
function taskUpdate(p, input) {
  const key = str(input.taskId) ?? str(p.tool_response?.taskId);
  const status = STATUS[input.status];
  if (!key || !status) return null;
  return { type: 'task-update', key, status, activeForm: str(input.activeForm) ?? str(input.subject) };
}

/** @param {any} input @returns {Event|null} */
function todoPlan(input) {
  if (!Array.isArray(input.todos)) return null;
  const items = [];
  for (const t of input.todos) {
    const title = str(t?.content);
    const status = STATUS[t?.status];
    if (!title || !status || status === 'deleted') continue;
    items.push({ key: title, title, status });
  }
  return { type: 'plan', items, explanation: null };
}

/**
 * The desktop app's update_plan: a whole list (`items`, with the request's `scope`), or a
 * relative move (`advance`, `done` 1-based indexes, `start`) the reducer applies to the current plan.
 * @param {any} input @returns {Event|null}
 */
function desktopPlan(input) {
  if (Array.isArray(input.items)) {
    const items = [];
    for (const t of input.items) {
      const title = str(t?.content);
      const status = STATUS[t?.status];
      if (!title || !status || status === 'deleted') continue;
      items.push({ key: title, title, status });
    }
    return { type: 'plan', items, explanation: null, scope: str(input.scope) };
  }
  const done = Array.isArray(input.done) ? input.done.filter((n) => Number.isInteger(n)) : [];
  const start = Number.isInteger(input.start) ? input.start : null;
  if (input.advance !== true && done.length === 0 && start === null) return null;
  return { type: 'plan-step', advance: input.advance === true, done, start };
}
