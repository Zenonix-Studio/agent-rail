#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
    const dir = join(homedir(), '.agent-rail', 'capture');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${source ?? 'unknown'}.jsonl`), JSON.stringify({ argv, stdin }) + '\n');
  }
}

try { await main(); } catch { /* never fail a hook */ }
process.exit(0);
