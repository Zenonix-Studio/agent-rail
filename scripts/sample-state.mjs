#!/usr/bin/env node
// Writes sample session files for the menubar app into <dir>/sessions/,
// with timestamps relative to the current time (stale / done-today stay true any day).
// Usage: node scripts/sample-state.mjs <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('usage: sample-state.mjs <dir>');
  process.exit(2);
}
const dir = join(resolve(out), 'sessions');
mkdirSync(dir, { recursive: true });

const MIN = 60_000;
const t = (ago) => new Date(Date.now() - ago * MIN).toISOString();
const ms = (key, title, status) => ({ key, title, status });
const pill = (label, kind) => ({ label, kind });

function job(source, sid, seq, o) {
  return {
    id: `${source}:${sid}:${seq}`, seq, title: '', summary: '', prompt: '', status: 'running',
    milestones: [], startedAt: t(30), updatedAt: t(1), endedAt: null, now: null, ...o,
  };
}
function session(source, sid, o) {
  return {
    schema: 1, source, sessionId: sid, cwd: `/work/${o.project}`, updatedAt: t(1), jobs: [], agents: {}, ...o,
  };
}
const write = (name, value) =>
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');

write('claude-run.json', session('claude', 'run', {
  project: 'login-app', updatedAt: t(1),
  jobs: [job('claude', 'run', 1, {
    title: 'Fix login flow', summary: 'Repair the sign-in screen.', prompt: 'Fix the login flow',
    milestones: [ms('1', 'Read code', 'done'), ms('2', 'Update model', 'done'), ms('3', 'Add validation', 'done'),
      ms('4', 'Edit login view', 'active'), ms('5', 'Verify', 'pending')],
    updatedAt: t(1),
    now: { milestone: '4', pills: [pill('Build ok', 'ok'), pill('Build failed', 'warn'), pill('Edit LoginView.swift', 'active')], attempt: 2, file: 'LoginView.swift' },
  })],
  agents: {
    a1: { id: 'a1', name: 'Explore', status: 'running', activity: 'Reading Auth.swift', job: 1, updatedAt: t(1), endedAt: null },
    a2: { id: 'a2', name: 'worker', status: 'done', activity: 'Finished', job: 1, updatedAt: t(8), endedAt: t(8) },
  },
}));

write('codex-run.json', session('codex', 'run', {
  project: 'api-server', updatedAt: t(3),
  jobs: [job('codex', 'run', 1, {
    title: 'Add rate limiting', prompt: 'Add rate limiting',
    milestones: [ms('a', 'Design', 'done'), ms('b', 'Middleware', 'done'), ms('c', 'Config', 'active'),
      ms('d', 'Docs', 'pending'), ms('e', 'Tests', 'pending'), ms('f', 'Cleanup', 'pending')],
    updatedAt: t(3),
    now: { milestone: 'c', pills: [pill('Read', 'info')], attempt: 1, file: null },
  })],
}));

write('claude-wait.json', session('claude', 'wait', {
  project: 'docs-site', updatedAt: t(6),
  jobs: [job('claude', 'wait', 1, {
    title: 'Rewrite onboarding docs', status: 'waiting', prompt: 'Rewrite the onboarding docs',
    milestones: [ms('1', 'Outline', 'done'), ms('2', 'Draft', 'done'), ms('3', 'Review', 'done'),
      ms('4', 'Polish', 'done'), ms('5', 'Publish', 'pending')],
    updatedAt: t(6),
    now: { milestone: '', pills: [pill('Edit intro.md', 'ok')], attempt: 1, file: 'intro.md' },
  })],
}));

write('claude-plan.json', session('claude', 'plan', {
  project: 'notes', updatedAt: t(1),
  jobs: [job('claude', 'plan', 1, {
    title: 'Plan the refactor', status: 'planning', prompt: 'Plan the refactor', updatedAt: t(2),
    now: { milestone: '', pills: [pill('Read', 'active')], attempt: 0, file: null },
  })],
}));

write('claude-stale.json', session('claude', 'stale', {
  project: 'legacy', updatedAt: t(120),
  jobs: [job('claude', 'stale', 1, {
    title: 'Migrate settings', prompt: 'Migrate settings', startedAt: t(180), updatedAt: t(120),
    milestones: [ms('1', 'Inventory', 'done'), ms('2', 'Migrate', 'active')],
    now: { milestone: '2', pills: [pill('Edit Settings.swift', 'active')], attempt: 1, file: 'Settings.swift' },
  })],
}));

write('claude-done.json', session('claude', 'done', {
  project: 'shipped', updatedAt: t(5),
  jobs: [job('claude', 'done', 1, {
    title: 'Ship release notes', status: 'done', prompt: 'Ship release notes', startedAt: t(20), updatedAt: t(5), endedAt: t(5),
    milestones: [ms('1', 'Write', 'done')],
  })],
}));

// A collector that joined mid-session: no title and no prompt, so the row falls back to the project.
write('claude-untitled.json', session('claude', 'untitled', {
  project: 'late-joiner', updatedAt: t(2),
  jobs: [job('claude', 'untitled', 1, {
    milestones: [ms('1', 'Read', 'done'), ms('2', 'Edit', 'active')], updatedAt: t(2),
    now: { milestone: '2', pills: [pill('Edit Late.swift', 'active')], attempt: 1, file: 'Late.swift' },
  })],
}));

write('broken.json', '{"sch');

write('claude-future.json', { ...session('claude', 'future', { project: 'future', jobs: [] }), schema: 2 });

write('claude-exploded.json', session('claude', 'exploded', {
  project: 'weird', updatedAt: t(4),
  jobs: [job('claude', 'exploded', 1, {
    title: 'Unknown things', status: 'exploded', prompt: 'x', updatedAt: t(4),
    now: { milestone: '', pills: [pill('Sparkle', 'sparkle')], attempt: 1, file: null },
  })],
}));

console.log(`wrote 10 sample files to ${dir}`);
