# Lessons

## 2026-10-19 — "now" flow showed raw tool names
- Mistake: pills were tool names (`Agent → Agent`, `mcp__x__y`). User wanted human-readable steps ("Plan hazırlanıyor → agent dispatch edildi → UI review ediliyor → hata düzeltiliyor").
- Rule: anything shown to the user as "what the agent is doing" must be a human sentence derived from the tool's own description fields (Bash `description`, Agent `description`, task `activeForm`, skill name, file name) — never a raw tool identifier.
- Rule: verify features with the user's real workflow (parallel subagents, short tasks without plans), not only with scripted fixtures; check the live UI (actual menubar, actual pane) against the approved mockup before calling it done.

## A "summary" means the work, not the step titles
- Correction (2026-10-19): a Done/Left recap built from milestone titles only repeated what the rail already shows; the user wanted what was actually found, changed or verified, and what is left.
- Rule: only the agent doing the work can write that. Get it from the agent (`progress:` lines), never by re-listing titles. Before building any "summary" UI, check that it says something the screen does not already show.
