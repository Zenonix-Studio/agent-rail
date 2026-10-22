#!/usr/bin/env node
// Opens agent-rail-watch beside the terminal it runs in, then exits: Codex's $rail runs it.
// tmux: a split to the right. iTerm2: a vertical split of the current session, the focus kept
// where it was. Anything else: a new Terminal.app window. Arguments go to the watcher.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const watch = join(dirname(fileURLToPath(import.meta.url)), 'agent-rail-watch.mjs');
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const command = [process.execPath, watch, ...process.argv.slice(2)].map(q).join(' ');
const osa = (script) => execFileSync('osascript', ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
const asString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

try {
  if (process.env.TMUX) {
    execFileSync('tmux', ['split-window', '-h', '-d', '-l', '45%', command], { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log('agent-rail: opened in a tmux split on the right.');
  } else if (process.env.TERM_PROGRAM === 'iTerm.app' || process.env.ITERM_SESSION_ID) {
    osa(`tell application "iTerm2"
  tell current session of current window
    set railSession to (split vertically with default profile command ${asString(command)})
    select
  end tell
end tell`);
    console.log('agent-rail: opened in an iTerm2 split on the right.');
  } else {
    osa(`tell application "Terminal" to do script ${asString(command)}`);
    console.log('agent-rail: opened in a new Terminal window.');
  }
} catch (err) {
  // A sandbox without Apple Events, or no tmux server: the command itself still works by hand.
  console.log(`agent-rail: could not open a split (${String(err.stderr ?? err.message).trim().split('\n')[0]}).`);
  console.log(`Run it in a split yourself: ${command}`);
  process.exitCode = 1;
}
