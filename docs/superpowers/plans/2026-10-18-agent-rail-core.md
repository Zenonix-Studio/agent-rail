# Agent Rail Core (Collectors + State + Claude Terminal Pane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Claude Code and Codex agent progress into a shared local per-session state file, and show the current job in a Claude Code terminal pane.

**Architecture:** Both tools call one Node CLI (`bin/agent-rail-collect.mjs`) from their hooks. It normalizes the hook payload into a common event, runs it through a pure reducer, and atomically writes `~/.agent-rail/sessions/<source>-<sessionId>.json`. Viewers only read these files. This plan's viewer is a Claude Code mod pane. The menubar app (Plan 2) and the web page + packaging (Plan 3) come later and read the same files.

**Tech Stack:** Plain ESM JavaScript with JSDoc types, Node ≥ 18, zero npm dependencies, no build step. Claude Code plugin (hooks + mod). Codex `hooks.json`.

**Spec:** `docs/superpowers/specs/2026-10-18-agent-progress-design.md`

**Out of scope here:** menubar app (Plan 2), web page, marketplace/Homebrew packaging, README for the public (Plan 3).

## Global Constraints

- Everything stays local. No network calls anywhere in this plan.
- Hooks must never block or fail the agent: the collector always exits 0, prints nothing to stdout unless it is returning hook JSON on purpose, catches every error, and logs to `~/.agent-rail/collector.log`. Target < 100 ms per call.
- No extra model calls. The title (≤ 6 words) and summary (≤ 2 sentences) are written by the agent itself.
- % = completed milestones ÷ total milestones. Never estimate progress inside a milestone. No plan yet → show `Planning · 0/?` and `—`.
- Only the main agent's plan drives milestones/%. Subagents appear as one line each.
- Job identity = `(source, sessionId, seq)`. Lifecycle rules: spec §5.1a.
- The terminal pane shows only its own session's current job.
- Installers must not overwrite the user's existing Codex hooks or config. Merge, back up, or print instructions.
- State root: `~/.agent-rail` (overridable by the `AGENT_RAIL_HOME` env var).
- **No tests by default (user rule).** Do not write a unit test suite. Verify with the replay script (Task 3) and with real sessions.
- Commit messages are in English and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Corrupt or partial state file** (a crash mid-write, or two hooks at once). Expect: the writer uses temp file + rename, and the reader treats unparsable JSON as "no state" without crashing. Covered in Task 2, step 3.
2. **Hook payload shape changes in a future version** (unknown tool name or missing fields). Expect: the normalizer returns `null`, the collector exits 0, and the state is unchanged. Covered by the replay of `fixtures/odd/` in Task 3.
3. **Follow-up prompt after a finished job** ("also fix that error") vs. a brand-new request in the same window. Expect: the follow-up continues the same card, and a new disjoint plan starts card `seq+1`. Covered by replay fixtures in Task 4.
4. **Codex `update_plan` disabled.** Expect: the job shows `Planning · 0/?` with a title from the prompt, and no errors. Covered in Task 5.
5. **Two concurrent hook processes for the same session.** Expect: the last write wins, and the file stays valid JSON. Covered in Task 2, step 3, plus the concurrency check in Task 3.

---

### Task 1: Repo scaffold + payload capture spike

Real hook payloads are unverified (spec §6), so they get captured first. Everything after this task is written against these fixtures.

**Files:**
- Create: `package.json` (`"type": "module"`, `"engines": {"node": ">=18"}`, no deps), `.gitignore` (`node_modules/`, `.superpowers/`)
- Create: `bin/agent-rail-collect.mjs` (capture mode only, for now)
- Create: `fixtures/claude/`, `fixtures/codex/`, `docs/spike-notes.md`

**Interfaces:**
- Produces: CLI `node bin/agent-rail-collect.mjs --source claude|codex [--capture]`. It reads the hook JSON from stdin. With `--capture`, it appends `{"argv":[...],"stdin":<parsed>}` as one line to `~/.agent-rail/capture/<source>.jsonl` and exits 0.

- [ ] **Step 1:** Run `git init` in `~/Projects/agent-rail`, then add the files above. The capture mode must always exit 0, even if stdin is empty or not JSON.
- [ ] **Step 2: Wire capture into Claude Code temporarily.** Add the capture command to `~/.claude/settings.json` hooks for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Notification`, `Stop`, `SessionEnd`. Back the file up first and restore it at step 5.
- [ ] **Step 3: Wire capture into Codex temporarily.** Add the same events to `~/.codex/hooks.json` (merge with the user's existing entries, back up first). Enable the plan tool in `~/.codex/config.toml` per the docs. The expected key is `tools.update_plan.enabled = true`; confirm the exact TOML form in the Codex docs or the `codex --help` output.
- [ ] **Step 4: Run one real session in each tool.** Ask each for a small multi-step task in a scratch repo that makes a plan, runs a failing shell command, edits a file, spawns a subagent, asks for a permission, then gets a follow-up prompt, then a new unrelated request. Copy representative lines into `fixtures/<source>/<event>.json`, one file per distinct shape. Replace prompt text and paths with neutral values.
- [ ] **Step 5:** Restore both tools' original config from the backups. Leave `update_plan` enabled only if the user agrees.
- [ ] **Step 6: Answer these in `docs/spike-notes.md`, with the field paths you found:**
  1. The Claude task tools' names and their input/response fields (id, subject/title, description, status values, activeForm). Is it `TodoWrite` (snapshot) or `TaskCreate`/`TaskUpdate` (incremental)?
  2. Which Claude event signals "waiting for the user" (Notification type/message for permission)?
  3. Does Claude `Stop` and Codex `Stop` include the last assistant message?
  4. How the Codex shell/apply_patch tools look in `PreToolUse`/`PostToolUse` (tool names, command, exit code, file path).
  5. Does `UserPromptSubmit` accept `additionalContext` output in both tools? Exact output JSON.
  6. How subagent events are marked in each tool (`agent_id`/`agent_type`, or Codex `SubagentStart` fields).
- [ ] **Step 7: Commit:** `chore: scaffold repo and capture hook payload fixtures`

---

### Task 2: State store

**Files:**
- Create: `core/state.mjs`

**Interfaces:**
- Produces:
  - `stateRoot(): string`. Returns `$AGENT_RAIL_HOME` or `~/.agent-rail`.
  - `sessionPath(source: 'claude'|'codex', sessionId: string): string`. Returns `<root>/sessions/<source>-<safeId>.json`. `safeId` replaces any character outside `[A-Za-z0-9._-]` with `_`.
  - `readSession(path): Session|null`. Returns `null` if the file is missing or the JSON can't be parsed.
  - `writeSession(path, session: Session): void`. Writes `<path>.<pid>.tmp`, then `fs.renameSync`, and creates the directories it needs.
  - `progress(job: Job): {done: number, total: number, pct: number|null}`. `pct` is `Math.round(100*done/total)`, or `null` when `total === 0`.
  - Types (JSDoc), `schema: 1`:
    ```
    Session { schema:1, source, sessionId, cwd, project, updatedAt:ISO,
              jobs: Job[], agents: {[agentId]: Agent}, pendingPrompt: string|null }
    Job     { id:"<source>:<sessionId>:<seq>", seq, title, summary, prompt,
              status:'planning'|'running'|'waiting'|'done'|'error',
              milestones: Milestone[], startedAt, updatedAt, endedAt|null,
              now: Now|null }
    Milestone { key, title, status:'pending'|'active'|'done' }
    Now     { milestone: string, pills: Pill[], attempt: number, file: string|null }
    Pill    { label: string, kind:'ok'|'warn'|'active'|'info' }
    Agent   { id, name, status:'running'|'done'|'error', activity: string, updatedAt }
    ```
    `project` = basename of `cwd`. "Stale" is not stored. Viewers derive it from `updatedAt`.

- [ ] **Step 1:** Implement the exports above in `core/state.mjs`.
- [ ] **Step 2: Verify the write and the progress math.** Run:
  `node -e "import('./core/state.mjs').then(s=>{const p=s.sessionPath('claude','a/b');s.writeSession(p,{schema:1,jobs:[]});console.log(p,JSON.stringify(s.readSession(p)),JSON.stringify(s.progress({milestones:[{status:'done'},{status:'pending'}]})))})"` with `AGENT_RAIL_HOME=$(mktemp -d)`.
  Expected: a path ending in `claude-a_b.json`, then `{"schema":1,"jobs":[]}`, then `{"done":1,"total":2,"pct":50}`.
- [ ] **Step 3: Verify a corrupt file.** Write `{"sch` into a session file. `readSession` must return `null` without throwing.
- [ ] **Step 4: Commit:** `feat(core): add session state store and progress helper`

---

### Task 3: Normalizers + replay script

**Files:**
- Create: `core/normalize-claude.mjs`, `core/normalize-codex.mjs`, `scripts/replay.mjs`, `fixtures/odd/` (an unknown tool, missing `session_id`, an empty object)

**Interfaces:**
- Consumes: the fixtures and spike notes from Task 1.
- Produces: `normalize(hookInput: object): {sessionId, cwd, agentId: string|null, event: Event} | null` exported from each normalizer file. `agentId` is non-null only for subagent-originated events.
  ```
  Event =
   | {type:'prompt', text}
   | {type:'plan', items:[{key,title,status}], explanation:string|null}   // full snapshot (Codex update_plan, Claude TodoWrite)
   | {type:'task-create', key, title, description:string|null}           // Claude incremental
   | {type:'task-update', key, status:'pending'|'active'|'done'|'deleted'}
   | {type:'tool', phase:'pre'|'post', name, label, file:string|null, ok:boolean|null}
   | {type:'agent-start', name} | {type:'agent-stop', ok:boolean}
   | {type:'waiting'} | {type:'stop', lastMessage:string|null} | {type:'session-end'}
  ```
  Status mapping: `in_progress` → `active`, `completed` → `done`. Plan item `key` = the tool's id if there is one, otherwise the item's title.
  `label` comes from `classifyTool(name, input): string` in `core/flow.mjs` (Task 4 defines it). For now, stub it to return `name` and replace it in Task 4.
- `scripts/replay.mjs <fixture files...>`. Feeds each file through normalize + reduce (once Task 4 exists) into a temp `AGENT_RAIL_HOME` and prints the final session JSON. Until then, it prints the normalized events.

- [ ] **Step 1:** Implement both normalizers. Map exactly the field paths recorded in `docs/spike-notes.md`, and return `null` for anything unrecognized. Codex subagents run as their own threads. When a Codex event comes from a subagent thread (spike Q6, e.g. `parent_thread_id`), set `sessionId` = the parent thread id and `agentId` = the subagent's thread id. That way it joins the parent's job instead of creating its own session file. A subagent's `update_plan` is ignored.
- [ ] **Step 2:** Implement `scripts/replay.mjs`.
- [ ] **Step 3: Verify.** Run `node scripts/replay.mjs fixtures/claude/*.json` and the same for codex. Expected: one event per fixture of the right `type`, and no throws. Run `node scripts/replay.mjs fixtures/odd/*.json`. Expected: every one prints `null`.
- [ ] **Step 4: Commit:** `feat(core): normalize Claude Code and Codex hook payloads`

---

### Task 4: Reducer, job lifecycle, "now" flow

**Files:**
- Create: `core/reduce.mjs`, `core/flow.mjs`
- Create: `fixtures/scenarios/followup/` and `fixtures/scenarios/new-request/`. These are ordered event sequences built from the Task 1 captures.

**Interfaces:**
- Consumes: `Event` (Task 3), `Session` (Task 2).
- Produces:
  - `reduce(session: Session|null, input: {source, sessionId, cwd, agentId, event}, now: Date): Session`. A pure function that never throws on any `Event`.
  - `classifyTool(name: string, input: object): string`. Returns `Build` when a shell command matches `/xcodebuild|swift build|npm run build|pnpm build|yarn build|make\b|gradle|cargo build|tsc\b/`, `Test` when it matches `/xcodebuild test|swift test|npm test|pytest|vitest|jest|cargo test|go test/` (the test regex wins), `Edit <basename>` for Edit/Write/MultiEdit/apply_patch, `Read` for Read/Grep/Glob, and otherwise the tool name.
  - `extractMeta(text: string): {title, summary}|null`. Parses the marker line `rail: <title> — <summary>` defined in Task 6.

**Lifecycle (exact rules):**
1. `prompt`. If there is no current job, create `seq = 1` with status `planning`. If the current job is `done`, set `pendingPrompt = text`, reopen the job (status `running`, `endedAt = null`), and keep the old `endedAt` in memory as `job._prevEndedAt`. Otherwise, ignore the prompt for lifecycle purposes. The first prompt of a job is stored as `job.prompt`, and the title fallback is that prompt truncated to 48 characters.
2. `plan` / `task-create`, while `pendingPrompt` is set, with a plan whose keys share **nothing** with the current milestones. Split: restore the current job to `done` with `endedAt = _prevEndedAt`, then push a new job `seq+1` whose prompt is `pendingPrompt`. Then clear `pendingPrompt`.
3. `plan` (snapshot) replaces the milestones. `task-create` appends a milestone. `task-update` changes one milestone's status, and `deleted` removes it. Any milestone change sets the status to `running`.
4. `tool` events from the main agent (`agentId === null`): append a `Pill` to `now` (`pre` → `active`, `post ok` → `ok`, `post !ok` → `warn` with label `<label> failed`). Keep the last 3 pills. `attempt` = the number of times this `label` has occurred since the active milestone started. `file` = the last non-null `file`. `now` resets when the active milestone changes.
5. `tool` events from a subagent update `agents[agentId].activity` to `label` (plus the file if present). `agent-start` creates the agent as `running`, and `agent-stop` sets it to `done` or `error`.
6. `waiting` sets status `waiting`. The next `tool` or `plan` event sets it back to `running`.
7. `stop`, if there is no `agentId`: set status `done`, set `endedAt`, clear `pendingPrompt`, and run `extractMeta(lastMessage)` to fill the title/summary if they are still the fallback.
8. `session-end`: same as `stop`. `updatedAt` is set on every event.

- [ ] **Step 1:** Implement `flow.mjs`, replace the Task 3 stub, then implement `reduce.mjs` following the rules above.
- [ ] **Step 2:** Wire `reduce` into `scripts/replay.mjs`.
- [ ] **Step 3: Verify.** Run `node scripts/replay.mjs fixtures/scenarios/followup/*`. Expected: 1 job, `done`, with the original milestones plus any appended ones.
  Run `node scripts/replay.mjs fixtures/scenarios/new-request/*`. Expected: 2 jobs. Job 1 is `done` with its original `endedAt`. Job 2 has `prompt` = the second request.
  A failing build fixture must show pills ending in `{"label":"Build failed","kind":"warn"}`, and `attempt` must be ≥ 2 after a rebuild.
- [ ] **Step 4: Commit:** `feat(core): add reducer with job lifecycle and now-flow`

---

### Task 5: Collector CLI + wiring for both tools

**Files:**
- Modify: `bin/agent-rail-collect.mjs` (full mode; keep `--capture`)
- Create: `.claude-plugin/plugin.json` (name `agent-rail`, version `0.1.0`), `hooks/hooks.json`
- Create: `scripts/install-codex.mjs`, `scripts/uninstall-codex.mjs`

**Interfaces:**
- Consumes: `normalize` (Task 3), `reduce` (Task 4), `readSession`/`writeSession`/`sessionPath` (Task 2).
- Produces: `node bin/agent-rail-collect.mjs --source <s>`. Pipeline: stdin → normalize → read → reduce → write. It catches every error, appends them to `<root>/collector.log`, and exits 0. Plugin hooks call `node "${CLAUDE_PLUGIN_ROOT}/bin/agent-rail-collect.mjs" --source claude` for the same 8 events as in Task 1.

- [ ] **Step 1:** Implement the full collector mode.
- [ ] **Step 2: Write `hooks/hooks.json` and `.claude-plugin/plugin.json`.** Use Claude Code's documented plugin hook format.
- [ ] **Step 3: Write `scripts/install-codex.mjs`.**
  - Back up `~/.codex/hooks.json` and `config.toml` to `*.agent-rail.bak`.
  - Add agent-rail entries to `hooks.json` without removing or reordering existing ones. Make it idempotent by detecting the entries via the `agent-rail-collect` substring.
  - If the config has no `update_plan` setting, ask y/N, then append the enable key. If the key exists with any value, leave it alone and print a note.
  - `uninstall-codex.mjs` removes only the entries containing `agent-rail-collect`.
- [ ] **Step 4: Verify the speed.** Time a collector call on a fixture with `time (cat fixtures/codex/<post-tool>.json | node bin/agent-rail-collect.mjs --source codex)`. Expected: under 100 ms. Pipe in garbage text and check the exit code. Expected: exit 0, and a line in `collector.log`.
- [ ] **Step 5: Verify Claude end to end.** Install with `claude --plugin-dir ~/Projects/agent-rail`, or the local plugin install command from the docs. Run a short multi-step task, then check `~/.agent-rail/sessions/claude-*.json`. Expected: the milestones match the task list, the pills update, and the status becomes `done` after stop.
- [ ] **Step 6: Verify Codex end to end.** Run `node scripts/install-codex.mjs`, then a Codex task. Expected: `codex-*.json` with milestones from `update_plan`. Run uninstall and confirm that the user's original hooks are untouched (`diff` against the backup, ignoring agent-rail entries). Then disable `update_plan` temporarily and run one more Codex task. Expected: the job shows status `planning`, has the prompt-based title and empty milestones, and `collector.log` gets no new errors.
- [ ] **Step 7: Commit:** `feat: collector CLI wired into Claude Code plugin and Codex hooks`

---

### Task 6: Agent-written title + summary

**Files:**
- Modify: `bin/agent-rail-collect.mjs`, `core/normalize-*.mjs` (only if the spike showed a better field)

**Interfaces:**
- Consumes: spike notes, questions 1, 3 and 5. `extractMeta` from Task 4.
- Produces: the job's `title`/`summary` filled with no extra model call.

Decision order. Use the first that the spike shows is available:
1. A plan-tool field. Codex `update_plan.explanation` becomes the summary. Claude task `description` on the first task becomes the summary if present. The title still comes from the marker or the fallback.
2. A marker line. On `UserPromptSubmit`, the collector returns `additionalContext` with this exact text:
   `When you start a new task, begin your first reply with one line: "rail: <title, max 6 words> — <summary, max 2 sentences>". Do this once per task.`
   The marker is extracted from `Stop.lastMessage` (if the spike shows it's there) or from the transcript's first assistant message after the prompt, read at `stop` from `transcript_path`, only the last 200 lines.
3. The fallback: the prompt truncated to 48 characters. The summary stays empty.

- [ ] **Step 1:** Implement the chosen path(s). Return `additionalContext` only on `UserPromptSubmit`, and only in the JSON shape spike question 5 confirmed.
- [ ] **Step 2: Verify.** Run one real session per tool. Expected: `title` ≤ 6 words, `summary` filled, and the marker shows as at most one short line in the agent's reply.
- [ ] **Step 3: Commit:** `feat: agent-written job title and summary`

---

### Task 7: Claude Code terminal pane (mod)

**Files:**
- Create: `mod/` (the mod entry and hooks module, laid out as the mod docs require), plus the matching `plugin.json` fields
- Create: `core/render-ascii.mjs`

**Interfaces:**
- Consumes: the `Session`/`Job`/`progress` types and functions (Task 2). The session file for the current `session_id`.
- Produces: `renderJob(job: Job, width: number): string[]` in `core/render-ascii.mjs`. It returns plain lines, and the mod applies the colors. Plan 2 and Plan 3 do not use it.

Layout (from `docs/superpowers/specs/mockups/hybrid-ac.html`, the terminal side):
```
<title>                                   <pct>%
██████████████░░░░░░░░  <done>/<total> · <elapsed>
●━━━━●━━━━●━━━━◉┄┄┄┄○
Analiz Model View Build Temizlik      (labels truncated to fit)
                ↓
  build ✓ → 3 errors → fixing ▶  ↻ 2
  LoginView.swift:42
```
Colors: done green, active accent orange, pending dim, warn amber. No plan yet: `<title>  Planning · 0/?` and nothing else. Waiting: append ` · waiting for you` in amber. Width < 40 columns: drop the metro line and show `▸ <active milestone> · n/m · pct%`.

- [ ] **Step 1: Read the mod docs, then spike the mod sandbox.** Invoke the `plugin-authoring` skill and read https://code.claude.com/docs/en/plugins/mods/interface.md and …/reference.md first. Spike whether the mod can read `~/.agent-rail/sessions/*.json` (`$.fs.read`). If it can't, it builds the same `Session` in memory by calling `reduce` on its own `tool.call`/`classic.*` events. Record the result in `docs/spike-notes.md`.
- [ ] **Step 2:** Implement `renderJob` and the pane. Redraw on file change or on events; if neither is available, use `$.clock.every(1000)`. Use the `Pane` site, or `AbovePrompt` when the terminal is narrow, per the docs.
- [ ] **Step 3: Verify in the terminal.** Run a multi-step task in Claude Code. Expected: the pane matches the layout above, updates within about 1 s of a todo change, and shows only this session's job.
- [ ] **Step 4: Verify in the desktop app.** Open the same session in the Claude Code desktop app and record whether and where the pane renders, in `docs/spike-notes.md`. If it doesn't render, that's acceptable (spec §5.1b). Note it for Plan 2.
- [ ] **Step 5: Commit:** `feat: Claude Code terminal progress pane`

---

## Next plans (written after this one ships, using its spike notes)

- **Plan 2: macOS menubar app (SwiftUI, macOS 14+, `MenuBarExtra`).** Watches `~/.agent-rail/sessions/`. The icon shows a ring and counts. The popover groups jobs → agents, with the B rail detail (`mockups/menubar-v2.html`, `mockups/desktop-v2.html`). Build verification runs on the host Mac.
- **Plan 3: Local web page + public packaging.** A localhost-only server with a card grid, the Claude marketplace entry, the Codex installer docs, the menubar app release/Homebrew cask, README, LICENSE, and TR/EN strings.
