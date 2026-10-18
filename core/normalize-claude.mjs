import { classifyTool } from './flow.mjs';

/**
 * @typedef {{type:'prompt', text:string}
 *  |{type:'plan', items:{key:string,title:string,status:'pending'|'active'|'done'}[], explanation:string|null}
 *  |{type:'task-create', key:string, title:string, description:string|null}
 *  |{type:'task-update', key:string, status:'pending'|'active'|'done'|'deleted'}
 *  |{type:'tool', phase:'pre'|'post', name:string, label:string, file:string|null, ok:boolean|null, id:string|null}
 *  |{type:'agent-start', name:string}|{type:'agent-stop', ok:boolean}
 *  |{type:'waiting'}|{type:'stop', lastMessage:string|null}|{type:'session-end'}} Event
 * @typedef {{sessionId:string, cwd:string, agentId:string|null, event:Event}} Normalized
 */

/** @type {Record<string, 'pending'|'active'|'done'|'deleted'>} */
const STATUS = { pending: 'pending', in_progress: 'active', completed: 'done', deleted: 'deleted' };

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
  return event ? { sessionId, cwd, agentId, event } : null;
}

/** @param {any} p @returns {Event|null} */
function toEvent(p) {
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      return typeof p.prompt === 'string' ? { type: 'prompt', text: p.prompt } : null;
    case 'PreToolUse':
      return toolEvent(p, 'pre', null);
    case 'PostToolUse':
      return toolEvent(p, 'post', true);
    case 'PostToolUseFailure':
      return toolEvent(p, 'post', false);
    case 'PermissionRequest':
    case 'Notification':
      return { type: 'waiting' };
    case 'SubagentStart':
      return { type: 'agent-start', name: str(p.agent_type) ?? 'agent' };
    case 'SubagentStop':
      return { type: 'agent-stop', ok: true };
    case 'Stop':
      return { type: 'stop', lastMessage: str(p.last_assistant_message) };
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
  if (name.startsWith('Task')) {
    if (phase !== 'post' || !ok) return null;
    if (name === 'TaskCreate') return taskCreate(p, input);
    if (name === 'TaskUpdate') return taskUpdate(p, input);
    return null;
  }

  return {
    type: 'tool',
    phase,
    name,
    label: classifyTool(name, input),
    file: str(input.file_path) ?? str(input.notebook_path),
    ok,
    id: str(p.tool_use_id), // pairs pre/post of parallel calls
  };
}

/** @param {any} p @param {any} input @returns {Event|null} */
function taskCreate(p, input) {
  const key = str(p.tool_response?.task?.id);
  const title = str(input.subject) ?? str(p.tool_response?.task?.subject);
  if (!key || !title) return null;
  return { type: 'task-create', key, title, description: str(input.description) };
}

/** @param {any} p @param {any} input @returns {Event|null} */
function taskUpdate(p, input) {
  const key = str(input.taskId) ?? str(p.tool_response?.taskId);
  const status = STATUS[input.status];
  if (!key || !status) return null;
  return { type: 'task-update', key, status };
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
