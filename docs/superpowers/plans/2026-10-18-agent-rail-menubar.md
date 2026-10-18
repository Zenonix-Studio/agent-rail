# Agent Rail Menubar App (SwiftUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS menubar app that shows every running Claude Code and Codex job, read from `~/.agent-rail/sessions/*.json`. The icon shows a ring and counts. The popover shows a job list, and each job expands into a vertical rail with a "right now" block and the agents in that job.

**Architecture:** A read-only SwiftUI `MenuBarExtra` app. A `SessionStore` watches the sessions directory and decodes files into Codable models that mirror `docs/state-schema.md`. Pure derivation functions turn sessions into display items, and views render them. The app never writes state files.

**Tech Stack:** Swift 6, SwiftUI, Observation, macOS 14+, Xcode 26.3, XcodeGen (`/opt/homebrew/bin/xcodegen`). No third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-agent-progress-design.md` (§5.2 menubar, §5.1b). The data contract is `docs/state-schema.md`.

## Global Constraints

- Read-only. The app never writes, moves or deletes anything under the state root. No network access.
- State root: `$AGENT_RAIL_HOME` if set, else `~/.agent-rail`. Read `sessions/*.json`.
- Schema rules from `docs/state-schema.md`:
  - Ignore `_`-prefixed and unknown fields.
  - Skip files whose `schema` is greater than 1.
  - An unknown enum value must not fail the whole file.
- % = done ÷ total milestones. No milestones → `Planning · 0/?` and `—`, never a made-up %.
- Never show "active" styling on a `done` job.
- Only the main agent's milestones drive the rail and %. Subagents appear as one line each, under the job whose `seq` equals `agent.job`.
- One main session = one job card (the current job = the last element of `session.jobs`).
- Visual reference: `docs/superpowers/specs/mockups/menubar-v2.html` (popover, job groups, agents list) and `mockups/desktop-v2.html` card B (vertical rail).
  - Dark theme tokens: done `#5cb87a`, now/accent `#e08a5c`, warn `#d6a64a`, Codex tag `#8fa8ff`, muted `#9a998f`, line `#3a3a35`.
  - The app follows the system appearance. Define light equivalents too.
- UI strings are English, with a Turkish localization in a String Catalog.
- macOS 14.0 minimum. Bundle id `dev.agentrail.menubar`. The app is `LSUIElement` (no Dock icon).
- Build check on the host Mac: `xcodebuild -project menubar/AgentRail.xcodeproj -scheme AgentRail -destination 'platform=macOS' build`. The iOS-simulator rule does not apply to a macOS target.
- **No tests (user rule, TDD off).** Verify with `--dump`/`--snapshot` (Task 1, Task 3) against sample state, plus the build.
- Commit messages are in English and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A malformed, half-renamed, or schema-2 file.** Expect: that file is skipped and the rest still show. Checked in Task 1, step 4.
2. **Months of old session files (hundreds).** Expect: only files modified in the last 24 h are decoded, and the popover opens instantly. Checked in Task 2, step 3.
3. **A job stuck `running` after a crash** (no events for a long time). Expect: shown as stale (dimmed, "no activity for N min"). It is not counted in the icon ring, and it is hidden after 24 h. Checked in Task 1, step 4.
4. **State root missing or created later** (app launched before any agent ran). Expect: an empty state ("No agents running"), and the app picks up the directory once it appears. Checked in Task 2, step 3.
5. **Unknown enum values** (a future `status: "error"` or a new pill kind). Expect: decoded as an `.unknown` fallback and rendered neutrally. Checked in Task 1, step 4.

---

### Task 1: Project scaffold, models, derivations, `--dump`

**Files:**
- Create: `menubar/project.yml`
- Create: `menubar/AgentRail/AgentRailApp.swift` (a minimal `MenuBarExtra` with a placeholder label, so the app runs)
- Create: `menubar/AgentRail/Model/StateModels.swift`, `Model/Derivations.swift`, `Model/StateRoot.swift`
- Create: `menubar/AgentRail/Debug/DebugCommands.swift`
- Create: `menubar/SampleState/sessions/*.json`
- Generated and committed: `menubar/AgentRail.xcodeproj` (via `xcodegen generate`, so a clone builds without XcodeGen)
- Modify: `.gitignore` (add `menubar/build/`, `DerivedData/`, `xcuserdata/`)

**Interfaces:**
- Produces:
  - `enum StateRoot { static func url(environment: [String:String] = ProcessInfo.processInfo.environment) -> URL }`. Returns `$AGENT_RAIL_HOME`, or else `~/.agent-rail`.
  - Codable models (public fields only; Codable ignores unknown keys by default):
    - `struct Session: Decodable { schema: Int; source: Source; sessionId: String; cwd: String; project: String; updatedAt: Date; jobs: [Job]; agents: [String: Agent] }`
    - `Job { id, seq: Int, title, summary, prompt, status: JobStatus, milestones: [Milestone], startedAt: Date, updatedAt: Date, endedAt: Date?, now: Now? }`
    - `Milestone { key, title, status: MilestoneStatus }`
    - `Now { milestone: String, pills: [Pill], attempt: Int, file: String? }`
    - `Pill { label: String, kind: PillKind }`
    - `Agent { id, name, status: AgentStatus, activity: String, job: Int?, updatedAt: Date, endedAt: Date? }`
  - Enums, all `String`-backed. Each has an `unknown` case, and `init(from:)` falls back to `.unknown`:
    - `Source { claude, codex, unknown }`
    - `JobStatus { planning, running, waiting, done, error, unknown }`
    - `MilestoneStatus { pending, active, done, unknown }`
    - `PillKind { ok, warn, active, info, unknown }`
    - `AgentStatus { running, done, error, stale, unknown }`
  - `enum SessionDecoder { static func decode(_ data: Data) -> Session? }`. Uses ISO 8601 dates with fractional seconds. Returns `nil` on any error or when `schema > 1`.
  - `struct JobItem: Identifiable { let session: Session; let job: Job; var id: String { job.id } }`
  - In `Derivations.swift`, pure functions:
    - `func progress(_ job: Job) -> (done: Int, total: Int, pct: Int?)`. `pct = Int((100*done/total).rounded())`, or `nil` when `total == 0`.
    - `func isStale(_ item: JobItem, now: Date) -> Bool`. True when status is `running`/`planning` and `session.updatedAt` is more than 10 min before `now`.
    - `func visibleJobs(_ sessions: [Session], now: Date) -> [JobItem]`. Takes the current job of each session.
      - Drops `done` jobs, and jobs whose `session.updatedAt` is more than 24 h old.
      - Sort order: `waiting` first, then non-stale by `job.updatedAt` descending, then stale.
    - `func doneToday(_ sessions: [Session], now: Date, calendar: Calendar = .current) -> Int`. Counts jobs across all `jobs` arrays with `status == .done` and `endedAt` today.
    - `func agents(of item: JobItem) -> [Agent]`. Returns `session.agents.values` with `job == item.job.seq`, sorted running first, then by `updatedAt` descending.
    - `func activeMilestoneKey(_ job: Job) -> String?`. Returns `nil` for a done job. Otherwise `now.milestone` if it matches a key, else the first `active` milestone.
    - `func menubarSummary(_ items: [JobItem], now: Date) -> (jobs: Int, agents: Int, avgPct: Int?, attention: Bool)`. Counts only non-stale items. `agents` = 1 per job + its running subagents. `attention` = any item `waiting`.
  - `DebugCommands.run(arguments: [String]) -> Bool`. Called first in `AgentRailApp.init`. For `--dump`, it loads all sessions from `StateRoot.url()` once, prints one line per `visibleJobs` item plus a final summary line, then calls `exit(0)`. Line format:
    `<source> <status>[ stale] "<title>" <done>/<total> <pct|—> agents=<n> now=<label of last pill or ->`
    Summary format: `jobs=<n> agents=<n> avg=<pct|—> attention=<true|false> doneToday=<n>`. Returns `false` when no debug flag is present.

- [ ] **Step 1: Write `project.yml`.**
  - macOS app target `AgentRail`, deployment 14.0, Swift 6.
  - `INFOPLIST_KEY_LSUIElement: YES`, bundle id `dev.agentrail.menubar`, and the app sandbox off.
  - The app sandbox is off because the app reads `~/.agent-rail`. Sandboxing would require a user-chosen folder. Leave a `// ponytail:` note in `project.yml`, the upgrade path is a security-scoped bookmark if it ships on the App Store.
  - Run `cd menubar && xcodegen generate`.
- [ ] **Step 2: Implement the models, `StateRoot`, `SessionDecoder`, the derivations, and `--dump`.**
- [ ] **Step 3: Write the sample state in `menubar/SampleState/sessions/`.** Use the shapes from `docs/state-schema.md`, with neutral content:
  1. Claude, `running`: 5 milestones, 3 done and 1 active, `now` with pills `Build ok`, `Build failed warn`, `Edit LoginView.swift active`, `attempt` 2, and 2 agents (`job` 1) of which 1 is running.
  2. Codex, `running`: 6 milestones, 2 done.
  3. Claude, `waiting`: 4/5.
  4. Claude, `planning`: no milestones, `now` with 1 pill.
  5. Claude, `running`, but `updatedAt` 2 h before the dump time. This one is stale.
  6. A session whose current job is `done`, `endedAt` today.
  7. `broken.json` containing `{"sch`.
  8. A file with `"schema": 2`.
  9. A file with job `status: "exploded"` and a pill `kind: "sparkle"`.

  Dates are relative to "now". Write them with a small `scripts/sample-state.mjs` that prints the files with current timestamps. That way stale and done-today stay true on any day, and it fits the existing Node tooling.
- [ ] **Step 4: Verify.** Run `node scripts/sample-state.mjs menubar/SampleState`, then build, then `AGENT_RAIL_HOME=$PWD/menubar/SampleState <built app>/Contents/MacOS/AgentRail --dump`.
  Expected:
  - The waiting job is listed first. The Claude running job shows `3/5 60%` and `agents=3`. The planning job shows `0/0 —`. The stale job is last, marked ` stale`.
  - No line for the done job, `broken.json`, or the schema-2 file.
  - The `exploded` file is listed with status `unknown`.
  - The summary has `attention=true` and `doneToday=1`, and `jobs` excludes the stale one.
- [ ] **Step 5: Commit:** `feat(menubar): scaffold app, state models and derivations`

---

### Task 2: `SessionStore` and the menubar icon

**Files:**
- Create: `menubar/AgentRail/Model/SessionStore.swift`, `menubar/AgentRail/Views/RingIcon.swift`
- Modify: `AgentRailApp.swift` (the real label)

**Interfaces:**
- Consumes: Task 1's models, `SessionDecoder`, `StateRoot`, `visibleJobs`, `doneToday`, `menubarSummary`.
- Produces:
  - `@MainActor @Observable final class SessionStore`, with `init(root: URL = StateRoot.url())`, `private(set) var sessions: [Session]`, `var now: Date`, and computed `items: [JobItem]`, `summary`, `doneTodayCount`.
  - It reloads by listing `sessions/*.json`. It decodes only files whose modification date is within 24 h, and caches each file by `(path, mtime)` so unchanged files are not decoded again.
  - Change detection is a `DispatchSource.makeFileSystemObjectSource` on the `sessions` directory (`.write`, `.rename`, `.delete`). Atomic rename shows up as a directory write.
  - Debounce reloads by 150 ms. A 2 s timer updates `now` (for elapsed and stale). If the directory doesn't exist yet, the same timer retries opening the watcher.
  - `enum RingIcon { static func image(pct: Int?, attention: Bool) -> NSImage }`. Draws an 18×18 pt ring with `NSBezierPath`: the track at 30% alpha, and the arc proportional to `pct`. `nil` draws the track only.
    - `isTemplate = !attention`, so it adapts to the menubar appearance.
    - With `attention`, the arc is the accent `#e08a5c`.
  - The label is `HStack { Image(nsImage: RingIcon.image(...)); Text("\(jobs)") }`. The text is hidden when `jobs == 0`. The accessibility label reads "<n> jobs, <m> agents, <pct> percent".

- [ ] **Step 1:** Implement `SessionStore` and `RingIcon`, then wire the label in `AgentRailApp`. Use `MenuBarExtra(...).menuBarExtraStyle(.window)` with a placeholder content view.
- [ ] **Step 2:** Build with the command in Global Constraints. Expected: `** BUILD SUCCEEDED **`.
- [ ] **Step 3: Verify live behavior.**
  - Launch the built app with `AGENT_RAIL_HOME` pointing at an empty temp directory that has no `sessions/` folder.
  - Create `sessions/` and copy the sample files into it.
  - Within about 2 s, the count must update. Check it with the `--dump` path: add a `--dump-after <seconds>` variant to `DebugCommands` that runs the store, waits, then prints the same output.
  - Then generate 500 old files with an mtime 3 days ago (`touch -t`) next to the samples. Time `--dump`. Expected: under 0.5 s, with the same output as before.
- [ ] **Step 4: Commit:** `feat(menubar): live session store and ring icon`

---

### Task 3: Popover views (job list, rail detail, now block, agents)

**Files:**
- Create: `menubar/AgentRail/Views/Theme.swift`, `PopoverView.swift`, `JobRowView.swift`, `JobDetailView.swift`, `RailView.swift`, `NowBlockView.swift`, `AgentListView.swift`
- Modify: `AgentRailApp.swift` (content = `PopoverView`), `Debug/DebugCommands.swift` (`--snapshot`)

**Interfaces:**
- Consumes: `SessionStore`, `JobItem`, `progress`, `isStale`, `agents(of:)`, `activeMilestoneKey`.
- Produces: `--snapshot <out.png>`. It renders `PopoverView` for a store loaded once from `StateRoot.url()`, with the first job expanded, using `ImageRenderer` at scale 2, 340 pt wide, in dark appearance. It writes the PNG, then calls `exit(0)`.

Layout, matching the mockups:
- **`PopoverView`:** 340 pt wide.
  - Header: "Jobs" plus "`<n>` jobs · `<m>` agents".
  - A scrollable list of `JobRowView`. One job is expanded at a time; clicking a row toggles it. The default is the first item.
  - Footer: "Done today: `<n>`", an "Open folder" button (`NSWorkspace.shared.open(root)`), and "Quit" (`⌘Q`).
  - Empty state: "No agents running" plus a one-line hint, "Install the Claude plugin or run scripts/install-codex.mjs".
- **`JobRowView` (collapsed):**
  - A source tag (`CLAUDE` in accent, `CODEX` in `#8fa8ff`) and the title on one line, truncated.
  - The subtitle is `▸ <active milestone title> · <done>/<total>`, or `Planning · 0/?`. A stale job shows `No activity for <n> min` instead.
  - A 3 pt progress bar, then the % on the right (`—` when nil).
  - A "`<n>` agents" chip, and a "● waiting for you" badge in warn color when `waiting`.
  - Stale rows are drawn at 55% opacity.
- **`JobDetailView` (expanded):**
  - The same header row.
  - The summary in muted text, omitted when empty, plus the project name and the elapsed time (`startedAt` → `now`, formatted `4 min` / `1 h 12 min`).
  - Then a `RailView`, then the "Agents in this job" `AgentListView`. The list is omitted when empty.
- **`RailView`:**
  - A vertical rail, one row per milestone. The node is a 14 pt circle: done is filled green, active has an accent ring with a 4 pt glow, pending is a line-color ring. The connector is green below done nodes.
  - Done titles are muted. The active title is semibold.
  - `NowBlockView` is inserted under the node whose key equals `activeMilestoneKey(job)`.
  - If the key is `nil` but `now` has pills and the job isn't done, the now block goes under the rail.
  - On a done job, no node gets active styling.
- **`NowBlockView`:**
  - A rounded block on an accent background at 16% alpha.
  - Pills are separated by `→`: `ok` green text, `warn` amber, `active` filled accent with white text, `info`/`unknown` neutral.
  - A `↻ <attempt>` line appears only when `attempt ≥ 2`. A monospace `file` line, last path component plus parent folder, appears when it isn't nil.
- **`AgentListView`:** each row has a status dot, the name, and the activity, truncated.
  - Dot colors: running is accent, pulsing with a 1.2 s opacity animation, which is disabled under Reduce Motion. Done is green. Error is warn. Stale is muted.
- All colors come from `Theme` (the tokens in Global Constraints, plus light-mode variants).
- Every text uses `LocalizedStringKey` or `String(localized:)` so Task 4 can localize it.

- [ ] **Step 1:** Implement the views and `Theme`.
- [ ] **Step 2:** Implement `--snapshot`.
- [ ] **Step 3: Verify.** Build, then regenerate the samples, then run `AGENT_RAIL_HOME=$PWD/menubar/SampleState <app>/Contents/MacOS/AgentRail --snapshot /tmp/agentrail-popover.png` and look at the PNG.
  Expected:
  - The waiting job is on top, and the first job is expanded with the rail, the now block under "Build" with `↻ 2`, and the agents list.
  - The planning row shows `Planning · 0/?` and `—`.
  - The stale row is dimmed with "No activity for 120 min".
  - Compare the result against `mockups/menubar-v2.html`, and note any deviation in the report.
- [ ] **Step 4: Verify the expanded view for each case.** Run `--snapshot` once more with each other sample job expanded: add `--expand <jobId>` to `--snapshot`. Check that the done-styled rail never shows an active node.
- [ ] **Step 5: Commit:** `feat(menubar): popover with job list, rail, now block and agents`

---

### Task 4: Localization (EN + TR), accessibility, README section

**Files:**
- Create: `menubar/AgentRail/Localizable.xcstrings` (en source, tr)
- Modify: the views as needed, `project.yml` (`knownRegions: [en, tr]`), and `README.md` (create it if it doesn't exist; a short "Menubar app" section with build steps)

**Interfaces:**
- Consumes: Task 3's views.
- Produces: no new code interfaces.

- [ ] **Step 1: Add the String Catalog** with every UI string, and Turkish translations using the mockup wording ("İşler", "Bu işteki agent'lar", "Bugün biten", "seni bekliyor", "Planlıyor · 0/?", "Etkinlik yok: <n> dk", "Klasörü aç", "Çık", "Çalışan agent yok"). Make the plurals for "<n> jobs" / "<n> agents" correct in both languages.
- [ ] **Step 2: Add accessibility labels.**
  - Each row reads "<source>, <title>, <done> of <total> milestones, <pct> percent, <status>".
  - Rail nodes read "<title>, done|active|pending".
  - Every color-only signal also has text: the waiting badge already has text, and the stale state says "no activity".
- [ ] **Step 3: Write the README section.**
  - Requirements: macOS 14+ and Xcode 26.
  - The build command.
  - How to run against the sample state (`AGENT_RAIL_HOME=… open …`).
  - That the app is read-only and local.
  - How to regenerate the Xcode project (`xcodegen generate`).
- [ ] **Step 4: Verify.**
  - Build.
  - Run `--snapshot` with `-AppleLanguages '(tr)'` and confirm the Turkish strings and plurals in the PNG.
  - Run `--snapshot` normally and confirm English.
- [ ] **Step 5: Commit:** `feat(menubar): English and Turkish strings, accessibility, README`

---

## Out of scope here (Plan 3)

Launch at login, signed and notarized release, the Homebrew cask, the web page, and the public README beyond the menubar section.
