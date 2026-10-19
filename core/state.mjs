import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * State contract, documented in docs/state-schema.md. Fields starting with `_`
 * are the collector's internal bookkeeping: readers MUST ignore them, and any
 * field they do not know.
 * @typedef {'ok'|'warn'|'active'|'info'} PillKind
 * @typedef {'plan'|'analyse'|'dev'|'fix'|'review'} Stage
 * @typedef {{ label: string, kind: PillKind, stage?: Stage, _run?: object }} Pill `label` is a human step ("Editing LoginView.swift"); `_run` is the collapsed run behind it.
 * @typedef {{ milestone: string, pills: Pill[], attempt: number, file: string|null, stage?: Stage|null }} Now
 * @typedef {{ key: string, title: string, status: 'pending'|'active'|'done', stage?: Stage, startedAt?: string, endedAt?: string, _activeForm?: string, _fixedStage?: boolean, _stages?: Record<string, number> }} Milestone
 * @typedef {{
 *   id: string, seq: number, title: string, summary: string, prompt: string,
 *   status: 'planning'|'running'|'waiting'|'done'|'error',
 *   milestones: Milestone[], startedAt: string, updatedAt: string,
 *   endedAt: string|null, now: Now|null
 * }} Job
 * @typedef {{
 *   id: string, name: string, status: 'running'|'done'|'error'|'stale',
 *   activity: string, summary: string, milestones: Milestone[], steps: Pill[], stage?: Stage|null,
 *   job: number|null, startedAt: string, updatedAt: string, endedAt: string|null,
 *   _type?: string|null, _open?: string[]
 * }} Agent `name`: the dispatch description, else the agent type. `job` is the seq of the job the agent started in.
 *   `startedAt`: when it was first seen; agents are listed in this order.
 *   `summary`: what it was asked to do. `milestones`: its own plan. `steps`: its own story, the last 6 pills.
 * @typedef {{
 *   schema: 1, source: 'claude'|'codex', sessionId: string, cwd: string,
 *   project: string, updatedAt: string, jobs: Job[],
 *   agents: Record<string, Agent>, _pendingPrompt: string|null, _turnPrompt?: string|null, _dispatch?: object[]
 * }} Session
 */

/** Schema this collector writes. Additive changes keep it; breaking changes increment it. */
export const SCHEMA_VERSION = 1;

/** @returns {string} `$AGENT_RAIL_HOME` or `~/.agent-rail`. */
export function stateRoot() {
  return process.env.AGENT_RAIL_HOME || join(homedir(), '.agent-rail');
}

/**
 * @param {'claude'|'codex'} source
 * @param {string} sessionId
 * @returns {string} `<root>/sessions/<source>-<safeId>.json`
 */
export function sessionPath(source, sessionId) {
  const safeId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(stateRoot(), 'sessions', `${source}-${safeId}.json`);
}

let rootLocked = false;

/**
 * Creates `dir` (and parents) owner-only, and once per process tightens the
 * state root to 0700 in case an older build created it world-readable.
 * @param {string} dir
 * @returns {void}
 */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (rootLocked) return;
  rootLocked = true;
  try { chmodSync(stateRoot(), 0o700); } catch { /* root may sit elsewhere; best effort */ }
}

/**
 * @param {string} path
 * @returns {Session|null} null when the file is missing or not valid JSON.
 */
export function readSession(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Atomically replaces the session file. The temp name includes the pid so
 * concurrent writers never share a temp file; rename is atomic on POSIX.
 * @param {string} path
 * @param {Session} session
 * @returns {void}
 */
export function writeSession(path, session) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* temp may not exist */ }
    throw err;
  }
}

export { progress, runningAgents, jobAgents, eta, stepDuration } from './progress.mjs';

const LOCK_WAIT_MS = 400;
const LOCK_STALE_MS = 2000;
const LOCK_POLL_MS = 5;

/**
 * Runs `fn` while holding `<path>.lock` (exclusive create). Waits up to ~400 ms,
 * steals locks older than ~2 s, and after the deadline runs `fn` unlocked.
 * @template T
 * @param {string} path Session file path.
 * @param {() => T} fn
 * @param {(msg: string) => void} [warn] Called once if the lock could not be taken.
 * @returns {T}
 */
export function withSessionLock(path, fn, warn) {
  const lock = `${path}.lock`;
  ensureDir(dirname(path));
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = openSync(lock, 'wx', 0o600);
    } catch (err) {
      if (err?.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { unlinkSync(lock); continue; }
      } catch { continue; /* lock vanished; retry */ }
      if (Date.now() >= deadline) break;
      Atomics.wait(sleeper, 0, 0, LOCK_POLL_MS);
    }
  }
  if (fd === null) warn?.(`could not acquire ${lock}; proceeding unlocked`);
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
      try { unlinkSync(lock); } catch { /* ignore */ }
    }
  }
}
