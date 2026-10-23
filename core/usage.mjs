import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';

/** Message ids kept per transcript to skip a message's later lines; one message spans a few lines. */
const MAX_IDS = 50;

/**
 * @typedef {{ input: number, cacheRead: number, cacheWrite: number, output: number }} Tokens
 * @typedef {{ offset: number, ids: string[] }} Cursor where the last read of a transcript stopped
 */

/**
 * Token usage a Claude transcript (or a Codex rollout) gained since `cursor`: reads only the bytes after `cursor.offset`, up to
 * the last complete line. Each API message (`message.id`) counts once, however many lines it spans.
 * @param {string|null|undefined} path
 * @param {Cursor|undefined} cursor
 * @param {boolean} isMain the session's own transcript: its sidechain lines are skipped
 * @returns {{ path: string, cursor: Cursor, tokens: Tokens } | null} null when unreadable or nothing new
 */
export function readUsage(path, cursor, isMain) {
  if (typeof path !== 'string' || !path) return null;
  let offset = Number.isInteger(cursor?.offset) && cursor.offset >= 0 ? cursor.offset : 0;
  const ids = Array.isArray(cursor?.ids) ? cursor.ids.filter((x) => typeof x === 'string') : [];
  let buf;
  try {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      // A shorter file was rewritten: start over.
      if (size < offset) { offset = 0; ids.length = 0; }
      if (size === offset) return null;
      buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
    } finally { closeSync(fd); }
  } catch { return null; }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end === 0) return null;
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    const isCodex = line.includes('"token_count"');
    if (!isCodex && !line.includes('"usage"')) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    // Codex: one `token_count` event per model call, its own use in `last_token_usage`. A repeat
    // (same running total) is skipped; `input_tokens` includes the cached part.
    if (isCodex) {
      const info = m?.type === 'event_msg' && m.payload?.type === 'token_count' ? m.payload.info : null;
      const last = info?.last_token_usage;
      if (!last || typeof last !== 'object') continue;
      const key = `codex:${num(info.total_token_usage?.total_tokens)}`;
      if (ids.includes(key)) continue;
      ids.push(key);
      tokens.input += Math.max(0, num(last.input_tokens) - num(last.cached_input_tokens));
      tokens.cacheRead += num(last.cached_input_tokens);
      tokens.cacheWrite += num(last.cache_write_input_tokens);
      tokens.output += num(last.output_tokens);
      continue;
    }
    // Older Claude Code also wrote subagent lines into the main transcript; they count in the agent's own file.
    if (m?.type !== 'assistant' || (isMain && m.isSidechain === true)) continue;
    const u = m.message?.usage;
    const id = m.message?.id;
    if (!u || typeof u !== 'object') continue;
    if (typeof id === 'string') {
      if (ids.includes(id)) continue;
      ids.push(id);
    }
    tokens.input += num(u.input_tokens);
    tokens.cacheRead += num(u.cache_read_input_tokens);
    tokens.cacheWrite += num(u.cache_creation_input_tokens);
    tokens.output += num(u.output_tokens);
  }
  return { path, cursor: { offset: offset + end, ids: ids.slice(-MAX_IDS) }, tokens };
}

/**
 * A cursor at the end of a transcript, with no usage: where counting starts for a file seen mid-session.
 * @param {string} path @returns {{ path: string, cursor: Cursor, tokens: Tokens } | null}
 */
export function usageStart(path) {
  try {
    return { path, cursor: { offset: statSync(path).size, ids: [] }, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } };
  } catch { return null; }
}

/** @param {unknown} v */
function num(v) {
  return Number.isFinite(v) && v > 0 ? v : 0;
}
