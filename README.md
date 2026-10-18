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

Run against the sample state:

```sh
node scripts/sample-state.mjs menubar/SampleState
AGENT_RAIL_HOME=$PWD/menubar/SampleState \
  open menubar/build/Build/Products/Debug/AgentRail.app
```

The Xcode project is generated from `menubar/project.yml`. After changing it, regenerate with:

```sh
cd menubar && xcodegen generate
```
