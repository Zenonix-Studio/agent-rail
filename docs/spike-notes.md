# Hook payload spike notes

Captured 2026-10-18 with Claude Code 2.1.302 (`claude -p`) and codex-cli 0.162.1 (`codex exec`), using
`bin/agent-rail-collect.mjs --capture`. Fixtures in `fixtures/claude/` and `fixtures/codex/` are real
payloads, sanitized (ids replaced by stable fakes, prompts and last messages replaced by placeholders,
home and scratch paths replaced by `/home/user` and `/work/repo`). File name = `<event>[.<tool>][.subagent|.<variant>].json`.

How the runs were wired (nothing in the user's real config was kept):
- Claude: `claude -p ... --settings <repo>/.superpowers/spike/claude-capture-settings.json` (separate settings file, `~/.claude/settings.json` untouched).
- Codex: capture entries merged into `~/.codex/hooks.json`, run with `codex exec --dangerously-bypass-hook-trust`, then both `hooks.json` and `config.toml` restored byte-for-byte (sha1 verified).
- Hooks fire in the headless modes (`-p`, `exec`), so this is not interactive-only.

Fields common to every Claude hook: `session_id, transcript_path, cwd, prompt_id, hook_event_name`
(+ `permission_mode, effort` on most). Common to every Codex hook: `session_id, transcript_path, cwd,
hook_event_name, model, permission_mode` (+ `turn_id` on everything except SessionEnd; SessionStart has `source`).

## 1. Claude task tools

Incremental, not a snapshot: `TaskCreate`, `TaskUpdate`, `TaskList` (also `TaskGet`, `TaskStop` exist in the tool list). `TodoWrite` was **not** offered in 2.1.302 (the binary has both; task tools win).
Gate: in headless `-p` the task tools are absent unless env `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is set (without it the model
falls back to writing `tasks/todo.md`). Interactive sessions are expected to have them by default (inferred from the binary, not tested).

| Tool | Field paths |
|---|---|
| `TaskCreate` Pre/Post | `tool_input.{subject, description, activeForm}`; `tool_response.task.{id, subject}`. Ids are string counters per task list: `"1","2",...`. New tasks start `pending` (no status in create input). |
| `TaskUpdate` Pre/Post | `tool_input.{taskId, status}` (other optional fields such as subject/activeForm/description were not exercised); `tool_response.{success, taskId, updatedFields[], statusChange.{from,to}}`. Seen statuses: `pending`, `in_progress`, `completed`. `deleted` not observed. |
| `TaskList` Post | `tool_response.tasks[].{id, subject, status, blockedBy[]}` (full snapshot, no activeForm/description). |
| `TaskCreated` event | `task_id, task_subject, task_description` (no tool_use_id). |
| `TaskCompleted` event | same three fields; fires when a task moves to completed. |

Caveat: `TaskCompleted` was seen firing 3 times for 3 tasks plus once more on a redundant completed->completed update, so de-dupe by `task_id`.
`activeForm` is only available on the `TaskCreate` tool_input, not on the `TaskCreated` event.

## 2. Claude "waiting for the user" signal

`Notification` did **not** fire in headless mode (open item: needs an interactive run to capture its `notification_type`/`message`).
What did fire: **`PermissionRequest`** (fixture `PermissionRequest.Bash.json`): `tool_name, tool_input, permission_suggestions[]`, sent after `PreToolUse` when
permission mode `default` and the tool is not allowed; headless then auto-denied and the turn ended with `Stop`. Treat `PermissionRequest` as the primary
"waiting" signal for Claude and `Notification` as an additional one to verify interactively. Clear the waiting state on the next `PostToolUse`/`PostToolUseFailure`/`Stop`.

## 3. Last assistant message on Stop

- Claude `Stop`: yes, `last_assistant_message` (also `stop_hook_active, background_tasks[], session_crons[]`). `SubagentStop`: yes, same field plus `agent_transcript_path`.
- Codex `Stop`: yes, `last_assistant_message` (+ `stop_hook_active`). `SubagentStop`: yes, plus `agent_transcript_path`.

## 4. Codex tools in PreToolUse/PostToolUse

- Shell: `tool_name:"Bash"`, `tool_input.command` (string). `tool_response` is a **plain string** of the output; **no exit code, no failure event** (a failing `ls` still arrives as `PostToolUse` with just stderr text). Failure cannot be detected from the Bash payload.
- Edits: `tool_name:"apply_patch"`, `tool_input.command` = the whole patch text (`*** Begin Patch\n*** Add File: hello.txt\n+hi\n*** End Patch`); file paths come from the `*** Add|Update|Delete File:` lines. `tool_response` is a string: `Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nA hello.txt\n`, so apply_patch does carry an exit code in text.
- Plan: `tool_name:"update_plan"`, `tool_input.plan[].{step, status}` (`pending|in_progress|completed`), optional `explanation` (not emitted in these runs); `tool_response:"Plan updated"`. Each call is the full snapshot.
- Subagent tools: `collaborationspawn_agent` (`tool_input.{task_name, fork_turns, message}`, message was an opaque encrypted blob; `tool_response` is a JSON string `{"task_name":"/root/<name>"}`) and `collaborationwait_agent` (`tool_input.timeout_ms`; response JSON string). Note the namespace and name are concatenated with no separator.
- A tool denied by the sandbox/approval policy yields `PreToolUse` and no `PostToolUse` (seen with apply_patch in read-only, `approval_policy=on-request`).
- `update_plan` is NOT available by default in 0.162.1 (the model reported it unavailable). `codex exec -c tools.update_plan.enabled=true` (also accepted by `--strict-config`) enables it; TOML equivalent is `[tools.update_plan]` with `enabled = true`. I did not write it to `config.toml` (restored to original/absent; the user has not agreed to keep it).
- No `PermissionRequest` / approval event fired in `codex exec` (it never prompts). Open item: capture the Codex approval signal interactively.

## 5. UserPromptSubmit `additionalContext`

Works in both. A hook printing this on stdout (exit 0) was injected into the model context (model answered with the magic word from it) in Claude and Codex:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<text>"}}
```

Claude `UserPromptSubmit` input: `prompt, prompt_id, permission_mode`. Codex: `prompt, turn_id, model`. A new prompt in the same session
is detected in Claude by a new `prompt_id`, in Codex by a new `turn_id`; Codex `exec resume --last` produced `SessionStart` with `source:"resume"` (vs `"startup"`) and the same `session_id`.

## 6. Subagent marking

- Claude: `SubagentStart` has only `agent_id, agent_type` (e.g. `general-purpose`) plus common fields. Every hook fired inside the subagent (`PreToolUse`/`PostToolUse`) carries `agent_id` and `agent_type`; main-session hooks lack both. `SubagentStop` carries `agent_id, agent_type, agent_transcript_path, last_assistant_message`. The parent's `PreToolUse` for tool `Agent` has `tool_input.{description, prompt, subagent_type, run_in_background}`, and its `PostToolUse` `tool_response` has `agentId, agentType, status` (links parent tool call to agent). Subagent `session_id` equals the parent's.
- Codex: `SubagentStart` has `agent_id` (UUID), `agent_type` (`"default"`) and its own `turn_id`; tool hooks inside the subagent carry `agent_id, agent_type`; `session_id` equals the parent's; `SubagentStop` adds `agent_transcript_path` (a rollout file) and `last_assistant_message`. Order seen: parent `PreToolUse collaborationspawn_agent` -> `PostToolUse` -> `SubagentStart`, with `wait_agent` Pre before and Post after `SubagentStop`.

## Other findings

- Claude `PostToolUse` fires for success only; failed tools fire **`PostToolUseFailure`** with `error` (e.g. `"Exit code 1\nls: ...: No such file or directory"`), `is_interrupt`, `duration_ms` (no `tool_response`). Successful Bash: `tool_response.{stdout, stderr, interrupted, isImage, noOutputExpected}`.
- Claude Write/Edit `tool_input.file_path`; Edit/Write responses include `filePath`, `type`, `structuredPatch`, `originalFile` (large).
- `SessionEnd`: Claude and Codex both send `reason` (seen `"other"`).
- Codex clamps hook timeouts for `SessionEnd` to 3 s.
- Codex `exec` needed `--dangerously-bypass-hook-trust` here; hooks in `hooks.json` are otherwise subject to a trust review (`[hooks.state]` hashes in config.toml). Not tested without the flag.
- Codex also rewrites `config.toml` on its own (adds `[projects."<cwd>"] trust_level`) when run in a new directory; unrelated to hooks.

## Open items

1. Claude `Notification` event shape (type/message) needs an interactive session.
2. Codex approval/permission signal needs an interactive session.
3. `TaskUpdate` with subject/activeForm/description/`deleted` status, and `TaskGet`, not exercised.
4. Whether interactive Claude exposes the task tools without the env flag (inferred yes).
5. Codex `update_plan` `explanation` field and whether `PermissionRequest` exists in Codex hooks (we registered it; nothing fired).

## 7. Claude Code mod sandbox (Task 7)

Checked 2026-10-18 on Claude Code 2.1.302 with a throwaway mod loaded by `claude -p --plugin-dir`, then in an interactive tmux session.

- `$.fs.read` / `$.fs.list` on absolute paths outside the working directory work: the mod read `~/.agent-rail/sessions/claude-<id>.json` with no extra permission. The in-memory `reduce` fallback is **not needed**.
- `$.env.get('HOME')` answers the home directory (the module has no Node, so no `os.homedir()`); `AGENT_RAIL_HOME` is honored the same way as in `core/state.mjs`.
- `$.session.id()` equals the `session_id` the settings hooks receive (seen in `classic.UserPromptSubmit`), so the mod finds its own session file.
- There is no file-watch API on `$.fs`; the mod polls with `$.clock.every(1000)` and writes `$.state` only when the file text (or, for a live job, the elapsed second) changed.
- The mod cannot import `core/state.mjs` (it imports `node:fs`). `progress()` moved to the pure `core/progress.mjs`; `state.mjs` re-exports it.
- One plugin carries both kinds of hooks: `hooks/hooks.json` keeps its `hooks` (command hooks) and adds `"modules": ["../mod/register.tsx"]`; `claude plugin validate` accepts it.
- Placement: a pane opened unasked is placed only from 144 columns, so on narrower terminals the mod draws the same lines in the `AbovePrompt` band instead; `/rail` opens the pane at any width (docked beside the transcript in fullscreen, inline above the prompt otherwise). The band yields while the pane is shown.
- An interactive `--plugin-dir` session writes `.claude-plugin/types/` (self-ignored) and a root `tsconfig.json` that extends it.

Desktop app: **pending** (Task 7 step 4 not run; the controller will ask the user). Expected per the mod docs: `ui.render` hooks also draw for the `desktop` surface, but the mod has only been seen on the terminal.
