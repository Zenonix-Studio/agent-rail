// Claude Code mod: draws the current session's agent-rail job (written by the
// collector hooks to ~/.agent-rail/sessions/claude-<sessionId>.json) in a Pane,
// or in the band above the prompt while that pane is not shown.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { renderJobSegments } from '../core/render-ascii.mjs'
import type { RailJob, RailView } from './types'

const PANE = 'agent-rail'
const TITLE = 'Agent rail'
const POLL_MS = 1000

const view = atom({ plugin: 'agent-rail', key: 'view' } as const, { job: null, at: 0 } as RailView)
const isPaneShown = atom({ plugin: 'agent-rail', key: 'isPaneShown' } as const, false)

const TONE: Record<string, { color?: string; dimColor?: boolean; weight?: 'bold' }> = {
  plain: {},
  bold: { weight: 'bold' },
  dim: { dimColor: true },
  done: { color: 'success' },
  active: { color: 'claude' },
  warn: { color: 'warning' },
  error: { color: 'error' },
}

let lastSignature = ''

/** Reads this session's file; writes the view only when what it draws changed. */
async function tick($: EngineInterface): Promise<void> {
  const [sessionId, root, home] = await Promise.all([
    $.session.id(),
    $.env.get('AGENT_RAIL_HOME'),
    $.env.get('HOME'),
  ])
  const dir = typeof root === 'string' && root !== '' ? root : `${home}/.agent-rail`
  const path = `${dir}/sessions/claude-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`
  const text = await $.fs.read(path).catch(() => '')
  let job: RailJob | null = null
  try {
    const jobs = text ? JSON.parse(text)?.jobs : undefined
    job = Array.isArray(jobs) && jobs.length ? jobs[jobs.length - 1] : null
  } catch {
    return // a half-written or corrupt file: keep drawing the last good view
  }
  const now = await $.clock.now()
  const isLive = job !== null && job.status !== 'done' && !job.endedAt
  // A live job's elapsed time moves each second; a finished one never does.
  const signature = `${text}|${isLive ? Math.floor(now / 1000) : ''}`
  if (signature !== lastSignature) {
    lastSignature = signature
    await update($, view, () => ({ job, at: now }))
  }
  const panes = await $.ui.panes()
  const shown = panes.some(p => p.id === PANE && p.isPlaced && p.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rail',
      description: 'Show the agent-rail progress pane for this session',
    })
    // Unasked, the pane is placed only on a wide terminal; the band covers the rest.
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(POLL_MS, () => void tick($).catch(() => undefined))
    void tick($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'rail' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Agent rail pane opened.' : `Agent rail pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { job, at } = await read($, view)
    if (job === null) return <Text dimColor>No job yet in this session.</Text>
    return (
      <Box flexDirection="column">
        {renderJobSegments(job, e.props.bodyColumns, at).map(line => (
          <Text wrap="truncate">
            {line.length === 0 ? ' ' : line.map(s => <Text {...TONE[s.tone]}>{s.text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { job, at } = await read($, view)
    if (e.props.hasSurvey || job === null || (await read($, isPaneShown))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const lines = renderJobSegments(job, e.props.bodyColumns, at).slice(0, Math.max(1, e.props.maxRows))
    return (
      <Box flexDirection="column">
        {lines.map(line => (
          <Text wrap="truncate">
            {line.length === 0 ? ' ' : line.map(s => <Text {...TONE[s.tone]}>{s.text}</Text>)}
          </Text>
        ))}
      </Box>
    )
  })
}
