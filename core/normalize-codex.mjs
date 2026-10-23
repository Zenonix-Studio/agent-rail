import { describeTool } from './flow.mjs';

/** @typedef {import('./normalize-claude.mjs').Event} Event */
/** @typedef {import('./normalize-claude.mjs').Normalized} Normalized */

/** @type {Record<string, 'pending'|'active'|'done'>} */
const STATUS = { pending: 'pending', in_progress: 'active', completed: 'done' };

/** @param {unknown} v @returns {string|null} */
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Maps a Codex hook payload to a common event.
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
  const threadId = str(p.session_id);
  if (!threadId) return null;
  const cwd = typeof p.cwd === 'string' ? p.cwd : '';
  // Spike: subagent hooks carry the parent's session_id plus agent_id. If a
  // payload instead comes from a separate thread with a parent link, re-parent it.
  const parent = str(p.parent_thread_id);
  const sessionId = parent ?? threadId;
  const agentId = str(p.agent_id) ?? (parent ? threadId : null);
  const event = toEvent(p, agentId);
  return event ? { sessionId, cwd, agentId, event } : null;
}

/** @param {any} p @param {string|null} agentId @returns {Event|null} */
function toEvent(p, agentId) {
  switch (p.hook_event_name) {
    case 'UserPromptSubmit':
      return typeof p.prompt === 'string' ? { type: 'prompt', text: p.prompt } : null;
    case 'PreToolUse':
      return toolEvent(p, 'pre');
    case 'PostToolUse':
      return toolEvent(p, 'post');
    case 'SubagentStart':
      return { type: 'agent-start', name: str(p.agent_type) ?? 'agent' };
    case 'SubagentStop':
      return { type: 'agent-stop', ok: true };
    case 'Stop':
      return agentId ? null : { type: 'stop', lastMessage: str(p.last_assistant_message) };
    case 'SessionEnd':
      return { type: 'session-end' };
    default:
      return null; // SessionStart has no event type
  }
}

/** @param {any} p @param {'pre'|'post'} phase @returns {Event|null} */
function toolEvent(p, phase) {
  const name = str(p.tool_name);
  if (!name) return null;
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};

  // A sub-thread's plan is that agent's own; the reducer keeps it off the job's milestones.
  if (name === 'update_plan') return phase === 'post' ? plan(input) : null;

  let file = null;
  let ok = null;
  if (name === 'apply_patch') {
    const patch = typeof input.command === 'string' ? input.command : '';
    file = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch)?.[1]?.trim() ?? null;
    if (phase === 'post' && typeof p.tool_response === 'string') {
      const m = /^Exit code: (-?\d+)/.exec(p.tool_response);
      if (m) ok = Number(m[1]) === 0;
    }
  }
  // Codex hooks pass a shell command's output, not its exit code (code mode keeps no exit code at all):
  // a test runner's own summary line, or an exit code line when there is one, says how it went.
  if (ok === null && phase === 'post' && typeof p.tool_response === 'string') ok = outcomeOf(p.tool_response);
  const step = describeTool(name, input);
  if (!step) return null;
  return { type: 'tool', phase, name, ...step, file, ok, id: str(p.tool_use_id) };
}

/**
 * Pass or fail from a command's output: an exit code line, else the summary line of node:test,
 * pytest, jest/vitest, go test or cargo test. null when nothing says.
 * @param {string} out @returns {boolean|null}
 */
export function outcomeOf(out) {
  const code = /^(?:Exit code|Process exited with code):? (-?\d+)\b/mi.exec(out);
  if (code) return Number(code[1]) === 0;
  const node = /^ℹ fail (\d+)$/m.exec(out);
  if (node) return node[1] === '0';
  if (/^=+ .*\b\d+ (?:failed|errors?)\b.* =+$/m.test(out)) return false; // pytest
  if (/^=+ .*\b\d+ passed\b.* =+$/m.test(out)) return true;
  const jest = /^Tests:\s+(?:(\d+) failed)?/m.exec(out) ?? /^\s*Tests\s+(?:(\d+) failed)?/m.exec(out);
  if (jest) return jest[1] === undefined;
  if (/^(?:--- )?FAIL\b/m.test(out) || /^test result: FAILED\b/m.test(out)) return false; // go, cargo
  if (/^ok\s+\S+/m.test(out) || /^test result: ok\b/m.test(out)) return true;
  return null;
}

/** @param {any} input @returns {Event|null} */
function plan(input) {
  if (!Array.isArray(input.plan)) return null;
  const items = [];
  for (const s of input.plan) {
    const title = str(s?.step);
    const status = STATUS[s?.status];
    if (!title || !status) continue;
    items.push({ key: title, title, status });
  }
  return { type: 'plan', items, explanation: str(input.explanation) };
}
