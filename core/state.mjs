import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * @typedef {'ok'|'warn'|'active'|'info'} PillKind
 * @typedef {{ label: string, kind: PillKind }} Pill
 * @typedef {{ milestone: string, pills: Pill[], attempt: number, file: string|null }} Now
 * @typedef {{ key: string, title: string, status: 'pending'|'active'|'done' }} Milestone
 * @typedef {{
 *   id: string, seq: number, title: string, summary: string, prompt: string,
 *   status: 'planning'|'running'|'waiting'|'done'|'error',
 *   milestones: Milestone[], startedAt: string, updatedAt: string,
 *   endedAt: string|null, now: Now|null
 * }} Job
 * @typedef {{
 *   id: string, name: string, status: 'running'|'done'|'error',
 *   activity: string, updatedAt: string
 * }} Agent
 * @typedef {{
 *   schema: 1, source: 'claude'|'codex', sessionId: string, cwd: string,
 *   project: string, updatedAt: string, jobs: Job[],
 *   agents: Record<string, Agent>, pendingPrompt: string|null
 * }} Session
 */

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
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n');
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* temp may not exist */ }
    throw err;
  }
}

/**
 * @param {Job} job A job without a `milestones` array counts as 0/0.
 * @returns {{done: number, total: number, pct: number|null}}
 */
export function progress(job) {
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const total = milestones.length;
  const done = milestones.filter((m) => m?.status === 'done').length;
  return { done, total, pct: total === 0 ? null : Math.round((100 * done) / total) };
}
