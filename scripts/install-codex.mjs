#!/usr/bin/env node
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { EVENTS, MARKER, PROMPT_MARKER, backup, collectorPath, configPath, hooksPath, isOurs, loadHooks, promptPath, railPrompt, saveHooks } from './codex-hooks-lib.mjs';

const args = process.argv.slice(2);

async function askPlan() {
  if (args.includes('--no-plan')) return false;
  if (args.includes('--yes')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('Enable the update_plan tool in ~/.codex/config.toml (needed for milestones)? [y/N] ');
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

backup(hooksPath());
backup(configPath());

const j = loadHooks();
const command = `node "${collectorPath}" --source codex`;
let added = 0;
for (const ev of EVENTS) {
  const groups = Array.isArray(j.hooks[ev]) ? j.hooks[ev] : (j.hooks[ev] = []);
  if (groups.some(isOurs)) continue;
  groups.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  added++;
}
saveHooks(j);
console.log(`hooks.json: ${added} agent-rail entries added (${EVENTS.length - added} already present)`);

/**
 * How config.toml already defines the `tools` table, if it does. Appending a
 * `[tools.update_plan]` header next to any of these can make the file invalid
 * (e.g. after an inline `tools = {...}`), so the installer then only advises.
 * @param {string} toml
 * @returns {'inline'|'dotted'|'table'|'subtable'|null}
 */
function toolsForm(toml) {
  const lines = toml.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const key = String.raw`(?:tools|"tools"|'tools')`;
  if (lines.some((l) => new RegExp(`^${key}\\s*=`).test(l))) return 'inline';
  if (lines.some((l) => new RegExp(`^${key}\\s*\\.`).test(l))) return 'dotted';
  if (lines.some((l) => new RegExp(`^\\[\\[?\\s*${key}\\s*\\]`).test(l))) return 'table';
  if (lines.some((l) => new RegExp(`^\\[\\[?\\s*${key}\\s*\\.`).test(l))) return 'subtable';
  return null;
}

const MANUAL = {
  inline: 'add `update_plan = { enabled = true }` inside your existing `tools = { ... }` inline table',
  dotted: 'add the line `tools.update_plan.enabled = true` next to your other top-level `tools.*` keys',
  table: 'add the line `update_plan = { enabled = true }` under your existing `[tools]` table',
  subtable: 'add a `[tools.update_plan]` table with the line `enabled = true` next to your other `[tools.*]` tables',
};

const toml = existsSync(configPath()) ? readFileSync(configPath(), 'utf8') : '';
const form = toolsForm(toml);
if (/^\s*\[tools\.update_plan\]/m.test(toml) || /update_plan/.test(toml)) {
  console.log('config.toml: update_plan already configured, left untouched');
} else if (form) {
  console.log(`config.toml: already defines \`tools\`, left untouched. To enable milestones, edit ${configPath()} by hand: ${MANUAL[form]}.`);
} else if (await askPlan()) {
  appendFileSync(configPath(), `${toml && !toml.endsWith('\n') ? '\n' : ''}\n[tools.update_plan]\nenabled = true\n`);
  console.log('config.toml: enabled [tools.update_plan]');
} else {
  console.log('config.toml: update_plan not enabled (jobs will show status "planning" without milestones)');
}
// `/prompts:rail` opens the live view in a split; a prompt of the same name the user wrote is kept.
if (existsSync(promptPath()) && !readFileSync(promptPath(), 'utf8').includes(PROMPT_MARKER)) {
  console.log(`prompts/rail.md: a prompt of that name exists, left untouched (no /prompts:rail from agent-rail)`);
} else {
  mkdirSync(dirname(promptPath()), { recursive: true });
  writeFileSync(promptPath(), railPrompt());
  console.log('prompts/rail.md: added /prompts:rail (opens the live rail in a split)');
}
console.log(`Note: Codex may ask you to review/trust the new hooks (marker: ${MARKER}).`);
