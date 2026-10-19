import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';

// Commands count only at the start of the command line or after a separator
// (`;`, `&`, `|`, newline, `(`), so `git commit -m "make it work"` or `cmake`
// is not a Build. `cd x && make` matches through the `&&`.
const LEAD = String.raw`(?:^|[;&|\n(])\s*(?:npx\s+)?`;
const TEST = new RegExp(`${LEAD}(?:xcodebuild test|swift test|npm test|pytest|vitest|jest|cargo test|go test)\\b`);
const BUILD = new RegExp(`${LEAD}(?:xcodebuild|swift build|npm run build|pnpm build|yarn build|make|gradle|cargo build|tsc)\\b`);
const SHELL_TOOLS = new Set(['Bash', 'shell', 'local_shell', 'exec_command', 'unified_exec', 'container.exec']);
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
/** Tools that are bookkeeping, not work: never shown as a step. */
const SKIP_TOOLS = new Set(['ToolSearch', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop']);
const FIXED = {
  AskUserQuestion: 'Asking you a question',
  EnterPlanMode: 'Planning',
  ExitPlanMode: 'Presenting the plan',
  BashOutput: 'Checking command output',
  KillShell: 'Stopping a command',
  KillBash: 'Stopping a command',
  collaborationwait_agent: 'Waiting for agents',
  collaborationclose_agent: 'Closing an agent',
  collaborationsend_input: 'Messaging an agent',
  write_stdin: 'Checking command output',
};

/** Shell descriptions that say nothing about the work ("Run command"): treated as missing. */
const GENERIC_DESC = /^(?:run|execute)(?: a| the)?(?: shell| bash)? (?:command|script|it)$/i;

/** Agent types with a natural name of their own. */
const AGENT_TYPES = { 'general-purpose': 'General-purpose agent', fork: 'Forked agent' };

/** Longest step label, in characters; longer ones end in "…". */
export const LABEL_MAX = 60;
const AGENT_NAME_MAX = 40;

/** Stage types a step can have; viewers color by them. */
export const STAGES = ['plan', 'analyse', 'dev', 'fix', 'review'];
const STAGE_PREFIX = /^\s*(?:\[(plan|analy[sz]e|dev|fix|review)\]|(plan|analy[sz]e|dev|fix|review)\s*:)\s*/i;

/**
 * Reads an agent-written stage prefix off a plan step title: "fix: build error" or "[review] diff".
 * @param {string} title
 * @returns {{title: string, stage: string|null}} the title without the prefix, and its stage
 */
export function splitStage(title) {
  const m = STAGE_PREFIX.exec(title);
  const rest = m ? title.slice(m[0].length).trim() : '';
  if (!m || rest === '') return { title, stage: null };
  const stage = (m[1] ?? m[2]).toLowerCase().replace('analyze', 'analyse');
  return { title: rest, stage };
}

/**
 * One step of the work, as shown in the flow. Steps with the same `group` in a
 * row collapse into one pill (`groupLabel`).
 * @typedef {{
 *   label: string, fail: string, key: string,
 *   group: string|null, item: string|null, stage: string|null, agentName?: string|null, agentType?: string|null, agentTask?: string|null
 * }} Step
 *  `label`: human sentence, e.g. "Editing LoginView.swift". `fail`: what to show when it failed.
 *  `key`: what the retry counter counts (`Build`, `Test`, else the label).
 *  `group`: collapse family (`read`, `search`, `edit`, `dispatch`, `web`, or `=<label>` for exact repeats).
 *  `item`: the file / pattern / agent the step is about, for the collapsed count.
 *  `stage`: inferred stage (`analyse`, `dev`, `review`, `plan`), null when the tool says nothing.
 *  `agentName`/`agentType`: for a dispatch, the name the new agent is shown under and its type.
 *  `agentTask`: for a dispatch, what the agent is asked to do: the first sentence of its prompt.
 */

/**
 * Describes a tool call as a short human sentence, preferring the agent's own
 * words (a Bash `description`, an Agent `description`) over the tool's name.
 * @param {string} name Tool name as sent by the agent.
 * @param {unknown} input Raw `tool_input`.
 * @returns {Step|null} null for bookkeeping tools that are not steps (ToolSearch, TaskList, …).
 */
export function describeTool(name, input) {
  const tool = typeof name === 'string' ? name.trim() : '';
  const args = input && typeof input === 'object' ? /** @type {any} */ (input) : {};
  if (SKIP_TOOLS.has(tool)) return null;
  if (tool === '') return step('Working');

  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    return fileStep('Editing', 'edit', args.file_path ?? args.notebook_path, 'Editing a file');
  }
  if (tool === 'Write') return fileStep('Writing', 'edit', args.file_path, 'Writing a file');
  if (tool === 'apply_patch') {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/m.exec(typeof args.command === 'string' ? args.command : '');
    const verb = m?.[1] === 'Add' ? 'Writing' : m?.[1] === 'Delete' ? 'Deleting' : 'Editing';
    return fileStep(verb, 'edit', m?.[2]?.trim(), 'Editing files');
  }
  if (tool === 'Read') return fileStep('Reading', 'read', args.file_path, 'Reading a file');
  if (tool === 'Grep' || tool === 'Glob') {
    const pat = text(args.pattern);
    return step(pat ? `Searching for '${clipText(pat, 32)}'` : 'Searching the code', { group: 'search', item: pat, fail: 'Search failed', stage: 'analyse' });
  }
  if (SHELL_TOOLS.has(tool)) return shellStep(args);
  if (DISPATCH_TOOLS.has(tool)) {
    const desc = text(args.description);
    const type = text(args.subagent_type);
    const typeName = type ? agentTypeName(type) : null;
    const label = desc ? `Dispatched agent: ${desc}`
      : typeName ? `Dispatched ${lowerFirst(typeName)}` : 'Dispatched an agent';
    const stage = /review/i.test(`${type ?? ''} ${desc ?? ''}`) ? 'review' : null;
    return step(label, { group: 'dispatch', item: desc ?? typeName, fail: 'Agent dispatch failed', stage, agentName: desc ? clipText(desc, AGENT_NAME_MAX) : typeName, agentType: type, agentTask: firstSentence(args.prompt) });
  }
  if (tool === 'collaborationspawn_agent' || tool === 'spawn_agent') {
    const task = text(args.task_name) ?? text(args.name);
    const shown = task ? sentence(words(task)) : null;
    return step(shown ? `Dispatched agent: ${shown}` : 'Dispatched an agent', { group: 'dispatch', item: shown, agentName: shown && clipText(shown, AGENT_NAME_MAX), agentType: null, agentTask: firstSentence(args.message) });
  }
  if (tool === 'Skill') {
    const skill = text(args.skill) ?? text(args.name);
    const last = skill ? sentence(words(lastSegment(skill))) : '';
    return step(last ? `Using skill: ${last}` : 'Using a skill');
  }
  if (tool === 'WebSearch' || tool === 'web_search') {
    const q = text(args.query);
    return step(q ? `Searching the web: ${q}` : 'Searching the web', { group: 'web', item: q, stage: 'analyse' });
  }
  if (tool === 'WebFetch') {
    let host = null;
    try { host = new URL(String(args.url)).host.replace(/^www\./, ''); } catch { /* not a URL */ }
    return step(host ? `Reading ${host}` : 'Reading a web page', { group: 'web', item: host, stage: 'analyse' });
  }
  if (FIXED[tool]) return step(FIXED[tool], { stage: tool === 'EnterPlanMode' || tool === 'ExitPlanMode' ? 'plan' : null });
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) {
    const label = mcpLabel(mcp[1], mcp[2]);
    return step(label, { fail: `${label} failed` });
  }
  if (/^mcp__/.test(tool)) return step('Working');
  return step(sentence(words(tool)) || 'Working');
}

/**
 * Display name for an agent type: "octo:personas:code-reviewer" → "Code reviewer agent",
 * "general-purpose" → "General-purpose agent", "fork" → "Forked agent".
 * @param {unknown} type
 * @returns {string|null} null when there is no type.
 */
export function agentTypeName(type) {
  const t = text(type);
  if (!t) return null;
  const last = lastSegment(t);
  const known = AGENT_TYPES[/** @type {keyof typeof AGENT_TYPES} */ (last.toLowerCase())];
  if (known) return known;
  const name = sentence(words(last)) || 'Agent';
  return clipText(/\bagent$/i.test(name) ? name : `${name} agent`, AGENT_NAME_MAX);
}

/** `plugin:group:name` or `a/b` → the last segment. @param {string} id */
function lastSegment(id) {
  return id.split(/[:/]/).filter(Boolean).pop() ?? id;
}

/** "Code reviewer agent" → "code reviewer agent", keeping acronyms. @param {string} t */
function lowerFirst(t) {
  const first = t.split(' ')[0];
  return isAcronym(first) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

/**
 * Label of a run of collapsed steps of one group, e.g. "Reading 5 files".
 * @param {string|null} group
 * @param {string[]} items One entry per step (null items dropped).
 * @param {number} n Steps in the run.
 * @param {string} single Label used when the run is a single step (or one item).
 * @returns {string}
 */
export function groupLabel(group, items, n, single) {
  const uniq = new Set(items).size;
  switch (group) {
    case 'read': return uniq > 1 ? `Reading ${uniq} files` : single;
    case 'edit': return uniq > 1 ? `Editing ${uniq} files` : single;
    case 'search': return uniq > 1 ? `Searching ${uniq} patterns` : single;
    case 'web': return n > 1 ? `Searching the web (${n} lookups)` : single;
    case 'dispatch': return n > 1 ? `Dispatched ${n} agents` : single;
    case 'plan': return `Planned ${n} ${n === 1 ? 'step' : 'steps'}`;
    default: return single;
  }
}

/**
 * Bash and Codex shell calls: the agent's `description`, else Build/Test, else the command head.
 * @param {any} args @returns {Step}
 */
function shellStep(args) {
  const cmd = shellCommand(args.command ?? args.cmd);
  const kind = cmd === null ? null : TEST.test(cmd) ? 'Test' : BUILD.test(cmd) ? 'Build' : null;
  const raw = text(args.description);
  const desc = raw && !GENERIC_DESC.test(raw) ? raw : null;
  const fallback = kind === 'Test' ? 'Running tests' : kind === 'Build' ? 'Building' : cmd ? `Running \`${commandHead(cmd)}\`` : 'Running a command';
  // A build/test reads best as "Building"; a description wins only when it says more (4+ words).
  const label = desc && (!kind || desc.split(' ').length >= 4) ? desc : fallback;
  const fail = kind === 'Test' ? 'Tests failed'
    : kind === 'Build' ? 'Build failed'
    : desc ? `${desc} failed`
    : cmd ? `\`${commandHead(cmd)}\` failed` : 'Command failed';
  return step(label, { key: kind ?? undefined, fail, stage: kind ? 'review' : null });
}

/** @param {unknown} c string, or an argv array (Codex) @returns {string|null} the script text */
function shellCommand(c) {
  if (Array.isArray(c)) {
    const parts = c.filter((x) => typeof x === 'string');
    // ["bash", "-lc", "<script>"]: the script is what ran.
    if (parts.length >= 3 && /^(?:ba|z)?sh$/.test(basename(parts[0])) && /^-\w*c$/.test(parts[1])) return parts.slice(2).join(' ');
    return parts.join(' ') || null;
  }
  return typeof c === 'string' && c.trim() !== '' ? c : null;
}

/** First real command of a script, a few words: `cd x && git status -s` → `git status -s`. */
function commandHead(cmd) {
  const first = cmd.split('\n')[0];
  const segs = first.split(/\s*(?:&&|\|\||;|\|)\s*/).filter((x) => x.trim() !== '');
  const main = segs.find((x) => !/^(?:cd|export|set|source|\.)\s/.test(x.trim())) ?? segs[0] ?? first;
  // Up to 4 words, stopping before a quoted argument: `git commit -m "…"` → `git commit -m`.
  const head = main.trim().split(/\s+/).slice(0, 4);
  const q = head.findIndex((x) => /^['"`$(]/.test(x));
  return clipText((q > 0 ? head.slice(0, q) : head).join(' '), 36);
}

/** `mcp__XcodeBuildMCP__build_run_sim` → "XcodeBuild: build run sim". */
function mcpLabel(server, toolName) {
  const parts = server.replace(/^claude_ai_/, '').replace(/^plugin_/, '').split(/[_-]+/).filter(Boolean);
  const seen = new Set();
  const uniq = parts.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  let name = uniq.join(' ').replace(/[\s_-]*mcp$/i, '').replace(/^mcp[\s_-]*/i, '') || uniq.join(' ') || 'Tool';
  name = name.charAt(0).toUpperCase() + name.slice(1);
  let w = words(toolName);
  // `firebase_get_project` on server "firebase": drop the repeated server name.
  if (w.length > 1 && w[0].toLowerCase() === name.toLowerCase()) w = w.slice(1);
  const action = w.map((x) => (isAcronym(x) ? x : x.toLowerCase())).join(' ');
  return action ? `${name}: ${action}` : name;
}

/** Splits an identifier into words: snake_case, kebab-case and camelCase. @param {string} id */
function words(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.:/]+/)
    .filter(Boolean);
}

/** Sentence case, keeping acronyms: ["read", "LSP", "Docs"] → "Read LSP docs". @param {string[]} w */
function sentence(w) {
  return w
    .map((x, i) => (isAcronym(x) ? x : i === 0 ? x.charAt(0).toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase()))
    .join(' ');
}

/** @param {string} w */
function isAcronym(w) {
  return w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
}

/** @param {string} verb @param {string} group @param {unknown} path @param {string} none @returns {Step} */
function fileStep(verb, group, path, none) {
  const file = text(path);
  const base = file ? basename(file) : null;
  return step(base ? `${verb} ${base}` : none, { group, item: base, stage: group === 'edit' ? 'dev' : 'analyse' });
}

/**
 * @param {string} label
 * @param {{key?: string, fail?: string, group?: string|null, item?: string|null, stage?: string|null, agentName?: string|null, agentType?: string|null, agentTask?: string|null}} [o]
 * @returns {Step}
 */
function step(label, o = {}) {
  const l = clipText(label, LABEL_MAX);
  /** @type {Step} */
  const s = {
    label: l,
    fail: clipText(o.fail ?? `${l} failed`, LABEL_MAX),
    key: o.key ?? l,
    // No family: exact repeats of the same label still collapse.
    group: o.group ?? `=${l}`,
    item: o.item ?? null,
    stage: o.stage ?? null,
  };
  if (o.agentName !== undefined) {
    s.agentName = o.agentName;
    s.agentType = o.agentType ?? null;
    s.agentTask = o.agentTask ?? null;
  }
  return s;
}

const TASK_MAX = 100;
const ROLE_LINE = /^(?:you are|you're|your name is|act as|sen |siz |adın )/i;

/**
 * The first sentence of a dispatch prompt, one line, at most 100 characters.
 * @param {unknown} prompt @returns {string|null} null when there is no prompt.
 */
export function firstSentence(prompt) {
  const t = text(prompt);
  if (!t) return null;
  // A sentence ends at . ! or ? followed by whitespace and a capital: "v1.2 fix" or "e.g. this" do not split.
  const sentences = t.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  // A role line ("You are "Ajan-1".") says who the agent is, not what it was asked to do.
  const first = sentences.find((x) => !ROLE_LINE.test(x)) ?? sentences[0] ?? t;
  return clipText(first.replace(/[.]$/, ''), TASK_MAX);
}

/** One line of the agent's own text: whitespace collapsed, trimmed; null when empty. @param {unknown} v */
function text(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/**
 * @param {string} t @param {number} max
 * @returns {string} `t`, cut to `max` characters with a trailing "…".
 */
export function clipText(t, max) {
  const chars = Array.from(t);
  return chars.length <= max ? t : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

// Marker line asked for by the injected context (Task 6), e.g.
// "rail: Fix login crash — Guard the nil token. Add a retry."
// Tolerates markdown emphasis/quote prefixes. Separator: em dash, en dash or "--"
// (a lone hyphen is not accepted: it appears inside titles such as "Bump deps - again").
// Checked one line at a time (no newline-spanning whitespace), only on lines
// containing "rail:", within the first META_SCAN_CHARS of the text. Title and
// summary are split by hand: a single regex for the whole line backtracks
// cubically on crafted lines.
const META_HEAD = /^[ \t>*_`]*rail:/i;
const META_SEP = /[ \t](?:—|–|--)[ \t]/g;
const META_SCAN_CHARS = 4096;

/** @param {string} line @returns {[string, string]|null} raw [title, summary] */
function splitMarker(line) {
  const head = META_HEAD.exec(line);
  if (!head) return null;
  const rest = line.slice(head[0].length);
  META_SEP.lastIndex = 0;
  for (let m; (m = META_SEP.exec(rest));) {
    const title = rest.slice(0, m.index).trim();
    let end = rest.length;
    while (end > 0 && ' \t*_`'.includes(rest[end - 1])) end--;
    const summary = rest.slice(m.index + m[0].length, Math.max(end, m.index + m[0].length)).trim();
    if (title && summary) return [title, summary];
    META_SEP.lastIndex = m.index + 1;
  }
  return null;
}

/**
 * Parses the agent-written `rail: <title> — <summary>` marker line.
 * @param {string} text Assistant message.
 * @returns {{title: string, summary: string}|null} null when there is no marker.
 */
export function extractMeta(text) {
  if (typeof text !== 'string') return null;
  const head = text.slice(0, META_SCAN_CHARS);
  let m = null;
  for (const line of head.split('\n')) {
    if (/rail:/i.test(line) && (m = splitMarker(line.replace(/\r$/, '')))) break;
  }
  if (!m) return null;
  const title = m[0].split(/\s+/).slice(0, 6).join(' ');
  // At most two sentences: split after . ! or ? followed by whitespace.
  const summary = m[1].split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return title && summary ? { title, summary } : null;
}

/** The exact instruction injected on UserPromptSubmit (Task 6). */
export const MARKER_INSTRUCTION =
  'When you start a new task, begin your first reply with one line: "rail: <title, max 6 words> — <summary, max 2 sentences>". Do this once per task.';

/** Asks for a stage prefix on each step, and one tool call per step so the rail can follow it. */
const STAGE_NUDGE = ' Start each step title with its stage (plan:, analyse:, dev:, fix: or review:), and do each step in its own tool calls, not one long script.';

const PLAN_NUDGE = {
  claude: ' For work with more than two steps, create a task list (3–7 steps) with your task tool before starting, and keep each step\'s status updated as you go.' + STAGE_NUDGE,
  codex: ' For work with more than two steps, call update_plan with 3–7 steps before starting, and keep each step\'s status updated as you go.' + STAGE_NUDGE,
};

/** Asks the main agent to have its subagents plan too, so each agent row has its own progress. */
const AGENT_PLAN_NUDGE = ' When you dispatch agents, ask each of them to keep its own short task list (3–7 steps) updated as it works.';

/**
 * Injected into a Claude subagent on SubagentStart (hookSpecificOutput.additionalContext).
 */
export const SUBAGENT_INSTRUCTION =
  'For work with more than two steps, keep your own short task list (3–7 steps) with your task tool, and keep each step\'s status updated as you work.' + STAGE_NUDGE;

/**
 * The UserPromptSubmit instruction for one tool: the marker request plus a plan nudge.
 * @param {string|undefined} source 'claude' | 'codex'
 * @returns {string}
 */
export function railInstruction(source) {
  const nudge = PLAN_NUDGE[/** @type {'claude'|'codex'} */ (source)];
  return MARKER_INSTRUCTION + (nudge ? nudge + AGENT_PLAN_NUDGE : '');
}

const TRANSCRIPT_TAIL_LINES = 200;
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

/**
 * Finds the agent's `rail:` marker line in the tail of a transcript JSONL (Claude
 * or Codex rollout). Scans backwards over the last 200 lines and stops at the
 * latest user prompt, so a marker from an earlier turn is never picked up.
 * @param {string|null|undefined} path transcript_path from the hook payload
 * @returns {string|null} the assistant text containing the marker, or null
 */
export function findMarkerInTranscript(path) {
  if (typeof path !== 'string' || path === '') return null;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const fd = openSync(path, 'r');
    let text;
    try {
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally { closeSync(fd); }
    const lines = text.split('\n').filter(Boolean).slice(-TRANSCRIPT_TAIL_LINES);
    for (let i = lines.length - 1; i >= 0; i--) {
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      const { role, texts } = transcriptLine(o);
      if (role === 'user') return null;
      if (role !== 'assistant') continue;
      const hit = texts.find((t) => extractMeta(t));
      if (hit) return hit;
    }
  } catch { /* the transcript is a best-effort source */ }
  return null;
}

/** @returns {{role: 'user'|'assistant'|null, texts: string[]}} */
function transcriptLine(o) {
  if (!o || typeof o !== 'object') return { role: null, texts: [] };
  const parts = (c) => (typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((x) => x && typeof x.text === 'string').map((x) => x.text) : []);
  // Claude: {type:'assistant'|'user', message:{content}}
  if (o.type === 'assistant' && o.message) return { role: 'assistant', texts: parts(o.message.content) };
  if (o.type === 'user' && o.message) {
    const c = o.message.content;
    const isPrompt = typeof c === 'string' || (Array.isArray(c) && c.some((x) => x?.type === 'text'));
    return { role: isPrompt ? 'user' : null, texts: [] };
  }
  // Codex rollout: {type:'response_item', payload:{type:'message', role, content}} / {type:'event_msg', payload:{type:'agent_message'|'user_message'}}
  const p = o.payload;
  if (p && typeof p === 'object') {
    if (p.type === 'message' && (p.role === 'assistant' || p.role === 'user')) {
      // Codex also records injected context as role=user messages; only real prompts have no leading "<".
      const t = parts(p.content);
      if (p.role === 'user') return { role: t.some((x) => !x.trimStart().startsWith('<')) ? 'user' : null, texts: [] };
      return { role: 'assistant', texts: t };
    }
    if (p.type === 'agent_message' && typeof p.message === 'string') return { role: 'assistant', texts: [p.message] };
  }
  return { role: null, texts: [] };
}
