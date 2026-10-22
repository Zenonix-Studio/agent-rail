# agent-rail

A live rail for your Claude Code and Codex jobs: progress, milestones and the agents behind them.

## Menubar app

A native macOS menubar app that shows your running jobs. It reads the session files in `~/.agent-rail/sessions/*.json`.

- Read-only and local: it never writes to the state folder and sends nothing over the network.
- English and Turkish, following the system language.

Requirements: macOS 14+ and Xcode 26.

Build:

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

## History command

`/agent-rail:history` lists the last 50 finished jobs across sessions, newest first, in the terminal and the desktop app. `/agent-rail:history <number>` shows one of them in full: its steps, agents and closing summary. The menubar's **Done today** button shows the same list. `/agent-rail:history stats`, the pane's **Stats** tab (`/rail stats`) and the menubar's chart button show the tokens spent since the weekly limit reset: the last 1, 3 and 5 days and the last 3, 10, 25 and 50 jobs.

## Live view in a terminal split

Codex runs no Claude Code mod, so it has no pane. Type **`/prompts:rail`** in Codex (the Codex installer adds it): it opens the rail in a split beside Codex, in iTerm2 or tmux, or in a new Terminal window elsewhere. Codex may ask to run it outside its sandbox, since opening a split needs AppleScript. Or run it in a split by hand:

```bash
node ~/Projects/agent-rail/bin/agent-rail-watch.mjs           # the most recent Codex session
node ~/Projects/agent-rail/bin/agent-rail-watch.mjs claude    # the most recent Claude Code session (or `any`)
node ~/Projects/agent-rail/bin/agent-rail-watch.mjs 01a1652f  # one session, by the start of its id
```

It redraws the session's current job each second, as the pane draws it, and follows a newer session of the same source when one starts. `--agents` expands every agent row; Ctrl+C quits.

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
