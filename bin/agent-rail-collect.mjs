#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot, sessionPath, readSession, writeSession } from '../core/state.mjs';
import { normalize as normalizeClaude } from '../core/normalize-claude.mjs';
import { normalize as normalizeCodex } from '../core/normalize-codex.mjs';
import { reduce } from '../core/reduce.mjs';

const normalizers = { claude: normalizeClaude, codex: normalizeCodex };

function logError(err) {
  try {
    const root = stateRoot();
    mkdirSync(root, { recursive: true });
    appendFileSync(join(root, 'collector.log'), `${new Date().toISOString()} ${err?.stack ?? err}\n`);
  } catch { /* logging must never fail a hook */ }
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const source = flag('--source');
  const raw = await readStdin();
  if (argv.includes('--capture')) {
    let stdin;
    try { stdin = JSON.parse(raw); } catch { stdin = { _raw: raw }; }
    const dir = join(stateRoot(), 'capture');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${source ?? 'unknown'}.jsonl`), JSON.stringify({ argv, stdin }) + '\n');
    return;
  }
  const normalizer = normalizers[source];
  if (!normalizer) throw new Error(`unknown --source: ${source}`);
  const input = JSON.parse(raw);
  const event = normalizer(input);
  if (!event) return;
  const path = sessionPath(source, event.sessionId);
  const session = reduce(readSession(path), { source, ...event }, new Date());
  writeSession(path, session);
}

try { await main(); } catch (err) { logError(err); }
process.exit(0);
