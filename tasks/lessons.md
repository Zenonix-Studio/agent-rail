# Lessons

## 2026-10-19 — "now" flow showed raw tool names
- Mistake: pills were tool names (`Agent → Agent`, `mcp__x__y`). User wanted human-readable steps ("Plan hazırlanıyor → agent dispatch edildi → UI review ediliyor → hata düzeltiliyor").
- Rule: anything shown to the user as "what the agent is doing" must be a human sentence derived from the tool's own description fields (Bash `description`, Agent `description`, task `activeForm`, skill name, file name) — never a raw tool identifier.
- Rule: verify features with the user's real workflow (parallel subagents, short tasks without plans), not only with scripted fixtures; check the live UI (actual menubar, actual pane) against the approved mockup before calling it done.

## A "summary" means the work, not the step titles
- Correction (2026-10-19): a Done/Left recap built from milestone titles only repeated what the rail already shows; the user wanted what was actually found, changed or verified, and what is left.
- Rule: only the agent doing the work can write that. Get it from the agent (`progress:` lines), never by re-listing titles. Before building any "summary" UI, check that it says something the screen does not already show.

## The app's `scope` is not the rail's job boundary
- Desktop `update_plan` scope `continuation` means "builds on this conversation", not "same job". A whole new plan after every step was done is a new job, whatever the scope says.
- Do not rely on the agent writing a `rail:` line or picking the right scope: infer the split from the plan itself as well.

## Never chain a release onto an unverified edit
- Pattern: an Edit sent in parallel with a bump-and-install command failed (file not read), and the command still bumped, committed and installed a release without the change. The bump also skipped the user's per-version OK.
- Rule: make the edit, check it landed (grep or type-check), and only then bump. Every plugin bump waits for the user's yes, even for a one-line change.
