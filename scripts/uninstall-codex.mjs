#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { hooksPath, isOurs, loadHooks, saveHooks } from './codex-hooks-lib.mjs';

if (!existsSync(hooksPath())) { console.log('no hooks.json, nothing to do'); process.exit(0); }
const j = loadHooks();
let removed = 0;
for (const ev of Object.keys(j.hooks)) {
  if (!Array.isArray(j.hooks[ev])) continue;
  const kept = j.hooks[ev].filter((g) => !isOurs(g));
  const n = j.hooks[ev].length - kept.length;
  if (!n) continue;
  removed += n;
  if (kept.length) j.hooks[ev] = kept; else delete j.hooks[ev];
}
saveHooks(j);
console.log(`removed ${removed} agent-rail entries (config.toml untouched; remove [tools.update_plan] manually if wanted)`);
