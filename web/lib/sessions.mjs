import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function railHome() {
  if (process.env.AGENT_RAIL_HOME) return process.env.AGENT_RAIL_HOME;
  return join(process.env.HOME || process.env.USERPROFILE || '.', '.agent-rail');
}

export function sessionFiles(home = railHome()) {
  const dir = join(home, 'sessions');
  try { return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)); } catch { return []; }
}

export function loadSessions(home = railHome()) {
  const out = [];
  for (const f of sessionFiles(home)) {
    try { out.push(JSON.parse(readFileSync(f, 'utf8'))); } catch {}
  }
  return out;
}

/** The weekly rate-limit reading the pane mod writes (`limits.json`); null before any reading. */
export function loadLimits(home = railHome()) {
  try { return JSON.parse(readFileSync(join(home, 'limits.json'), 'utf8')); } catch { return null; }
}

/** A fingerprint of the session files (names, sizes, mtimes): changes when any file does. */
export function signature(home = railHome()) {
  return sessionFiles(home).map((f) => { try { const s = statSync(f); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return f; } }).join('|');
}

/**
 * Whether the session's agent process is still the one the collector saw: same pid, same start time and a
 * `claude` or `codex` executable. The collector records it with `ps`, so there is none on Windows.
 */
export function procRunning(proc) {
  if (!proc || !(proc.pid > 1) || !proc.start || process.platform === 'win32') return false;
  // `lstart` follows the locale; the collector's hook ran in its own, so try C and ours.
  for (const env of [{ ...process.env, LC_ALL: 'C' }, process.env]) {
    try {
      const line = execFileSync('ps', ['-o', 'lstart=', '-o', 'comm=', '-p', String(proc.pid)], { encoding: 'utf8', env }).trim();
      const name = line.slice(proc.start.length).trim().split('/').pop();
      if (line.startsWith(proc.start) && (name === 'claude' || name === 'codex')) return true;
    } catch {}
  }
  return false;
}

/** SIGTERM, as Ctrl+C's sibling: the CLI exits and its subagents with it. */
export function stopProc(proc) {
  try { return procRunning(proc) && process.kill(proc.pid, 'SIGTERM'); } catch { return false; }
}
