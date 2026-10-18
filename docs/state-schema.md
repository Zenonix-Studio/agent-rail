# agent-rail state schema (v1)

The collector (`bin/agent-rail-collect.mjs`) keeps one JSON file per agent
session at `~/.agent-rail/sessions/<source>-<sessionId>.json` (or under
`$AGENT_RAIL_HOME`). Viewers (the Claude Code mod, the menubar app, the web
page) only read these files. This document is the contract between the two;
the JSDoc typedefs in `core/state.mjs` mirror it.

The directory is created with mode `0700` and each file is written atomically
(temp file + rename) with mode `0600`. A reader may see the old file or the new
one, never a half-written one.

## Rules for readers

- Readers **MUST ignore every field whose name starts with `_`**. These are the
  collector's bookkeeping (pairing tool calls, pending split decisions). They
  can change or disappear in any version without a schema bump.
- Readers **MUST ignore unknown fields**. New fields are added without notice.
- Readers should check `schema` and skip a file whose `schema` is higher than
  the version they understand.

## Versioning

- `schema` is an integer, currently `1`.
- **Additive changes** (a new field, a new optional value a reader can ignore)
  keep `schema: 1`.
- **Breaking changes** (a field removed, renamed, retyped, or its meaning
  changed) increment `schema`.
- The collector never rewrites a file whose `schema` is higher than the one it
  writes. It skips the event and logs one line to `collector.log`.

Timestamps are ISO 8601 strings in UTC (`2026-10-18T10:00:00.000Z`).

## Session

The top-level object of a session file.

| Field | Type | Meaning |
|---|---|---|
| `schema` | `1` | Schema version of this file (see Versioning). |
| `source` | `'claude' \| 'codex'` | Which agent tool wrote the session. |
| `sessionId` | `string` | The agent's own session (Claude) or thread (Codex) id. |
| `cwd` | `string` | Working directory of the session's first event. |
| `project` | `string` | Basename of `cwd`, for display. `''` when `cwd` is unknown. |
| `updatedAt` | `string` | Time of the last event folded into this file. |
| `jobs` | `Job[]` | Jobs in order of `seq`. The last one is the current job. |
| `agents` | `Record<string, Agent>` | Subagents seen in this session, keyed by agent id. |

## Job

One unit of work: a prompt and the plan the main agent made for it. A session
holds several jobs over time (spec §5.1a).

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | `<source>:<sessionId>:<seq>`, unique across sessions. |
| `seq` | `number` | 1-based position of the job in its session. |
| `title` | `string` | Agent-written title (≤ 6 words) from its `rail:` marker; until then, the job's first prompt cut to 48 characters. |
| `summary` | `string` | Agent-written summary (≤ 2 sentences). May first hold a stand-in from the plan (Codex plan explanation, first Claude task description). `''` when unknown. |
| `prompt` | `string` | The user prompt that started the job. `''` when the collector joined mid-session. |
| `status` | `'planning' \| 'running' \| 'waiting' \| 'done' \| 'error'` | See Job status below. |
| `milestones` | `Milestone[]` | The main agent's own plan, in plan order. Empty until it makes one. |
| `startedAt` | `string` | When the job started. |
| `updatedAt` | `string` | Last change to this job. |
| `endedAt` | `string \| null` | When the job became `done`; `null` while it is not done. |
| `now` | `Now \| null` | What the main agent is doing right now; `null` before its first tool call. |

Progress is derived, not stored: `done / total` milestones (`core/progress.mjs`).
With no milestones there is no %: viewers show "Planning · 0/?".

### Job status

- `planning`: the prompt arrived but the main agent has not used a tool or
  made a plan yet.
- `running`: the main agent is working, or its turn ended while subagents of
  this job (`Agent.job == seq`) are still `running`: it waits on them. The job
  stays `running` with `endedAt: null` until a later main-agent stop finds no
  running subagent of the job.
- `waiting`: waiting for the user. Either the agent or a subagent asked for a
  permission, the agent sent a notification during its turn, or its turn ended
  while milestones were still unfinished and no subagent of the job was running
  (it asked a question or paused). A tool call from a subagent of the job after
  such a stop sets it back to `running`. The next prompt continues the same job,
  unless it brings a new plan (see below).
- `done`: the main agent stopped with every milestone done (or with no plan)
  and no subagent of the job still running, or the session ended. `endedAt` is
  set.
- `error`: reserved; not written by this version.

Prompts that Claude Code injects to hand a background agent's result back to
the main agent (`<task-notification>…`) are not user prompts: they never start,
reopen or split a job.

A follow-up prompt on a `done` or `waiting` job, or on a `running` job whose
main agent already stopped, reopens it. It becomes a new job
only when the agent's next plan event is new work: a Codex plan that shares no
step with the current milestones, or a Claude task created when every current
milestone is already done. Otherwise the same job continues and new milestones
are appended.

## Milestone

| Field | Type | Meaning |
|---|---|---|
| `key` | `string` | Stable id: the Claude task id, or the Codex plan step text. |
| `title` | `string` | Label to show. |
| `status` | `'pending' \| 'active' \| 'done'` | `active` is the milestone the agent works on. |

## Now

The "right now" block under the active milestone. It is reset when the active
milestone changes.

| Field | Type | Meaning |
|---|---|---|
| `milestone` | `string` | `key` of the milestone this block belongs to; `''` when no milestone is active. |
| `pills` | `Pill[]` | The last 3 meaningful actions, oldest first. |
| `attempt` | `number` | Retry counter for the latest action. Repeats count only for `Build` / `Test`, or for any action after it failed. `1` (or `0` before any action) means "no retry"; viewers show `↻ n` only for `n ≥ 2`. |
| `file` | `string \| null` | Last file path a main-agent tool touched. |

## Pill

| Field | Type | Meaning |
|---|---|---|
| `label` | `string` | Short action label: `Build`, `Test`, `Edit <file>`, `Read`, or the tool name. A failed action ends in ` failed`. |
| `kind` | `'ok' \| 'warn' \| 'active' \| 'info'` | `active`: in progress. `ok`: succeeded. `warn`: failed. `info`: finished, outcome unknown. |

## Agent

A subagent of the main agent. Subagents never change milestones or %.
Claude Code's own helper agents (prompt suggestions, internal forks) report an
`agent_id` with an empty or missing `agent_type` and never start as subagents;
they are not listed.

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | The agent id the hooks report. |
| `name` | `string` | Agent type or name (`Explore`, `worker`, …); `'agent'` when unknown. |
| `status` | `'running' \| 'done' \| 'error' \| 'stale'` | `stale`: still running when its job finished or the session ended, and it never reported back. |
| `activity` | `string` | One line: its latest action. |
| `job` | `number \| null` | `seq` of the job it started in; `null` if it started before any job. |
| `updatedAt` | `string` | Last event from this agent. |
| `endedAt` | `string \| null` | When it stopped or was marked `stale`; `null` while running. |

## Internal fields (ignore)

Listed only so readers know they are expected: `Session._pendingPrompt`,
`Job._prevEndedAt`, `Job._mainStopped`, `Job._summaryFromPlan`, `Now._counts`, `Now._open`,
`Now._retryBase`, `Pill._id`.
