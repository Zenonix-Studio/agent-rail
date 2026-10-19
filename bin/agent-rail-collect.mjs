#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, ensureDir, stateRoot, sessionPath, readSession, writeSession, withSessionLock } from '../core/state.mjs';
import { normalize as normalizeClaude } from '../core/normalize-claude.mjs';
import { normalize as normalizeCodex } from '../core/normalize-codex.mjs';
import { reduce, fallbackTitle } from '../core/reduce.mjs';
import { railInstruction, extractMeta, findMarkerInTranscript, findProgressInTranscript, findStepsInTranscript, agentTranscriptPath, SUBAGENT_INSTRUCTION } from '../core/flow.mjs';

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
  // A Claude subagent's `step:` lines (its task list when it has no task tools), on each of its calls and its stop.
  if (source === 'claude' && event.agentId && ((event.event?.type === 'tool' && event.event.phase === 'pre') || event.event?.type === 'agent-stop')) {
    const { steps, progress } = findStepsInTranscript(input.agent_transcript_path ?? agentTranscriptPath(input.transcript_path, event.agentId));
    if (steps.length > 0) event.event = { ...event.event, steps };
    if (progress) event.event = { ...event.event, progress };
  }
  // The main agent's `progress:` line: on its plan changes (it writes one as it starts a step) and its stop.
  const mainType = event.event?.type;
  if (!event.agentId && ['plan', 'plan-step', 'task-create', 'task-update', 'stop'].includes(mainType)) {
    const progress = findProgressInTranscript(input.transcript_path);
    if (progress) event.event = { ...event.event, progress };
  }
  const path = sessionPath(source, event.sessionId);
  withSessionLock(path, () => {
    const prev = readSession(path);
    // A newer collector owns this file: never downgrade it.
    if (typeof prev?.schema === 'number' && prev.schema > SCHEMA_VERSION) {
      logError(`skipped ${path}: schema ${prev.schema} is newer than ${SCHEMA_VERSION}`);
      return;
    }
    // Until the job is named (or a follow-up may start a new one), look for this turn's marker on each main-agent call.
    const job = Array.isArray(prev?.jobs) ? prev.jobs[prev.jobs.length - 1] : null;
    const type = event.event?.type;
    const isCall = (type === 'tool' && event.event.phase === 'pre') || type === 'plan' || type === 'plan-step' || type === 'task-create';
    if (isCall && !event.agentId
      && (typeof prev?._pendingPrompt === 'string' || (job && job.title === fallbackTitle(job.prompt))
        || (typeof prev?._turnPrompt === 'string' && job?._beforeTurn))) {
      const found = findMarkerInTranscript(input.transcript_path);
      if (found) event.event = { ...event.event, marker: found };
    }
    writeSession(path, reduce(prev, { source, ...event }, new Date()));
  }, logError);
  // Stdout carries hook context only, never anything else. UserPromptSubmit: ask the main agent
  // for the title/summary marker and a plan (spike Q5 shape, both tools).
  if (event.event?.type === 'prompt' && !event.agentId) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: railInstruction(source) },
    }));
  }
  // Claude Code adds a SubagentStart hook's context to the subagent: ask it to keep its own task list.
  if (source === 'claude' && event.event?.type === 'agent-start' && event.agentId) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: SUBAGENT_INSTRUCTION },
    }));
  }
}

try { await main(); } catch (err) { logError(err); }
process.exit(0);
