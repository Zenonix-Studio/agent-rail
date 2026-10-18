#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize as normalizeClaude } from '../core/normalize-claude.mjs';
import { normalize as normalizeCodex } from '../core/normalize-codex.mjs';

// Usage: replay.mjs <fixture.json...>
// Source is taken from the parent dir name ("codex" => codex, else claude).
// Prints the normalized event per file; once core/reduce.mjs exists, also
// reduces into a temp AGENT_RAIL_HOME and prints the final session JSON.
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: replay.mjs <fixture.json...>');
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.env.AGENT_RAIL_HOME = mkdtempSync(join(tmpdir(), 'agent-rail-replay-'));
const reducePath = join(root, 'core', 'reduce.mjs');
const reduce = existsSync(reducePath) ? (await import(reducePath)).reduce : null;
const { sessionPath, readSession, writeSession } = await import('../core/state.mjs');

for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`${basename(file)}: unreadable (${err.message})`);
    continue;
  }
  const source = basename(dirname(resolve(file))) === 'codex' ? 'codex' : 'claude';
  const n = (source === 'codex' ? normalizeCodex : normalizeClaude)(raw);
  console.log(`${source}/${basename(file)}: ${JSON.stringify(n)}`);
  if (n && reduce) {
    const path = sessionPath(source, n.sessionId);
    const next = reduce(readSession(path), { source, ...n }, new Date());
    if (next) writeSession(path, next);
  }
}

if (reduce) {
  const { readdirSync } = await import('node:fs');
  const dir = join(process.env.AGENT_RAIL_HOME, 'sessions');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) console.log(readFileSync(join(dir, f), 'utf8'));
  }
}
