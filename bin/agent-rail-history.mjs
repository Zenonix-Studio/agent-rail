#!/usr/bin/env node
// The last 50 finished jobs across sessions, newest first, like the menubar's history.
// `agent-rail-history.mjs` lists them numbered; `agent-rail-history.mjs <n>` shows job n in full.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { jobAgents, readSession, stateRoot } from '../core/state.mjs';
import { duration, formatTokens, jobTokens, renderJob } from '../core/render-ascii.mjs';

const LIMIT = 50;
const dir = join(stateRoot(), 'sessions');
let files = [];
try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* no sessions yet */ }

const items = [];
for (const f of files) {
  const s = readSession(join(dir, f));
  for (const job of s?.jobs ?? []) if (job?.status === 'done') items.push({ s, job, ended: Date.parse(job.endedAt ?? job.updatedAt) || 0 });
}
items.sort((a, b) => b.ended - a.ended);
const list = items.slice(0, LIMIT);

const project = (s) => s.project || s.source || '';
const title = (job) => job.title || job.prompt || 'Untitled job';
const when = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// A sentence ends before a capital letter: "6. tur" stays whole.
const firstSentence = (t) => (t ?? '').split(/(?<=[.!?])\s+(?=\p{Lu})/u)[0];

const n = Number.parseInt(process.argv[2] ?? '', 10);
if (list.length === 0) {
  console.log('No finished jobs yet.');
} else if (Number.isInteger(n)) {
  const it = list[n - 1];
  if (!it) {
    console.log(`No job #${n}: the history has ${list.length}.`);
  } else {
    const { s, job } = it;
    console.log(`#${n} · ${when(it.ended)} · ${project(s)}`);
    const prompt = (job.prompt ?? '').replace(/\s+/g, ' ').trim();
    if (prompt) console.log(`Prompt: ${prompt.length > 200 ? `${prompt.slice(0, 199)}…` : prompt}`);
    console.log('');
    for (const line of renderJob(job, 100, it.ended, jobAgents(s, job.seq), { expandAll: true })) console.log(line);
  }
} else {
  const pad = String(list.length).length;
  list.forEach(({ s, job, ended }, i) => {
    const tok = jobTokens(job, jobAgents(s, job.seq));
    const meta = [when(ended), project(s), duration(ended - (Date.parse(job.startedAt) || ended)), tok > 0 ? formatTokens(tok) : null].filter(Boolean).join(' · ');
    console.log(`${String(i + 1).padStart(pad)}. ${title(job)}  (${meta})`);
    const p = firstSentence(job.progress);
    if (p) console.log(`${' '.repeat(pad + 2)}${p}`);
  });
}
