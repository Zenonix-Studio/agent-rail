# Lessons

## 2026-10-19 — "now" flow showed raw tool names
- Mistake: pills were tool names (`Agent → Agent`, `mcp__x__y`). User wanted human-readable steps ("Plan hazırlanıyor → agent dispatch edildi → UI review ediliyor → hata düzeltiliyor").
- Rule: anything shown to the user as "what the agent is doing" must be a human sentence derived from the tool's own description fields (Bash `description`, Agent `description`, task `activeForm`, skill name, file name) — never a raw tool identifier.
- Rule: verify features with the user's real workflow (parallel subagents, short tasks without plans), not only with scripted fixtures; check the live UI (actual menubar, actual pane) against the approved mockup before calling it done.
