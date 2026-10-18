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
// Tolerates markdown emphasis/quote prefixes and an en dash or "-" separator.
const META = /^[\s>*_`]*rail:\s*(.+?)\s+(?:—|–|--|-)\s+(.+?)[\s*_`]*$/im;

/**
 * Parses the agent-written `rail: <title> — <summary>` marker line.
 * @param {string} text Assistant message.
 * @returns {{title: string, summary: string}|null} null when there is no marker.
 */
export function extractMeta(text) {
  if (typeof text !== 'string') return null;
  const m = META.exec(text);
  if (!m) return null;
  const title = m[1].trim();
  const summary = m[2].trim();
  return title && summary ? { title, summary } : null;
}
