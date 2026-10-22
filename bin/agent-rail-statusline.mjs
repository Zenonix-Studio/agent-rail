#!/usr/bin/env node
// Claude Code status line: one colored line for this session's current job, e.g.
// "● dev · Editing parser.mjs · 3/5 · 2m10s · ~4m left · 2 agents · 480k tok".
// Reads the status-line JSON (session_id) from stdin; prints nothing when there is no job.
// Settings: "statusLine": {"type": "command", "command": "node <path>/bin/agent-rail-statusline.mjs"}
import { eta, jobAgents, progress, readSession, runningAgents, sessionPath } from '../core/state.mjs';
import { elapsed, formatTokens, jobTokens, shortLeft, stageOf } from '../core/render-ascii.mjs';

/** Stage palette as 24-bit colors: the menubar's dark-mode hues, dev the Claude accent. */
const STAGE_RGB = { plan: [180, 154, 242], analyse: [127, 168, 240], dev: [217, 119, 87], fix: [236, 116, 108], review: [76, 194, 182] };
const color = !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const rgb = ([r, g, b], text) => paint(`38;2;${r};${g};${b}`, text);
const dim = (text) => paint('2', text);

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {import('../core/state.mjs').Session} session
 * @param {number} nowMs
 * @returns {string} the line, '' when the session has no job
 */
function statusLine(session, nowMs) {
  const jobs = Array.isArray(session?.jobs) ? session.jobs : [];
  const job = jobs[jobs.length - 1];
  if (!job || typeof job !== 'object') return '';
  const milestones = Array.isArray(job.milestones) ? job.milestones : [];
  const active = milestones.find((m) => m?.status === 'active');
  const pills = Array.isArray(job.now?.pills) ? job.now.pills : [];
  const isDone = job.status === 'done';
  const stage = stageOf(job.now?.stage) ?? stageOf(active?.stage);
  const label = (isDone ? '' : str(pills[pills.length - 1]?.label)) || (isDone ? '' : str(active?.title)) || str(job.title) || 'Untitled job';

  const head = isDone ? paint('32', '✓ done')
    : stage ? rgb(STAGE_RGB[stage], `● ${stage}`)
    : job.status === 'waiting' ? paint('33', '● waiting')
    : job.status === 'error' ? paint('31', '✗ error')
    : null;
  const parts = [label];
  const { done, total } = progress(job);
  if (total > 0) parts.push(`${done}/${total}`);
  parts.push(elapsed(job, nowMs));
  const left = isDone ? null : eta(job, nowMs);
  if (left !== null) parts.push(`~${shortLeft(left)} left`);
  const n = runningAgents(session, job.seq);
  if (n > 0) parts.push(`${n} ${n === 1 ? 'agent' : 'agents'}`);
  const tokens = jobTokens(job, jobAgents(session, job.seq));
  if (tokens > 0) parts.push(formatTokens(tokens));
  const line = parts.map((p, i) => (i === 0 ? p : dim(p))).join(dim(' · '));
  // No stage known: a plain dot leads, as the rail's now-line does without one.
  return head ? `${head}${dim(' · ')}${line}` : `${dim('●')} ${line}`;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

try {
  const input = JSON.parse((await readStdin()) || '{}');
  const id = typeof input?.session_id === 'string' ? input.session_id : '';
  const session = id ? readSession(sessionPath('claude', id)) : null;
  const line = session ? statusLine(session, Date.now()) : '';
  if (line) process.stdout.write(`${line}\n`);
} catch { /* a status line must never fail */ }
