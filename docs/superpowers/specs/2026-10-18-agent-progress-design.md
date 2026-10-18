# Agent Rail — Live Progress View for Claude Code & Codex Agents

Date: 2026-10-18 · Status: draft for approval · Working name: **agent-rail** (builder's/author's call, rename freely)

## 1. Intent and why

When AI coding agents run, it is hard to tell at a glance **what each one is working on, which milestones it has finished, where it is right now, how many steps remain, and what % is done**.

- In the Claude Code desktop app, the right-side panel shows raw tool calls and code — too noisy to read the *state* of the work.
- In the terminal it is worse: progress scrolls away with the log; there is no fixed place to look.
- The user runs several jobs in parallel (e.g. 5 at once), across **both Claude Code and OpenAI Codex**, often with subagents inside each job.

The product is a human-readable layer *above* the raw log: a 1–2 sentence summary, a milestone rail, a % and a "right now" line — shown inside the tools (where possible) and in an external macOS menubar app (plus a local web page).

It will be published as an **open-source public project** that other people install.

## 2. Goals

1. For every running job, show: title + 1–2 sentence summary, milestone list (done / active / pending), % complete, "N / M milestones", elapsed time, and a "right now" block for the active milestone.
2. Support **Claude Code and Codex** as first-class sources.
3. Distinguish **multiple concurrent jobs** and the **agents inside each job** (main agent + subagents).
4. Surfaces:
   - **Claude Code terminal**: fixed pane (mod pane / above-prompt band).
   - **Claude Code desktop app**: the same mod pane if the desktop app renders it (see §6).
   - **Codex**: in-tool surface where technically possible (see §6); otherwise the external surfaces are the Codex view.
   - **macOS menubar app (SwiftUI)** — primary external surface.
   - **Local web page** — same data, card grid.
5. Near-zero extra token cost.
6. Easy install for strangers (public project).

## 3. Non-goals (v1)

- Orchestrating or dispatching agents (no starting/stopping/assigning work). Read-only view.
- Token/cost analytics.
- Merging two separate sessions (e.g. one Claude + one Codex window on the same task) into one job. **One main session = one job.** *(Author's call — user did not confirm or deny cross-session merging; revisit later.)*
- Windows/Linux menubar equivalents.
- Remote/cloud agents (Codex cloud, Claude Code on the web) — local sessions only.

## 4. Anti-goals (failure even if it "works")

- Showing raw tool spam again. The view must stay at the summary/milestone level; detail is one line, not a log.
- Burning noticeable tokens to produce the summary or progress.
- Lying progress: inventing % inside a milestone. % is only `completed / total` milestones.
- Sending any data off the machine. Everything stays local.
- Slowing down the agents (hooks must be fast and never block or fail the agent's tool call).

## 5. Decisions made with the user

### 5.1 Data model (conceptual)

- **Job** = one main agent session (one Claude Code session or one Codex thread). Has: source (`claude` | `codex`), project/cwd, title, summary, milestones, %, status, start time, last-update time, and a list of agents.
- **Milestones come from the agent's own todo/plan list** — not from the user, not from an extra model call.
  - Claude Code: the task/todo tools (this build uses `TaskCreate` / `TaskUpdate`; older builds `TodoWrite` — support both).
  - Codex: `update_plan` tool; each call is a full snapshot `{explanation, plan:[{step, status: pending|in_progress|completed}]}`.
- **% = completed milestones ÷ total milestones.** If the agent adds/changes milestones mid-run, the rail updates and % may drop. If there is no plan yet: show "Planning · 0/?" and "—" instead of %.
- **Summary**: 1–2 sentences written by the agent itself (it already understands the task, so cost is a few output tokens). See §7 for mechanism.
- **Agent** (inside a job) = main agent or subagent; shows name/type, one-line current activity, status (running / done / waiting / error).
- **Job status**: running, waiting for user (permission/approval/question), stale (no events for a while), done, error.

### 5.1a Job lifecycle (confirmed by user)

- A session can hold several jobs over time. The user works like this: finish one job, then ask for the next one in the same window.
- **Job ends** when the main agent stops after finishing its work → card becomes **done** and counts toward "done today".
- **New job starts** when a new prompt in the same session produces a **new plan** → new card.
- **Same job continues** when a follow-up prompt does not replace the plan (e.g. "also fix that error") → existing card continues, milestones may be appended.
- Job identity is therefore `(source, session_id, job sequence)`, not just the session id.

### 5.1b Other confirmed calls

- **Subagents** do not affect the rail or %. Only the main agent's plan drives milestones and %. Subagents appear as one line each under "Agents in this job". Their own plans can be ignored.
- **Claude Code terminal pane** shows only its own session's current job. Seeing all jobs is the menubar's and the web page's job.
- **Desktop**: if the mod pane does not render in the Claude desktop app, the menubar app is the accepted desktop surface for v1.
- **Title**: the agent writes a title of at most 6 words together with the summary, through the same mechanism (§7). Fallback: the first user prompt of the job, truncated.

### 5.2 Visual design (mockups in `docs/superpowers/specs/mockups/`)

- **Desktop / panel / menubar detail = "B: vertical rail"** (`desktop-v2.html`, right card):
  - Header: live status chip ("Çalışıyor"/running), elapsed time, %.
  - Title + 1–2 sentence summary, thin progress bar.
  - Vertical rail: done = filled green, active = accent ring with glow, pending = muted.
  - The active milestone expands in place into a **"right now" block**: a mini flow of the last few actions as pills with arrows (e.g. `Build ✓ → 3 errors → Fixing`), a retry/loop indicator (`↻ attempt 2`), and the current file:line in monospace.
  - Dark theme matching Claude desktop; accent orange for "now", green for done, amber for warnings.
- **Terminal = ASCII metro line + mini flow** (`hybrid-ac.html`, right side — user liked this): title + %, block-character progress bar with `3/5 · ~4m`, a horizontal `●━━●━━◉┄┄○` metro line with milestone labels, and under the active node the mini flow + current file.
- **Menubar** (`menubar-v2.html` — user: "10 numara"):
  - Icon: small progress ring (average % of running jobs) + count text ("5 jobs · 9 agents", shorten if space is tight). Turns orange when any agent waits for the user.
  - Popover lists **jobs**; each row: CLAUDE/CODEX tag, title, current step + `n/m`, thin bar, %, agent-count chip, "waiting for approval" badge when relevant.
  - Clicking a job expands it to the B rail + "right now" block + an **"Agents in this job"** list (status dot, agent name, one-line activity).
  - Footer: "done today" count, Settings.
- **Web page**: same job cards (B design) in a responsive grid; all jobs visible at once.
- UI language: the mockups are in Turkish because the user is Turkish; since the project is public, ship English UI strings with localization support (TR included). *(Author's call.)*

### 5.3 Architecture (agreed direction)

**One shared state, many viewers.**

```
Claude Code hooks ─┐                         ┌─ Claude Code mod pane (terminal / desktop?)
                   ├─► local state store ────┼─ macOS menubar app (SwiftUI)
Codex hooks ───────┘   (per-job state files) └─ local web page
```

- **Collectors** are small hook handlers for each tool that translate events into a common per-job state. They do not parse whole transcripts on each event; transcript/rollout files are only a fallback or for backfill.
- **Viewers** only read the shared state.
- **Codex prerequisite**: `update_plan` is **disabled by default** in current Codex CLI (`tools.update_plan.enabled`). Installer must enable it (with the user's consent) and the UI must handle "no plan" gracefully.
- Platforms: macOS first (menubar is macOS-only). Collectors + web page should not be macOS-specific.
- Prior art for reference only: [progress-hud](https://github.com/spboxer3/progress-hud) (captures TodoWrite/TaskCreate/TaskUpdate/ExitPlanMode on Claude and `update_plan` on Codex into `.progress/`, serves on :7788). Do not fork; borrow ideas if useful. Check its license before copying code.

## 6. Research findings the builder needs (verified 2026-10-18 unless marked)

**Claude Code**
- Mods (plugin with a hooks module) can open a `Pane` (`$.ui.open`, drawn in `ui.render` with `component: 'Pane'`) and an `AbovePrompt` band. Event-driven redraw (`$.ui.invalidate`, throttled ~10–30/s), timers via `$.clock.every`. Events: `tool.call`, `turn.step` (has `agentId`), `turn.complete`, `agent.spawn`; `$.agent.list()` gives subagent status. Docs: https://code.claude.com/docs/en/plugins/mods/interface.md, …/mods/reference.md
- Settings hooks: common fields `session_id`, `transcript_path`, `agent_id`, `agent_type`; `PreToolUse`/`PostToolUse` carry `tool_name`, `tool_input`, `tool_use_id`; also `SubagentStart`/`SubagentStop` (`last_assistant_message`), `TaskCreated`, `TaskCompleted`, `Notification`, `Stop`, `UserPromptSubmit`, `SessionEnd`. https://code.claude.com/docs/en/hooks.md
- Status line (`statusLine` in settings) is a simpler multi-line text alternative (min refresh 1s).
- **Desktop app**: right-side panes are a fixed set (chat, diff, browser, terminal, file, plan, tasks, subagent); no documented API to add a custom pane. Mod docs list `Pane`/`AbovePrompt` as rendering in Desktop — **unverified how/where**. Builder must spike this first.
- Exact `TaskCreate`/`TaskUpdate` input schema not verified — builder must capture real payloads.
- Transcripts: `~/.claude/projects/<project>/<session>.jsonl`.

**Codex (codex-cli 0.162.1, verified locally)**
- Rollouts: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, records `{timestamp, type, payload}`.
  - `session_meta`: `id, cwd, originator, source, git…`; subagents have `source.subagent.thread_spawn.{parent_thread_id, agent_nickname, agent_role}`.
  - Plan: `response_item` → `function_call` `name:"update_plan"`, `arguments` is a JSON string `{explanation, plan:[{step,status}]}`.
  - User prompt: `event_msg` `user_message`. Activity: `function_call`/`custom_tool_call`, `item_completed` (`CommandExecution`, `FileChange`, `AgentMessage`, `SubAgentActivity`…), `task_started`/`task_complete`.
- Hooks are stable: `SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStart/Stop, SessionEnd`; stdin has `session_id, transcript_path, turn_id, tool_name, tool_input, tool_response`; matcher can target `update_plan`. Config in `~/.codex/hooks.json`. https://learn.chatgpt.com/docs/hooks
- App-server JSON-RPC (`turn/plan/updated`, `item/started`…) exists — richer but less stable; not for v1.
- Codex TUI status line appears to only choose from built-in items (unverified) → custom in-Codex pane likely impossible; Codex desktop app/IDE likely share the same app-server/rollouts (unverified). progress-hud claims a "Codex side panel" — builder should check how.
- Storage may migrate from JSONL to SQLite (`migrate-rollouts`, `thread_history_*.sqlite`) — prefer hooks over file parsing for this reason.

## 7. Left to the builder (with constraints)

- **Title + summary mechanism**: must be agent-written, title ≤6 words, summary ≤2 sentences, a few tokens. Options: Codex `update_plan.explanation`; for Claude, a hook-injected one-line instruction (e.g. via `UserPromptSubmit` additional context) asking the agent to state a one-line summary that a hook then extracts; fall back to a truncated first user prompt. Choose the most reliable option; never make an extra model call.
- **"Right now" mini flow**: how to derive pills from recent tool events (e.g. last 3–4 meaningful actions within the active milestone: build/test/edit/command + outcome) and how to detect retries (`↻ attempt n`). Keep it heuristic and simple; unknown actions fall back to a plain "tool · file" line.
- State store location/format (e.g. per-job JSON files under a dot-directory in `$HOME`, atomic writes), file-watching vs polling, schema versioning.
- Stale threshold, cleanup of finished jobs (keep "done today" count).
- Who serves the web page (menubar app embedding a tiny localhost server vs. a separate small process); bind to localhost only.
- Minimum macOS version (suggest macOS 14+ for `MenuBarExtra` + Observation), app distribution (GitHub Releases, Homebrew cask, signing/notarization).
- Packaging: Claude Code plugin (marketplace) containing hooks + mod; Codex installer that merges into `~/.codex/hooks.json` and `config.toml` without clobbering existing entries (the user already has hooks there); uninstall path.
- Tech for collectors (Node/TS or Swift CLI or shell) — must start fast, not block the agent, and swallow its own errors.
- Repo layout, project name, license.

## 8. Suggested order (builder may adjust)

1. Spikes: capture real Claude `TaskCreate`/`TaskUpdate` payloads; check mod pane rendering in Claude desktop; check Codex in-app surface options.
2. Shared state schema + collectors for both tools.
3. Claude Code terminal mod pane.
4. Menubar app.
5. Web page.
6. Packaging/install docs for public release.
