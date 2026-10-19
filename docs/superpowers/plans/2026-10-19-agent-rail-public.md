# Agent Rail Web Page + Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local web page that shows every job as a card, and make agent-rail installable by strangers. That means hardening for long-term use, a signed and notarized menubar build script, and public docs under `Zenonix-Studio/agent-rail` with an MIT license.

**Architecture:** The web page is a zero-dependency Node HTTP server bound to `127.0.0.1`. It serves one static page plus a JSON/SSE API built from the same session files the menubar reads. Release packaging is a shell script around `xcodebuild archive`, `codesign`, `notarytool` and `stapler`. Publishing to GitHub is a separate, gated step that the controller runs only after the user confirms. No subagent pushes anything.

**Tech Stack:** Node ≥ 18 plain ESM with JSDoc and zero deps, vanilla HTML/CSS/JS, Bash, Xcode 26.3 tooling, GitHub Actions (macOS runner).

**Spec:** `docs/superpowers/specs/2026-10-18-agent-progress-design.md` (§2 goal 4 web page, §2 goal 6 easy install, §4 anti-goals). Contract: `docs/state-schema.md`.

## Global Constraints

- **Everything local.** The web server binds `127.0.0.1` only. It rejects requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>`, to block DNS rebinding. It sends no CORS headers and makes no outbound network calls.
- **The web API never exposes `_`-prefixed fields.** It follows the reader rules in `docs/state-schema.md`: ignore unknown fields and skip files with `schema > 1`.
- **Same display rules as the menubar** (`menubar/AgentRail/Model/Derivations.swift`):
  - Current job = the last element of `jobs`.
  - Hide `done` jobs and sessions with `updatedAt` older than 24 h.
  - Stale = `running`/`planning` with no update for 10 min, or 60 min when the last pill is `active`.
  - % = done ÷ total milestones. With no milestones show `Planning · 0/?` and `—`.
  - A done job never gets active styling. Title fallback order: title → prompt → project → "Untitled job".
- **Visual reference:** card B in `docs/superpowers/specs/mockups/desktop-v2.html`, using the menubar `Theme.swift` tokens with both light and dark variants.
- **Repository and owner:** `https://github.com/Zenonix-Studio/agent-rail`. License MIT, copyright "Zenonix Studio".
- **Distribution:** a signed + notarized `AgentRail-<version>.zip` attached to a GitHub Release. No Homebrew.
  - This machine has **no Developer ID certificate installed**. The release script takes the identity and the notary profile from env vars and fails with a clear message when they are missing.
  - An `--unsigned` mode exists for local verification only.
- **Version:** `0.1.0` everywhere. That covers `package.json`, `.claude-plugin/plugin.json`, the marketplace entry and the app's `MARKETING_VERSION`.
- **Nothing in this plan pushes, tags, creates a repo or uploads.** Task 5 is controller-only and gated on the user's explicit OK.
- **No tests (user rule, TDD off).** Verify with commands and renders.
- **Commits** are in English and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A request from a non-local origin or a rebinding host** (`Host: evil.com:4317`). Expect 403 and no state in the body. Checked in Task 1, step 4.
2. **A session folder with months of files plus a burst of hook writes.** Expect the web server to coalesce `fs.watch` events: one SSE push per 250 ms at most. Only files changed in the last 24 h are read. Checked in Task 1, step 4.
3. **The state folder growing forever** (the collector never deletes). Expect session files older than 30 days to be pruned at most once a day, and `collector.log` to stay under 1 MB. Checked in Task 2, step 3.
4. **The repo moved or reinstalled from another clone.** Expect `install-codex.mjs` to rewrite our existing entry to the new path, never adding a duplicate. It uses `process.execPath` for node. Checked in Task 2, step 3.
5. **The release script run without a certificate.** Expect a clear "set DEVELOPER_ID / NOTARY_PROFILE" message and a non-zero exit, with nothing half-built left in `dist/`. Checked in Task 3, step 3.

---

### Task 1: Local web page

**Files:**
- Create: `web/server.mjs`, `web/derive.mjs`, `web/public/index.html`, `web/public/app.js`, `web/public/style.css`, `bin/agent-rail-web.mjs`
- Modify: `package.json` (`"bin": {"agent-rail-web": "bin/agent-rail-web.mjs"}`)

**Interfaces:**
- Consumes: `stateRoot()` and `progress()` from `core/state.mjs` / `core/progress.mjs`.
- Produces:
  - `web/derive.mjs`, a port of the menubar derivations with the same rules as Global Constraints:
    - `publicSession(raw): object|null`. Strips `_` keys recursively and returns `null` when `schema > 1` or the shape is invalid.
    - `visibleJobs(sessions, now): Card[]`, where `Card = {id, source, project, title, summary, status, stale, done, total, pct, milestones, now, agents, startedAt, updatedAt}`.
    - `agents` holds only the agents with `job === seq`.
    - Sort order: waiting first, then non-stale by `updatedAt` descending, then stale. Ties are broken by `id`.
  - `web/server.mjs`: `startServer({port = 4317, root = stateRoot()}) → Promise<{url, close()}>`. Routes:
    - `GET /` serves `index.html`. Static assets come from `web/public/`.
    - `GET /api/jobs` returns `{jobs: Card[], doneToday, generatedAt}`.
    - `GET /api/events` is SSE. It sends `event: jobs` with the same payload on start and after every coalesced change. Use `fs.watch` on the `sessions` dir with a 250 ms debounce, plus a 30 s keepalive comment. If the dir is missing, retry every 5 s.
    - The Host check from Global Constraints applies to every route. Unknown paths get 404.
  - `bin/agent-rail-web.mjs [--port N] [--open]`. Prints the URL. `--open` runs `open <url>` on macOS. Ctrl-C exits cleanly.
  - The page renders a responsive card grid (1–3 columns) in card B style: source tag, title, summary, rail with the now block under the active node, and an agents list. It shows a "Done today: n" footer and an empty state.
    - Light and dark follow `prefers-color-scheme`.
    - It reconnects SSE with backoff and shows a "disconnected" chip while down.
    - It is plain DOM rendering with no framework, and it escapes all text, since state holds prompts.

- [ ] **Step 1:** Implement `derive.mjs`, then the server, then the page.
- [ ] **Step 2: Verify the cards against the menubar's dump.** Run `node scripts/sample-state.mjs /tmp/ar-web`, then `AGENT_RAIL_HOME=/tmp/ar-web node bin/agent-rail-web.mjs --port 4317 &`, then `curl -s 127.0.0.1:4317/api/jobs`.
  - Expected: the same jobs, order and counts as `menubar/build/.../AgentRail --dump` on the same dir (build the app first).
  - No `_` key anywhere: `grep -c '"_'` returns 0.
- [ ] **Step 3: Verify the page.** Screenshot it with headless Chrome or Safari if available (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --screenshot=… --window-size=1200,900 http://127.0.0.1:4317`), in both color schemes if possible. Look at the PNG and compare it with card B. If no headless browser exists, say so and describe a manual check.
- [ ] **Step 4: Verify security and coalescing.**
  - `curl -H 'Host: evil.com:4317' …` returns 403.
  - The server is not reachable on the LAN IP (`curl <en0 ip>:4317` fails).
  - Write 50 session files in 1 s (atomic rename). The SSE client receives ≤ 5 `jobs` events.
- [ ] **Step 5: Commit:** `feat(web): local job board with live updates`

---

### Task 2: Hardening for long-term public use

**Files:**
- Modify: `bin/agent-rail-collect.mjs`, `core/state.mjs`, `scripts/install-codex.mjs`, `scripts/codex-hooks-lib.mjs`, `scripts/uninstall-codex.mjs`
- Create: `scripts/install-claude-todos.mjs` (opt-in helper)

**Interfaces:**
- Produces:
  - `pruneOldSessions(root, {maxAgeDays = 30, now}) → number` in `core/state.mjs`. Deletes `sessions/*.json` whose mtime is older than 30 days, and returns the count.
    - The collector calls it at most once per 24 h, tracked by the mtime of `<root>/.last-prune`, and only on `session-end` or `stop` events.
    - It runs after the session write and inside the existing try/catch. It never touches the current session's file.
  - Log cap: before appending to `collector.log`, if it exceeds 1 MB, rename it to `collector.log.1` (replacing the old one).
  - `install-codex.mjs`:
    - The hook command uses `process.execPath` (absolute node) plus the absolute script path.
    - If an agent-rail entry already exists with a different command, it is replaced in place, so no duplicates.
    - `hooks.json` is written atomically (temp + rename, mode 0600).
    - A non-array event value in the user's file is left untouched with a warning, never replaced.
  - `scripts/install-claude-todos.mjs [--yes]`:
    - Backs up `~/.claude/settings.json` to `.agent-rail.bak`, only if no backup exists yet.
    - Sets `env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1"`, keeping every other key. It is idempotent, prints what it changed, and asks y/N unless `--yes`.
    - `--undo` removes only that key.

- [ ] **Step 1:** Implement the items above.
- [ ] **Step 2:** Update `docs/state-schema.md` with one line on retention: files older than 30 days may be deleted by the collector.
- [ ] **Step 3: Verify.** Use a temp `AGENT_RAIL_HOME` and a temp `HOME`/`CODEX_HOME`. Never touch the real ones.
  - 40 session files touched 40 days ago plus a stop event → they are deleted once. A second stop in the same day deletes nothing.
  - A 2 MB `collector.log` is rotated.
  - Install, then install again from a copied repo path → exactly one entry per event, pointing at the new path.
  - `install-claude-todos --yes`, then `--undo`, round-trips the settings JSON semantically.
  - Re-run `node scripts/replay.mjs` on every `fixtures/scenarios/*` → unchanged.
- [ ] **Step 4: Commit:** `feat: retention, log cap, relocatable Codex install, todo opt-in helper`

---

### Task 3: Signed + notarized menubar release script

**Files:**
- Create: `scripts/release-menubar.sh`, `menubar/ExportOptions.plist`
- Modify: `menubar/project.yml`:
  - `ENABLE_HARDENED_RUNTIME: YES`
  - `MARKETING_VERSION: 0.1.0`, `CURRENT_PROJECT_VERSION: 1`
  - `CODE_SIGN_STYLE: Manual` for Release only
  - Debug stays ad-hoc.
  - Regenerate the xcodeproj.
- Modify: `.gitignore` (`dist/`)

**Interfaces:**
- Produces `scripts/release-menubar.sh [--unsigned]`:
  1. Reads the version from `package.json`. Fails if it differs from `MARKETING_VERSION` in `project.yml`.
  2. Unless `--unsigned`, requires `DEVELOPER_ID` (e.g. `Developer ID Application: Zenonix Studio (TEAMID)`) and `NOTARY_PROFILE` (a `notarytool store-credentials` keychain profile name). If either is missing, it prints how to set them up (two commands) and exits 2 before building.
  3. Runs `xcodebuild archive -scheme AgentRail -configuration Release -destination 'generic/platform=macOS' -archivePath build/AgentRail.xcarchive`, then `-exportArchive` with `ExportOptions.plist` (method `developer-id`).
  4. Signed path: `codesign --verify --deep --strict`, then zip with `ditto -c -k --keepParent`, then `xcrun notarytool submit --keychain-profile "$NOTARY_PROFILE" --wait`, then `xcrun stapler staple` on the .app, then re-zip.
  5. Output: `dist/AgentRail-<version>.zip` and its `shasum -a 256` printed. It works in a temp dir and moves the result into `dist/` only on success, so a failed run leaves no partial artifact.
  6. `--unsigned`: Release build signed ad-hoc (`-`), zipped as `dist/AgentRail-<version>-unsigned.zip`. It prints a warning that Gatekeeper will block it.

- [ ] **Step 1:** Implement the script and the `project.yml` changes.
- [ ] **Step 2:** Run `bash scripts/release-menubar.sh --unsigned`. Expected: a zip in `dist/`. It unzips to an `.app` that launches with `--dump` against the sample state. `codesign -dv` shows ad-hoc and `flags=0x10000(runtime)`.
- [ ] **Step 3:** Run `bash scripts/release-menubar.sh` with no env vars. Expected: exit 2, the setup instructions printed, and `dist/` unchanged. Don't attempt a real signed run; the user does it with their certificate.
- [ ] **Step 4: Commit:** `build(menubar): signed and notarized release script`

---

### Task 4: Public docs, metadata, CI

**Files:**
- Create: `LICENSE` (MIT, `Copyright (c) 2026 Zenonix Studio`), `docs/images/` (2 to 3 PNGs: menubar popover dark, light, web page), `.github/workflows/ci.yml`, `CHANGELOG.md` (0.1.0 entry)
- Modify:
  - `README.md` (full rewrite)
  - `package.json` (`version`, `license: MIT`, `repository`, `description`)
  - `.claude-plugin/plugin.json` (`version: 0.1.0`, `description`, `author: {name: "Zenonix Studio"}`, `homepage`, `repository`, `license`)
  - `.claude-plugin/marketplace.json` (`owner: {name: "Zenonix Studio"}`, version, and change `"./"` to `"."` per the docs)
  - `docs/spike-notes.md` (Install note: point at the GitHub form)

**README sections, in order:**
1. One-line pitch plus the popover screenshot.
2. What it shows (summary, milestone rail, %, now block, agents), as a short bullet list.
3. **Install.** Each surface gets its own subsection:
   - **Claude Code** (terminal and desktop): `/plugin marketplace add Zenonix-Studio/agent-rail` then `/plugin install agent-rail@agent-rail`. Then the todo opt-in via `node scripts/install-claude-todos.mjs`, or the manual `env` key, with the reason. Say that the plugin needs Node ≥ 18 on PATH.
   - **Codex:** clone, then `node scripts/install-codex.mjs`. Explain the `update_plan` prompt and hook trust approval.
   - **Menubar app:** download from Releases, or build from source (existing section).
   - **Web page:** `node bin/agent-rail-web.mjs --open`.
4. **Privacy:** local only, files in `~/.agent-rail` with 0600/0700 permissions, contain prompt text, pruned after 30 days, no network calls, web bound to 127.0.0.1.
5. **How it works:** a short diagram in text (hooks → collector → state files → viewers), linking `docs/state-schema.md`.
6. **Uninstall:** each surface, including `--undo` for the todo opt-in and `uninstall-codex.mjs`.
7. **Known limits:**
   - The Codex shell has no exit codes, so it never shows "failed".
   - Codex has no waiting signal.
   - Claude milestones need the todo tools.
   - Desktop pane rendering is unverified, so the menubar is the desktop view.
8. **License.**

**CI:** on push and PR, on `macos-15` (or latest), Node 20.
- Run every `fixtures/scenarios/*` through `scripts/replay.mjs`.
- Run the collector garbage check (exit 0, empty stdout).
- Run `xcodebuild -project menubar/AgentRail.xcodeproj -scheme AgentRail -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO`.

- [ ] **Step 1:** Write the files above.
  - Generate the screenshots with the menubar `--snapshot` (dark, then `--light`) against fresh sample state, and the web page via the Task 1 headless method.
  - Check that no personal path, username or email appears in the docs or images: `grep -rn '/Users/\|anilkul\|@gmail' -- . ':!menubar/build'`.
- [ ] **Step 2: Verify.**
  - `claude plugin validate .` passes with no warnings.
  - Run the CI steps locally: the same commands as the workflow, in order.
  - `npx --yes markdown-link-check README.md` if available. Otherwise check the links by hand: every relative link must point to an existing file.
- [ ] **Step 3: Commit:** `docs: public README, MIT license, CI, 0.1.0 metadata`

---

### Task 5 (controller-only, gated): Publish

Do not dispatch this task. The controller asks the user before each outward step and stops if the answer is no.

1. Run `gh repo create Zenonix-Studio/agent-rail --public --source . --push`, after the user confirms the repo name and visibility.
2. Run `git tag v0.1.0 && git push origin v0.1.0`, after the user confirms.
3. The user runs `DEVELOPER_ID=… NOTARY_PROFILE=… bash scripts/release-menubar.sh` with their certificate.
4. Run `gh release create v0.1.0 dist/AgentRail-0.1.0.zip --notes-file <CHANGELOG 0.1.0 section>`, after the user confirms.
