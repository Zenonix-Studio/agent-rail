import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'agent-rail-collect';
export const EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest',
  'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd',
];
export const codexDir = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const hooksPath = () => join(codexDir(), 'hooks.json');
export const configPath = () => join(codexDir(), 'config.toml');
export const collectorPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-rail-collect.mjs');
export const openerPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-rail-open.mjs');
/** Codex's skill behind `$rail` (also listed under /skills); ours when it names the opener. */
export const skillPath = () => join(codexDir(), 'skills', 'rail', 'SKILL.md');
/** Where 0.2.24's installer wrote it; Codex 0.162 reads no custom prompts, so it is removed. */
export const oldPromptPath = () => join(codexDir(), 'prompts', 'rail.md');
export const PROMPT_MARKER = 'agent-rail-open';
export const railSkill = () => `---
name: rail
description: Open the agent-rail live view (this session's job, steps and agents) in a terminal split beside Codex. Use when the user types $rail or asks to show the rail.
---

Run this one shell command now, outside the sandbox (it opens a terminal split through tmux or AppleScript), then reply with its output only, nothing else:

\`\`\`
node "${openerPath}" codex
\`\`\`
`;

export function backup(path) {
  if (existsSync(path) && !existsSync(`${path}.agent-rail.bak`)) copyFileSync(path, `${path}.agent-rail.bak`);
}

export function loadHooks() {
  if (!existsSync(hooksPath())) return { hooks: {} };
  const j = JSON.parse(readFileSync(hooksPath(), 'utf8'));
  if (!j.hooks || typeof j.hooks !== 'object') j.hooks = {};
  return j;
}

export function saveHooks(j) {
  mkdirSync(codexDir(), { recursive: true });
  writeFileSync(hooksPath(), JSON.stringify(j, null, 2) + '\n');
}

export const isOurs = (group) => (group?.hooks ?? []).some((h) => String(h?.command ?? '').includes(MARKER));
