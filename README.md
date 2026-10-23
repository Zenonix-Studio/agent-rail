# agent-rail

A live rail for your Claude Code and Codex jobs: progress, milestones and the agents behind them.

<p align="center"><img src="docs/images/menubar.png" width="454" alt="The AgentRail menubar popover: three jobs with their steps, the current step's activity and the agents running under them"></p>

## Claude Code

Needs Node 18 or later on PATH. In Claude Code (terminal or desktop app):

```
/plugin marketplace add Zenonix-Studio/agent-rail
/plugin install agent-rail@agent-rail
```

Restart Claude Code. Both the desktop app and the terminal get an **Agent rail** pane beside the chat (`/rail` toggles it), plus `/agent-rail:history` and, if you add it, the status line below.

<p align="center">
  <img src="docs/images/claude-desktop.png" width="430" alt="The Agent rail pane in the Claude desktop app: a finished job with four stage-colored steps and their durations, the Explore agent with its own steps, and the closing summary">
  <img src="docs/images/claude-cli.png" width="430" alt="The Agent rail pane in the Claude Code terminal: the job at 25 percent, the current step, a running Explore agent with its own steps, and the latest progress note">
</p>
<p align="center"><sub>The pane in the desktop app (left) and in the terminal (right)</sub></p>

**What it changes in Claude.** To draw a rail, the plugin's prompt hook asks Claude to start each new task with one `rail: <title> — <summary>` line, to keep a 3–7 step task list with a stage on each step (`plan:`, `dev:`, `fix:`…), and to add a one-sentence progress note to its task updates. Subagents are asked to write short `step:` and `progress:` lines. Nothing else about how Claude works changes; uninstall the plugin to drop it.

## Menubar app

A native macOS menubar app that shows your running jobs. It reads the session files in `~/.agent-rail/sessions/*.json`.

- Local: it never writes to the state folder and sends nothing over the network.
- English and Turkish, following the system language.
- A card with no activity can be hidden (**Hide**), or its session stopped (**Stop session…**, right-click or under the expanded card). Stopping ends the whole Claude Code or Codex session and its agents, after a confirmation; it is offered only while the process the hooks last ran under is still that one (same pid and start time).

**Install:** download `AgentRail-<version>.dmg` from [Releases](https://github.com/Zenonix-Studio/agent-rail/releases), open it and drag AgentRail into Applications. It runs in the menubar (no Dock icon) and needs macOS 14 or later. Allow notifications when it asks, to hear when a job is done, needs you or is failing.

<details>
<summary>Build from source</summary>

Requirements: macOS 14+ and Xcode 26.

```sh
xcodebuild -project menubar/AgentRail.xcodeproj -scheme AgentRail \
  -destination 'platform=macOS' -derivedDataPath menubar/build build
```

Install it to get notifications (job done, needs you, failing). macOS only asks for notification permission for an app in an Applications folder; run from `menubar/build`, the request is denied without a prompt. Sign it with your own development team:

```sh
xcodebuild -project menubar/AgentRail.xcodeproj -scheme AgentRail \
  -destination 'platform=macOS' -derivedDataPath menubar/build build \
  DEVELOPMENT_TEAM=<your team id> CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development"
cp -R menubar/build/Build/Products/Debug/AgentRail.app ~/Applications/
open ~/Applications/AgentRail.app
```

If a denied prompt was recorded earlier, turn AgentRail on in System Settings > Notifications. `AgentRail.app/Contents/MacOS/AgentRail --notify-test` (via `open --args`) prints the permission state and posts a test notification.

Run against the sample state (written to a temp dir, so the working tree stays clean; quit any running copy first, since `open -n` starts a second instance):

```sh
node scripts/sample-state.mjs /tmp/agent-rail-sample
open -n --env AGENT_RAIL_HOME=/tmp/agent-rail-sample \
  menubar/build/Build/Products/Debug/AgentRail.app
```

The Xcode project is generated from `menubar/project.yml`. After changing it, regenerate with:

```sh
cd menubar && xcodegen generate
```

To pack a DMG: `scripts/release-menubar.sh --unsigned` for a local try, or with `DEVELOPER_ID` and `NOTARY_PROFILE` set for a signed, notarized one (the script prints the one-time setup).

</details>

## History command

`/agent-rail:history` lists the last 50 finished jobs across sessions, newest first, in the terminal and the desktop app. `/agent-rail:history <number>` shows one of them in full: its steps, agents and closing summary. The menubar's **Done today** button shows the same list. `/agent-rail:history stats`, the pane's **Stats** tab (`/rail stats`) and the menubar's chart button show the tokens spent since the weekly limit reset: the last 1, 3 and 5 days and the last 3, 10, 25 and 50 jobs.

## Codex

Codex has no pane, so the rail opens in a terminal split beside it. Set it up once:

```bash
git clone https://github.com/Zenonix-Studio/agent-rail ~/agent-rail
node ~/agent-rail/scripts/install-codex.mjs
```

Then, in a split beside Codex:

```bash
node ~/agent-rail/bin/agent-rail-watch.mjs
```

That is all: it follows the latest Codex session. As in the Claude pane, `n`, `h` and `s` switch between **Now**, **History** and **Stats**; `q` quits.

<p align="center"><img src="docs/images/codex-terminal.png" width="600" alt="The live rail of a Codex job in a terminal: its summary, stage-colored steps and durations, the current step's activity and the latest progress note"></p>


<details>
<summary>More</summary>

- Shortcut: the installer puts `rail` on PATH, the same command. Inside Codex, `$rail` opens it in a split in iTerm2, tmux, WezTerm or kitty (remote control on); elsewhere in a new Terminal window (the agent-rail hook opens it, outside the sandbox, so no approval is asked).
- Add `claude` for the latest Claude Code session instead, an id prefix for one session, `--agents` to expand every agent row.
- The installer adds the agent-rail hooks to `~/.codex/hooks.json` (backed up first, your own hooks kept), adds the `$rail` skill, and links `rail` into `~/.local/bin` (or the first writable folder of your PATH). Codex asks you to trust the new hooks on its next start.
- Steps need Codex's `update_plan` tool. The installer asks before turning it on in `~/.codex/config.toml` (`--yes` turns it on, `--no-plan` skips the question; with no terminal to ask in, it skips). If your config already has a `[tools]` section it only prints the line to add yourself: `[tools.update_plan]` with `enabled = true`.
- Codex jobs also show in the menubar, with their tokens (the main agent's and each subagent's).
- Undo it all: `node ~/agent-rail/scripts/uninstall-codex.mjs`.

</details>

## Status line

`bin/agent-rail-statusline.mjs` prints one line for the current session's job in Claude Code's status line: stage, current step, progress, elapsed time, time left (once a step has finished) and running agents.

```
● dev · Editing parser.mjs · 3/5 · 2m10s · ~4m left · 2 agents
```

Add it to your Claude Code settings (`~/.claude/settings.json`):

```json
"statusLine": {"type": "command", "command": "node <path>/bin/agent-rail-statusline.mjs"}
```

It prints nothing when the session has no job yet. Set `NO_COLOR` to drop the colors.

## Privacy

Everything stays on your machine; nothing is sent over the network. The hooks write one file per session to `~/.agent-rail/sessions/` (folder 0700, files 0600). Those files hold your prompts' text, job titles, step names, summaries, file names the agents touched and token counts. Files not written for 30 days are deleted. Collector errors go to `~/.agent-rail/collector.log`. Set `AGENT_RAIL_HOME` to keep them elsewhere.

## License

MIT, see [LICENSE](LICENSE).
