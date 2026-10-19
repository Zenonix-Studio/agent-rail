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
