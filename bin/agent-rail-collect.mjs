#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, ensureDir, stateRoot, sessionPath, readSession, writeSession, withSessionLock } from '../core/state.mjs';
import { normalize as normalizeClaude } from '../core/normalize-claude.mjs';
import { normalize as normalizeCodex } from '../core/normalize-codex.mjs';
import { reduce } from '../core/reduce.mjs';
import { railInstruction, extractMeta, findMarkerInTranscript } from '../core/flow.mjs';

const normalizers = { claude: normalizeClaude, codex: normalizeCodex };

function logError(err) {
  try {
    const root = stateRoot();
    ensureDir(root);
    appendFileSync(join(root, 'collector.log'), `${new Date().toISOString()} ${err?.stack ?? err}\n`, { mode: 0o600 });
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
    ensureDir(dir);
    appendFileSync(join(dir, `${source ?? 'unknown'}.jsonl`), JSON.stringify({ argv, stdin }) + '\n', { mode: 0o600 });
    return;
  }
  const normalizer = normalizers[source];
  if (!normalizer) throw new Error(`unknown --source: ${source}`);
  const input = JSON.parse(raw);
  const event = normalizer(input);
  if (!event) return;
  // Stop's last message is the end of the turn; the marker is in the first reply, so read the transcript.
  if (event.event?.type === 'stop' && !extractMeta(event.event.lastMessage)) {
    const found = findMarkerInTranscript(input.transcript_path);
    if (found) event.event = { ...event.event, lastMessage: found };
  }
  const path = sessionPath(source, event.sessionId);
  withSessionLock(path, () => {
    const prev = readSession(path);
    // A newer collector owns this file: never downgrade it.
    if (typeof prev?.schema === 'number' && prev.schema > SCHEMA_VERSION) {
      logError(`skipped ${path}: schema ${prev.schema} is newer than ${SCHEMA_VERSION}`);
      return;
    }
    writeSession(path, reduce(prev, { source, ...event }, new Date()));
  }, logError);
  // The only stdout output: ask the agent to write the title/summary marker (spike Q5 shape, both tools).
  if (event.event?.type === 'prompt' && !event.agentId) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: railInstruction(source) },
    }));
  }
}

try { await main(); } catch (err) { logError(err); }
process.exit(0);
