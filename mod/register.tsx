// Claude Code mod: draws the current session's agent-rail job (written by the
// collector hooks to ~/.agent-rail/sessions/claude-<sessionId>.json) in a Pane,
// or in the band above the prompt while that pane is not shown.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { jobAgents } from '../core/progress.mjs'
import { duration, formatTokens, jobTokens, renderJobSegments } from '../core/render-ascii.mjs'
import type { RailAgent, RailHistoryItem, RailJob, RailPage, RailView } from './types'

const PANE = 'agent-rail'
const TITLE = 'Agent rail'
const POLL_MS = 1000
/** The menubar's history holds as many. */
const HISTORY_LIMIT = 50

const view = atom({ plugin: 'agent-rail', key: 'view' } as const, { job: null, at: 0, agents: [] } as RailView)
const isPaneShown = atom({ plugin: 'agent-rail', key: 'isPaneShown' } as const, false)
/** `/rail agents` toggles it: every agent row shows its own steps, not only the first running one. */
const expandAll = atom({ plugin: 'agent-rail', key: 'expandAll' } as const, false)
const page = atom({ plugin: 'agent-rail', key: 'page' } as const, { name: 'now' } as RailPage)
const history = atom({ plugin: 'agent-rail', key: 'history' } as const, [] as RailHistoryItem[])

const TONE: Record<string, { color?: string; dimColor?: boolean; weight?: 'bold' }> = {
  plain: {},
  bold: { weight: 'bold' },
  dim: { dimColor: true },
  done: { color: 'success' },
  active: { color: 'claude' },
  warn: { color: 'warning' },
  error: { color: 'error' },
  // Stage palette, the menubar's dark-mode hues: dev is the existing accent, fix the theme's red.
  plan: { color: '#b49af2' },
  analyse: { color: '#7fa8f0' },
  dev: { color: 'claude' },
  fix: { color: 'error' },
  review: { color: '#4cc2b6' },
}

let lastSignature = ''

/** The state root, or null with HOME unset. */
async function stateDir($: EngineInterface): Promise<string | null> {
  const [root, home] = await Promise.all([$.env.get('AGENT_RAIL_HOME'), $.env.get('HOME')])
  return typeof root === 'string' && root !== '' ? root
    : typeof home === 'string' && home !== '' ? `${home}/.agent-rail`
    : null
}

/** Every session's finished jobs, newest first, the last HISTORY_LIMIT of them. */
async function loadHistory($: EngineInterface): Promise<RailHistoryItem[]> {
  const dir = await stateDir($)
  if (dir === null) return []
  const entries = await $.fs.list(`${dir}/sessions`).catch(() => [])
  const items: RailHistoryItem[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    try {
      const session = JSON.parse(await $.fs.read(`${dir}/sessions/${f.name}`))
      for (const job of Array.isArray(session?.jobs) ? session.jobs : []) {
        if (job?.status !== 'done') continue
        const ended = Date.parse(job.endedAt ?? job.updatedAt) || 0
        items.push({ id: `${f.name}:${job.seq}`, project: session.project || session.source || '', ended, job, agents: jobAgents(session, job.seq) })
      }
    } catch { /* a half-written or corrupt file: left out */ }
  }
  return items.sort((a, b) => b.ended - a.ended).slice(0, HISTORY_LIMIT)
}

async function showHistory($: EngineInterface): Promise<void> {
  const items = await loadHistory($)
  await update($, history, () => items)
  await update($, page, () => ({ name: 'history' }) as RailPage)
}

/** Reads this session's file; writes the view only when what it draws changed. */
async function tick($: EngineInterface): Promise<void> {
  const [sessionId, dir] = await Promise.all([$.session.id(), stateDir($)])
  // No state root to read (HOME unset): draw "No job yet" rather than read `undefined/...`.
  const text = dir === null
    ? ''
    : await $.fs.read(`${dir}/sessions/claude-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`).catch(() => '')
  let job: RailJob | null = null
  let agents: RailAgent[] = []
  try {
    const session = text ? JSON.parse(text) : undefined
    const jobs = session?.jobs
    job = Array.isArray(jobs) && jobs.length ? jobs[jobs.length - 1] : null
    agents = job === null ? [] : jobAgents(session, job.seq)
  } catch {
    return // a half-written or corrupt file: keep drawing the last good view
  }
  const now = await $.clock.now()
  const isLive = job !== null && job.status !== 'done' && !job.endedAt
  // A live job's elapsed time moves each second; a finished one never does.
  const signature = `${text}|${isLive ? Math.floor(now / 1000) : ''}`
  if (signature !== lastSignature) {
    lastSignature = signature
    await update($, view, () => ({ job, at: now, agents }))
  }
  const panes = await $.ui.panes()
  const shown = panes.some(p => p.id === PANE && p.isPlaced && p.isShown)
  if (shown !== (await read($, isPaneShown))) await update($, isPaneShown, () => shown)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rail',
      description: 'Show the agent-rail progress pane; `/rail history` lists finished jobs, `/rail agents` expands every agent row',
      argumentHint: '[history|agents]',
    })
    // Unasked, the pane is placed only on a wide terminal; the band covers the rest.
    void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(POLL_MS, () => void tick($).catch(() => undefined))
    void tick($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'rail' }, async ($, e) => {
    if (e.args.trim() === 'agents') {
      const all = await update($, expandAll, v => !v)
      return { text: all ? 'Agent rail: every agent row expanded.' : 'Agent rail: only the first running agent expanded.' }
    }
    if (e.args.trim() === 'history') await showHistory($)
    else await update($, page, () => ({ name: 'now' }) as RailPage)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Agent rail pane opened.' : `Agent rail pane waits: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, page)
    const cols = e.props.bodyColumns
    const goNow = () => void update($, page, () => ({ name: 'now' }) as RailPage)
    const tabs = (
      <Box flexDirection="row" gap={1}>
        <Button key="tab-now" hotkey="n" variant={current.name === 'now' ? 'primary' : undefined} onPress={goNow}>Now</Button>
        <Button key="tab-history" hotkey="h" variant={current.name === 'now' ? undefined : 'primary'} onPress={() => void showHistory($)}>History</Button>
      </Box>
    )
    const draw = (job: RailJob, at: number, agents: RailAgent[], all: boolean) =>
      renderJobSegments(job, cols, at, agents, { expandAll: all }).map(line => (
        <Text wrap="truncate">
          {line.length === 0 ? ' ' : line.map(s => <Text {...TONE[s.tone]}>{s.text}</Text>)}
        </Text>
      ))

    if (current.name === 'now') {
      const { job, at, agents } = await read($, view)
      return (
        <Box flexDirection="column">
          {tabs}
          {job === null ? <Text dimColor>No job yet in this session.</Text> : draw(job, at, agents, await read($, expandAll))}
        </Box>
      )
    }
    const items = await read($, history)
    const now = await $.clock.now()
    if (current.name === 'job') {
      const it = items.find(i => i.id === current.picked)
      if (it) {
        return (
          <Box flexDirection="column">
            {tabs}
            <Button key="back" hotkey="b" plain dimColor onPress={() => void update($, page, () => ({ name: 'history' }) as RailPage)}>‹ Back to history</Button>
            <Text dimColor wrap="truncate">{`${it.project} · ended ${duration(now - it.ended)} ago`}</Text>
            {draw(it.job, it.ended, it.agents, true)}
          </Box>
        )
      }
    }
    return (
      <Box flexDirection="column">
        {tabs}
        {items.length === 0 ? <Text dimColor>No finished jobs yet.</Text> : null}
        {items.map((it, i) => {
          const tok = jobTokens(it.job, it.agents)
          const meta = [`${duration(now - it.ended)} ago`, it.project, tok > 0 ? formatTokens(tok) : null].filter(Boolean).join(' · ')
          return (
            <Button key={it.id} plain onPress={() => void update($, page, () => ({ name: 'job', picked: it.id }) as RailPage)}>
              {`${i + 1}. ${it.job.title || it.job.prompt || 'Untitled job'}  `}<Text dimColor>{meta}</Text>
            </Button>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { job, at, agents } = await read($, view)
    if (e.props.hasSurvey || job === null || (await read($, isPaneShown))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const opts = { expandAll: await read($, expandAll) }
    const lines = renderJobSegments(job, e.props.bodyColumns, at, agents, opts).slice(0, Math.max(1, e.props.maxRows))
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
