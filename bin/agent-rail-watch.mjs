#!/usr/bin/env node
// A live rail in a terminal split, for Codex (which runs no Claude Code mod) or any session:
// redraws the session's current job each second, the way the desktop pane does.
//   agent-rail-watch.mjs            the most recently active Codex session, followed as it changes
//   agent-rail-watch.mjs claude     the same for Claude Code; `any` for either source
//   agent-rail-watch.mjs <id>       one session, by the start of its id
// `--agents` expands every agent row. n / h / s switch to Now, History, Stats. q or Ctrl+C quits.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Tabs as in the Claude pane: n Now, h History, s Stats. History and Stats are agent-rail-history's output.
const TABS = [['now', 'Now'], ['history', 'History'], ['stats', 'Stats']];
let page = 'now';
const historyScript = join(dirname(fileURLToPath(import.meta.url)), 'agent-rail-history.mjs');
let cached = { page: '', at: 0, lines: [] };
// ponytail: one child process per 5 s on those tabs; read the files in-process if that ever shows up.
function historyLines(now) {
  if (cached.page !== page || now - cached.at > 5000) {
    let text = '';
    try { text = execFileSync(process.execPath, [historyScript, ...(page === 'stats' ? ['stats'] : [])], { encoding: 'utf8' }); } catch { text = 'Could not read the history.'; }
    cached = { page, at: now, lines: text.trimEnd().split('\n') };
  }
  return cached.lines;
}

let last = '';
function draw() {
  const now = Date.now();
  const cols = Math.max(20, (process.stdout.columns || 80) - 1);
  const rows = Math.max(5, process.stdout.rows || 40);
  const tabs = TABS.map(([id, label]) => paint(id === page ? 'active' : 'dim', `[ ${label} ]`)).join(' ') + paint('dim', '   n · h · s');
  let lines;
  if (page === 'now') {
    const path = pick();
    const s = path && readSession(path);
    const job = Array.isArray(s?.jobs) && s.jobs.length ? s.jobs[s.jobs.length - 1] : null;
    const head = paint('dim', s ? [s.source, s.project, String(s.sessionId ?? '').slice(0, 8)].filter(Boolean).join(' · ') : `agent-rail watch: no ${target} session yet`);
    const body = job
      ? renderJobSegments(job, cols, now, jobAgents(s, job.seq), { expandAll }).map((line) => line.map((seg) => paint(seg.tone, seg.text)).join(''))
      : [paint('dim', 'No job yet in this session.')];
    lines = [head, '', ...body];
  } else {
    // Longer than the screen: the newest stay in view.
    lines = historyLines(now).slice(0, rows - 3).map((l) => (l.length > cols ? `${l.slice(0, cols - 1)}…` : l));
  }
  const out = [tabs, '', ...lines].join('\n');
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
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on('data', (b) => {
    const k = b.toString().toLowerCase();
    if (k === '\x03' || k === 'q') quit();
    const next = { n: 'now', h: 'history', s: 'stats' }[k];
    if (next && next !== page) { page = next; last = ''; process.stdout.write('\x1b[2J'); draw(); }
  });
}
draw();
setInterval(draw, POLL_MS);
