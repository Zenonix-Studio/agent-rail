---
description: Show the last 50 finished agent-rail jobs, one of them in full, or the tokens spent since the weekly reset (stats)
argument-hint: "[number|stats]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/agent-rail-history.mjs" $ARGUMENTS`

Show the output above to the user exactly as it is, inside one plain code block, with nothing added or left out. Do not run any tool and do not comment on the jobs. When it is the numbered list, add one short line after the block, in the user's language, saying that `/agent-rail:history <number>` opens a job.
