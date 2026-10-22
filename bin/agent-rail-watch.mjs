#!/usr/bin/env node
// A live rail in a terminal split, for Codex (which runs no Claude Code mod) or any session:
// redraws the session's current job each second, the way the desktop pane does.
//   agent-rail-watch.mjs            the most recently active Codex session, followed as it changes
//   agent-rail-watch.mjs claude     the same for Claude Code; `any` for either source
//   agent-rail-watch.mjs <id>       one session, by the start of its id
// `--agents` expands every agent row. Ctrl+C quits.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { jobAgents, readSession, stateRoot } from '../core/state.mjs';
import { renderJobSegments } from '../core/render-ascii.mjs';

const POLL_MS = 1000;
const args = process.argv.slice(2);
const expandAll = args.includes('--agents');
const target = args.find((a) => !a.startsWith('--')) ?? 'codex';
const dir = join(stateRoot(), 'sessions');

const color = !process.env.NO_COLOR;
const rgb = (r, g, b) => `38;2;${r};${g};${b}`;
/** The pane's tones as ANSI: the menubar's dark-mode stage hues, dev the Claude accent. */
const TONE = {
  bold: '1', dim: '2', done: '32', warn: '33', error: '31', fix: '31',
  active: rgb(217, 119, 87), dev: rgb(217, 119, 87),
  plan: rgb(180, 154, 242), analyse: rgb(127, 168, 240), review: rgb(76, 194, 182),
};
const paint = (tone, text) => (color && TONE[tone] ? `\x1b[${TONE[tone]}m${text}\x1b[0m` : text);

/** The session file to draw: by id prefix, or the newest of a source. */
function pick() {
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  const byId = files.filter((f) => f.replace(/^[a-z]+-/, '').startsWith(target));
  const pool = ['codex', 'claude', 'any'].includes(target)
    ? files.filter((f) => target === 'any' || f.startsWith(`${target}-`))
    : byId;
  let best = null;
  for (const f of pool) {
    const m = statSync(join(dir, f)).mtimeMs;
    if (!best || m > best.m) best = { f, m };
  }
  return best && join(dir, best.f);
}

let last = '';
function draw() {
  const now = Date.now();
  const cols = Math.max(20, (process.stdout.columns || 80) - 1);
  const path = pick();
  const s = path && readSession(path);
  const job = Array.isArray(s?.jobs) && s.jobs.length ? s.jobs[s.jobs.length - 1] : null;
  const head = paint('dim', s ? [s.source, s.project, String(s.sessionId ?? '').slice(0, 8)].filter(Boolean).join(' · ') : `agent-rail watch: no ${target} session yet`);
  const body = job
    ? renderJobSegments(job, cols, now, jobAgents(s, job.seq), { expandAll }).map((line) => line.map((seg) => paint(seg.tone, seg.text)).join(''))
    : [paint('dim', 'No job yet in this session.')];
  const out = [head, '', ...body].join('\n');
  if (out === last) return;
  last = out;
  // Home, then each line cleared to its end, then the rest of the screen: no flicker between frames.
  process.stdout.write(`\x1b[H${out.split('\n').map((l) => `${l}\x1b[K`).join('\n')}\x1b[J`);
}

process.stdout.write('\x1b[?25l\x1b[2J');
const quit = () => { process.stdout.write('\x1b[?25h\n'); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.stdout.on('resize', () => { last = ''; process.stdout.write('\x1b[2J'); draw(); });
draw();
setInterval(draw, POLL_MS);
