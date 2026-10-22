#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { LINKS, PROMPT_MARKER, hooksPath, linkDir, isOurs, loadHooks, oldPromptPath, saveHooks, skillPath } from './codex-hooks-lib.mjs';

for (const [name, target] of Object.entries(LINKS)) {
  const link = join(linkDir().dir, name);
  try { if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === target) { unlinkSync(link); console.log(`removed ${link}`); } } catch { /* absent */ }
}
for (const p of [skillPath(), oldPromptPath()]) {
  if (!existsSync(p) || !readFileSync(p, 'utf8').includes(PROMPT_MARKER)) continue;
  rmSync(p === skillPath() ? dirname(p) : p, { recursive: true });
  console.log(`removed ${p === skillPath() ? '$rail skill' : 'old /prompts:rail'}`);
}

if (!existsSync(hooksPath())) { console.log('no hooks.json, nothing to do'); process.exit(0); }
const j = loadHooks();
// Event keys that existed in the pre-install backup (even as empty arrays) are kept as the user had them.
let original = {};
try { original = JSON.parse(readFileSync(`${hooksPath()}.agent-rail.bak`, 'utf8')).hooks ?? {}; } catch { /* no backup */ }
let removed = 0;
for (const ev of Object.keys(j.hooks)) {
  if (!Array.isArray(j.hooks[ev])) continue;
  const kept = j.hooks[ev].filter((g) => !isOurs(g));
  const n = j.hooks[ev].length - kept.length;
  if (!n) continue;
  removed += n;
  if (kept.length || ev in original) j.hooks[ev] = kept; else delete j.hooks[ev];
}
saveHooks(j);
console.log(`removed ${removed} agent-rail entries (config.toml untouched; remove [tools.update_plan] manually if wanted)`);
