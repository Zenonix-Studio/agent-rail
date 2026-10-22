# agent-rail state schema (v1)

The collector (`bin/agent-rail-collect.mjs`) keeps one JSON file per agent
session at `~/.agent-rail/sessions/<source>-<sessionId>.json` (or under
`$AGENT_RAIL_HOME`). Viewers (the Claude Code mod, the menubar app, the web
page) only read these files. This document is the contract between the two;
the JSDoc typedefs in `core/state.mjs` mirror it.

The directory is created with mode `0700` and each file is written atomically
(temp file + rename) with mode `0600`. A reader may see the old file or the new
one, never a half-written one.

## Stage

`'plan' | 'analyse' | 'dev' | 'fix' | 'review'`: the kind of work, for coloring.
Inferred from the tool (reading and searching: `analyse`; editing: `dev`; builds and
tests: `review`; plan tools: `plan`; a review agent dispatch: `review`). An edit after a
failed step is `fix` until a build or test passes. An agent-written title prefix wins.
Viewers use one palette: plan violet, analyse blue, dev orange, fix red, review teal.

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
| `now` | `Now \| null` | What the main agent is doing right now; `null` before its first step (a tool call or a plan change). |
| `progress` | `string` | The main agent's own 1–2 sentence summary of the work done and left (what was found, changed or verified, its agents' included): its latest `progress:` line of the turn, read from its transcript on its plan changes and stop. `''` until it writes one. |

Progress is derived, not stored: `done / total` milestones (`core/progress.mjs`).
With no milestones there is no %: viewers show "Planning · 0/?".

#| `tokens` | `Tokens` (optional) | The main agent's API token usage during the job (Claude only), read from its transcript. A job's total is this plus its agents' `tokens`. Missing until usage is seen. |

### Job status

- `planning`: the prompt arrived but the main agent has not used a tool or
  made a plan yet.
- `running`: the main agent is working, or its turn ended while subagents of
  this job (`Agent.job == seq`) are still `running`: it waits on them. The job
  stays `running` with `endedAt: null` until a later main-agent stop finds no
  running subagent of the job. When Claude's stop lists its running background
  tasks, a subagent of the job missing from that list is marked `stale` first.
  A main-agent tool call (e.g. in the short turn after a hand-back) means the
  main agent works again; its next stop decides anew.
- `waiting`: waiting for the user. Either the agent or a subagent asked for a
  permission or sent a notification (Claude's idle notice after a stop that
  left subagents running does not count), or its turn ended
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

## Tokens

API token usage summed from a Claude transcript: each assistant `message.usage`,
counted once per `message.id`. The collector keeps each transcript's read
position, so a hook reads only the bytes added since the last one. Codex
sessions have none.

| Field | Type | Meaning |
|---|---|---|
| `input` | `number` | `input_tokens`: uncached input. |
| `cacheRead` | `number` | `cache_read_input_tokens`. |
| `cacheWrite` | `number` | `cache_creation_input_tokens`. |
| `output` | `number` | `output_tokens`. |

Viewers show the sum of all four, compact (`64k tok`, `1.2M tok`).

## Milestone

| Field | Type | Meaning |
|---|---|---|
| `key` | `string` | Stable id: the Claude task id, or the Codex plan step text. |
| `title` | `string` | Label to show. |
| `status` | `'pending' \| 'active' \| 'done'` | `active` is the milestone the agent works on. |
| `stage` | `Stage` (optional) | The agent's own stage from a title prefix (`fix: …`, `[review] …`, stripped from `title`); else the stage seen most while the step was active. Missing until known. |
| `startedAt` | `string` (optional) | When the step first became `active` (or `done`). |
| `endedAt` | `string` (optional) | When it became `done`. A step's duration is `endedAt − startedAt` (`stepDuration`), and the job's time left is `eta()` in `core/progress.mjs`. |

## Now

The "right now" block under the active milestone: the story of the work, as
short human sentences. The story reads across milestones: when the active
milestone changes, the pills carry over (a finished milestone adds an `ok`
pill with its title, replacing its own start pill), while `attempt`, `file`
and the internal retry bookkeeping start fresh.

| Field | Type | Meaning |
|---|---|---|
| `milestone` | `string` | `key` of the active milestone; `''` when none is active. |
| `pills` | `Pill[]` | The last 4 meaningful steps, oldest first (see Pill). |
| `attempt` | `number` | Retry counter for the latest action. Repeats count only for build and test commands, or for any step after it failed. `1` (or `0` before any action) means "no retry"; viewers show `↻ n` only for `n ≥ 2`. |
| `file` | `string \| null` | Last file path a main-agent tool touched. |
| `stage` | `Stage \| null` | What kind of work the main agent is doing now: the active step's own stage, else the latest step's. |

## Pill

| Field | Type | Meaning |
|---|---|---|
| `label` | `string` | Human-readable description of the step, at most 60 characters (longer ones end in `…`). Viewers show it verbatim. |
| `kind` | `'ok' \| 'warn' \| 'active' \| 'info'` | `active`: in progress. `ok`: succeeded. `warn`: failed. `info`: finished, outcome unknown, or a marker such as the milestone being started. |
| `stage` | `Stage` (optional) | The step's stage. Missing when the tool says nothing about it. |

Labels prefer the agent's own words, so they are in the agent's language:

- Shell commands: the call's `description` (e.g. `Run the test suite`), else
  `Running tests` / `Building`, else ``Running `git status` ``. Generic
  descriptions (`Run command`) count as missing, and a build or test command
  shows `Building` / `Running tests` unless its description says more.
- Agent dispatches: `Dispatched agent: <description>`, else the humanized type
  (`Dispatched code reviewer agent`).
- Plan: `Planned N steps`; a task set in progress shows its active form
  (`Writing the README`) when that differs from its title; a finished task
  shows its title as `ok`.
- Files: `Editing LoginView.swift`, `Writing README.md`, `Reading api.js`,
  `Searching for '<pattern>'`.
- Others: `Using skill: <name>`, `Searching the web: <query>`, `Reading <host>`,
  `<Server>: <tool words>` for MCP tools, or the tool name split into words.
  Raw tool ids are never shown. Bookkeeping tools (tool search, task listing)
  are not steps.

Steps of the same kind in a row collapse into one pill: `Reading 5 files`,
`Editing 3 files`, `Dispatched 2 agents`; repeats of the same step show once.
A failed step is never merged into and stays visible: `Build failed`,
`Tests failed`, `Search failed`, `Agent dispatch failed`, otherwise
`<label> failed`.

## Agent

A subagent of the main agent. Subagents never change the job's milestones or
%: a subagent's own plan (Claude task tools or TodoWrite with its `agent_id`, a
Codex `update_plan` from a sub-thread) goes to that agent's `milestones`.
Background subagents in the Claude desktop app have no task tools (and
`update_plan` is refused for them), so the SubagentStart instruction asks each
agent to write `step: <stage>: <title>` as a line of its text when it starts a
step. On each of the agent's tool calls and on its stop, the collector reads
those lines from the agent's own transcript
(`<session transcript>/subagents/agent-<id>.jsonl`) and makes them its
`milestones` (key `step:<line>`): the latest is `active`, earlier ones `done`,
all `done` once the agent stops. A plan from the agent's own task tools wins.
Claude Code's own helper agents (prompt suggestions, internal forks) report an
`agent_id` with an empty or missing `agent_type` and never start as subagents:
an id whose events carry no `agent_type` is listed only once a subagent start
was seen for it. Ids with an `agent_type` are always listed.

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | The agent id the hooks report. |
| `name` | `string` | Display name: the description the main agent gave when it dispatched the agent (`Review the popover UI`), else its humanized type (`General-purpose agent`, `Code reviewer agent`); `'agent'` when unknown. Exact links: the Claude Agent call's response, and the background tasks a Claude stop lists. Until then (and for Codex) the only open dispatch of the agent's type in the job is assumed; with several differently named ones, the type name shows. |
| `status` | `'running' \| 'done' \| 'error' \| 'stale'` | `stale`: it never reported back. Either it was still running when its job finished or the session ended, or a Claude main-agent stop no longer listed it among the running background tasks. |
| `activity` | `string` | One line: its current step. With its own plan, the active milestone's in-progress form (`Writing adim-3`, else its title), or the next pending one; without a plan, or once every milestone is done, its latest step (the last entry of `steps`, e.g. `Reading 3 files`). |
| `stage` | `Stage \| null` | The agent's current stage, as `Now.stage`. |
| `progress` | `string` | The agent's own 1–2 sentence summary of what is done and what is left: its latest `progress:` line, read from its transcript like its `step:` lines. `''` until it writes one. |
| `summary` | `string` | What it was asked to do: the first sentence of the dispatch prompt (Claude Agent `prompt`, Codex spawn `message`), at most 100 characters; else the dispatch description. `''` when unknown. May equal `name`. |
| `milestones` | `Milestone[]` | The agent's own plan, in plan order; empty when it made none. Its `done / total` is its own progress, never the job's. |
| `steps` | `Pill[]` | The agent's own story: its last 6 steps, oldest first, with the same labels, collapsing and plan steps (`Planned 6 steps`, a finished task's title as `ok`) as `Now.pills`. |
| `job` | `number \| null` | `seq` of the job it started in; `null` if it started before any job. |
| `startedAt` | `string` | When the agent was first seen (its start, or its first event). Viewers list a job's agents running first, then in this order. Older files lack it: use `updatedAt`. |
| `updatedAt` | `string` | Last event from this agent. |
| `endedAt` | `string \| null` | When it stopped or was marked `stale`; `null` while running. |
| `tokens` | `Tokens` (optional) | The agent's API token usage, read from its own transcript (Claude only). Missing until usage is seen. |

A running agent whose `updatedAt` is more than 5 minutes old is shown as quiet
(`quiet 7m`, amber): viewers compute this from the clock; nothing is stored.

## Internal fields (ignore)

Listed only so readers know they are expected: `Session._pendingPrompt`, `Session._turnPrompt`, `Job._beforeTurn`,
`Session._dispatch`, `Session._usage` (a read position per transcript), `Job._prevEndedAt`, `Job._mainStopped`, `Job._summaryFromPlan`,
`Milestone._activeForm`, `Now._counts`, `Now._open`, `Now._retryBase`, `Pill._run`
(older files: `Pill._id`), `Agent._type`, `Agent._open` (older files: `Agent._run`).

Files written before `summary`, `milestones` and `steps` existed lack them on
agents: readers treat them as `''` and `[]`.
