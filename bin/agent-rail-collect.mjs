#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SCHEMA_VERSION, ensureDir, stateRoot, sessionPath, readSession, writeSession, withSessionLock, sweepOldSessions } from '../core/state.mjs';
import { normalize as normalizeClaude } from '../core/normalize-claude.mjs';
import { normalize as normalizeCodex } from '../core/normalize-codex.mjs';
import { reduce, fallbackTitle } from '../core/reduce.mjs';
import { readUsage, usageStart } from '../core/usage.mjs';
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

/** The nearest `claude` or `codex` ancestor of this hook: its pid and start time (pid reuse check). */
function agentProcess() {
  try {
    let pid = process.ppid;
    for (let i = 0; i < 6 && pid > 1; i++) {
      const [ppid, ...comm] = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
      if (/^(claude|codex)$/.test(comm.join(' ').split('/').pop() ?? '')) {
        return { pid, start: execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() };
      }
      pid = Number(ppid);
    }
  } catch { /* no ps, or the process is gone: nothing to record */ }
  return null;
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
  // The main agent's summary comes in its plan call's input; a `progress:` line in its transcript is the
  // fallback (Codex, older prompts), read on its plan changes and its stop.
  const mainType = event.event?.type;
  if (!event.agentId && !event.event?.progress && ['plan', 'plan-step', 'task-create', 'task-update', 'stop'].includes(mainType)) {
    const progress = findProgressInTranscript(input.transcript_path);
    if (progress) event.event = { ...event.event, progress };
  }
  // On a prompt, the agent process these hooks run under, so the menubar can stop the session.
  if (event.event?.type === 'prompt' && !event.agentId) {
    const proc = agentProcess();
    if (proc) event.event = { ...event.event, proc };
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
    // Token usage since the last hook: only the transcripts' new bytes, from cursors kept in the session.
    if (source === 'claude') {
      const cursors = prev?._usage && typeof prev._usage === 'object' ? prev._usage : {};
      // Hooks installed mid-session: the main transcript's earlier usage belongs to no job here, so start at its end.
      const midSession = Array.isArray(prev?.jobs) && prev.jobs.length > 0;
      const read = (p, agent) => {
        const skip = agent === null && midSession && typeof p === 'string' && !cursors[p];
        const u = skip ? usageStart(p) : readUsage(p, cursors[p], agent === null);
        return u ? [{ ...u, agent }] : [];
      };
      const usage = [...read(input.transcript_path, null),
        ...(event.agentId ? read(input.agent_transcript_path ?? agentTranscriptPath(input.transcript_path, event.agentId), event.agentId) : [])];
      if (usage.length) event.event = { ...event.event, usage };
    }
    writeSession(path, reduce(prev, { source, ...event }, new Date()));
  }, logError);
  sweepOldSessions();
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
