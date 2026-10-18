import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const TEST = /xcodebuild test|swift test|npm test|pytest|vitest|jest|cargo test|go test/;
const BUILD = /xcodebuild|swift build|npm run build|pnpm build|yarn build|make\b|gradle|cargo build|tsc\b/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'apply_patch']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/**
 * Maps a tool call to the short label used for "right now" pills.
 * @param {string} name Tool name as sent by the agent.
 * @param {unknown} input Raw `tool_input`.
 * @returns {string} `Test`, `Build`, `Edit <basename>`, `Read`, or the tool name.
 */
export function classifyTool(name, input) {
  const tool = typeof name === 'string' && name !== '' ? name : 'tool';
  const args = input && typeof input === 'object' ? /** @type {any} */ (input) : {};

  if (EDIT_TOOLS.has(tool)) {
    const file = tool === 'apply_patch' ? patchFile(args.command) : args.file_path;
    return typeof file === 'string' && file !== '' ? `Edit ${basename(file)}` : 'Edit';
  }
  if (READ_TOOLS.has(tool)) return 'Read';

  const cmd = Array.isArray(args.command) ? args.command.join(' ') : args.command;
  if (typeof cmd === 'string') {
    if (TEST.test(cmd)) return 'Test';
    if (BUILD.test(cmd)) return 'Build';
  }
  return tool;
}

/** @param {unknown} patch apply_patch text @returns {string|null} first file it touches */
function patchFile(patch) {
  if (typeof patch !== 'string') return null;
  return /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch)?.[1]?.trim() ?? null;
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
