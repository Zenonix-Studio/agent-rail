/**
 * ASCII rendering of one job for fixed-width terminals: title + %, block
 * progress bar, a vertical rail of milestones (one per line, full title) with
 * the flow of human-readable steps under the active one, and one row per
 * subagent of the job (the first running one expanded to its own steps). No
 * Node built-ins: the Claude Code mod imports this file.
 *
 * `renderJobSegments` returns each line as toned segments so a caller can
 * color them; `renderJob` returns the same lines as plain strings.
 */
import { progress } from './progress.mjs';

/**
 * @typedef {'plain'|'bold'|'dim'|'done'|'active'|'warn'|'error'} Tone
 * @typedef {{ text: string, tone: Tone }} Segment
 * @typedef {Segment[]} Line
 * @typedef {Pick<import('./state.mjs').Job, 'title'|'status'|'milestones'|'startedAt'|'endedAt'|'now'>} RenderableJob
 * @typedef {Pick<import('./state.mjs').Agent, 'name'|'status'|'activity'> & {
 *   id?: string, updatedAt?: string, milestones?: import('./state.mjs').Milestone[], steps?: import('./state.mjs').Pill[]
 * }} RenderableAgent `milestones` / `steps` are absent in files written before they existed.
 * @typedef {number|RenderableAgent[]} AgentsArg Running count only (title hint), or the job's
 *   subagents (`jobAgents` in core/progress.mjs): the hint plus an "Agents" block in the wide layout.
 * @typedef {{expandAll?: boolean}} RenderOptions `expandAll`: every agent row shows its steps,
 *   not only the first running one.
 */

/** Below this width the metro line is dropped for a one-line summary. */
export const COMPACT_WIDTH = 40;
const BAR_MAX = 30;
const BAR_MIN = 6;
const AGENTS_SHOWN = 4;
/** Above this many milestones the rail folds: done ones into one line, at most RAIL_AHEAD from the current one. */
const RAIL_MAX = 7;
const RAIL_AHEAD = 4;
/** Rows an expanded agent's story may wrap onto. */
const AGENT_ROWS = 3;
const GUTTER = '│   ';

/**
 * @param {RenderableJob} job
 * @param {number} width Columns available.
 * @param {number} [nowMs] Clock for the elapsed time of an unfinished job.
 * @param {AgentsArg} [agents]
 * @param {RenderOptions} [opts]
 * @returns {string[]} Plain lines, none longer than `width`.
 */
export function renderJob(job, width, nowMs = Date.now(), agents = 0, opts = {}) {
  return renderJobSegments(job, width, nowMs, agents, opts).map((line) => line.map((s) => s.text).join(''));
}

/**
 * @param {RenderableJob} job
 * @param {number} width
 * @param {number} [nowMs]
 * @param {AgentsArg} [agents]
 * @param {RenderOptions} [opts]
 * @returns {Line[]}
 */
export function renderJobSegments(job, width, nowMs = Date.now(), agents = 0, opts = {}) {
  const w = Math.max(10, Math.floor(width) || 0);
  const list = Array.isArray(agents) ? agents.filter((a) => a && typeof a === 'object') : [];
  const running = Array.isArray(agents) ? list.filter((a) => a.status === 'running').length : agents;
  const title = str(job?.title) || 'Untitled job';
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const status = job?.status;
  const isDone = status === 'done';
  const { done, total, pct } = progress(job);
  const tail = statusTail(status);
  const hint = agentsHint(running, w < COMPACT_WIDTH);
  const block = w < COMPACT_WIDTH ? [] : agentLines(list, w, opts?.expandAll === true);
  const hintLen = tailLen(hint);

  if (total === 0) {
    // "Planning · 0/?" comes from the missing plan, whatever the status says.
    const label = isDone ? `Done · ${elapsed(job, nowMs)}` : 'Planning · 0/?';
    const lead = `${clip(title, w - label.length - 2 - tailLen(tail) - hintLen)}  `;
    /** @type {Line[]} */
    const lines = [[seg(lead, 'bold'), seg(label, isDone ? 'done' : 'dim'), ...tail, ...hint]];
    // Spec §7 fallback: a planless job still shows what the agent is doing.
    const now = job?.now;
    if (!isDone && now && typeof now === 'object') {
      lines.push(...flowLines(now, w, '  '));
    } else if (isDone && now && typeof now === 'object') {
      const recent = recentLine(now, w);
      if (recent.length) lines.push(recent);
    }
    lines.push(...block);
    return lines.map((l) => fit(l.filter(nonEmpty), w));
  }

  const pctText = `${pct}%`;

  if (w < COMPACT_WIDTH) {
    const current = currentMilestone(milestones, isDone, job?.now?.milestone);
    const info = ` · ${done}/${total} · ${pctText}`;
    const name = clip(current, w - 2 - info.length - tailLen(tail));
    return [
      [seg(clip(title, w - hintLen), 'bold'), ...hint],
      [seg('▸ ', isDone ? 'done' : 'active'), seg(name, 'plain'), seg(info, 'dim'), ...tail],
    ].map((l) => fit(l, w));
  }

  /** @type {Line[]} */
  const lines = [];

  const titleRoom = w - pctText.length - 1 - hintLen;
  const shownTitle = clip(title, titleRoom);
  const gap = Math.max(1, w - shownTitle.length - hintLen - pctText.length);
  lines.push([seg(shownTitle, 'bold'), ...hint, seg(' '.repeat(gap), 'plain'), seg(pctText, 'bold')]);

  const counts = `  ${done}/${total} · ${elapsed(job, nowMs)}`;
  const barW = Math.max(BAR_MIN, Math.min(BAR_MAX, w - counts.length - tailLen(tail)));
  const filled = Math.round((barW * done) / total);
  lines.push([seg('█'.repeat(filled), 'done'), seg('░'.repeat(barW - filled), 'dim'), seg(counts, 'plain'), ...tail]);

  const now = !isDone && job?.now && typeof job.now === 'object' ? job.now : null;
  lines.push(...railLines(milestones, w, isDone, now));
  lines.push(...block);

  return lines.map((l) => fit(l.filter(nonEmpty), w));
}

/**
 * Vertical rail: one milestone per line with its full title (`✓` done, `◉`
 * active, `○` pending), the now-flow under the anchored one behind a `│`
 * gutter. Past RAIL_MAX milestones, the done ones before the current one fold
 * into `✓ N done` and at most RAIL_AHEAD milestones show from it, then `+N more`.
 * A done job's leftover 'active' milestone is drawn neutral: nothing runs now.
 * @param {import('./state.mjs').Milestone[]} milestones
 * @param {number} w
 * @param {boolean} isDone
 * @param {import('./state.mjs').Now|null} now the flow to show; null for none
 * @returns {Line[]}
 */
function railLines(milestones, w, isDone, now) {
  // Anchor the flow under now.milestone (a key); else the active-status node.
  const byKey = now ? milestones.findIndex((m) => str(m?.key) !== '' && m.key === now.milestone) : -1;
  const anchor = byKey >= 0 ? byKey : milestones.findIndex((m) => m?.status === 'active');
  let from = 0;
  let to = milestones.length;
  /** @type {Line[]} */
  const lines = [];
  if (milestones.length > RAIL_MAX) {
    const current = anchor >= 0 ? anchor : milestones.findIndex((m) => m?.status !== 'done');
    from = current >= 0 ? current : milestones.length;
    to = Math.min(milestones.length, from + RAIL_AHEAD);
    const folded = milestones.slice(0, from).filter((m) => m?.status === 'done').length;
    if (folded > 0) lines.push([seg('✓', 'done'), seg(` ${folded} done`, 'dim')]);
  }
  for (let i = from; i < to; i++) {
    const m = milestones[i];
    const status = m?.status;
    const active = status === 'active' && !isDone;
    const glyph = status === 'done' ? seg('✓', 'done') : status === 'active' ? seg('◉', active ? 'active' : 'plain') : seg('○', 'dim');
    const title = str(m?.title) || str(m?.key) || '?';
    lines.push([glyph, seg(' ', 'plain'), seg(clip(title, w - 2), active ? 'bold' : status === 'active' ? 'plain' : 'dim')]);
    if (now && i === anchor) lines.push(...nowLines(now, w, GUTTER));
  }
  if (to < milestones.length) lines.push([seg(`  +${milestones.length - to} more`, 'dim')]);
  // No milestone shown to hang the flow from: it goes under the rail.
  if (now && (anchor < from || anchor >= to)) lines.push(...nowLines(now, w, '  '));
  return lines;
}

/**
 * The now-flow plus the last touched file, each line behind `prefix`.
 * @param {import('./state.mjs').Now} now @param {number} w @param {string} prefix
 * @returns {Line[]}
 */
function nowLines(now, w, prefix) {
  const lines = flowLines(now, w, prefix);
  const file = str(now.file);
  // The path adds nothing when the latest step already names the file ("Editing app.js").
  const pills = Array.isArray(now.pills) ? now.pills : [];
  const base = file.split('/').pop() ?? '';
  const named = base !== '' && str(pills[pills.length - 1]?.label).includes(base);
  if (file && !named) lines.push([seg(prefix, 'dim'), seg(clip(file, w - prefix.length), 'dim')]);
  return lines;
}

/**
 * The story of the latest steps: `A ✓ → B → C ▶`, on up to FLOW_ROWS lines.
 * Most recent pills that fit are kept, oldest dropped first; an arrow travels
 * with the pill after it, so a line never ends on "→".
 * @param {import('./state.mjs').Now} now
 * @param {number} w
 * @param {string} prefix drawn before each line (`│   ` under a rail node)
 * @returns {Line[]}
 */
function flowLines(now, w, prefix) {
  const pills = Array.isArray(now.pills) ? now.pills : [];
  const attempt = Number.isFinite(now.attempt) && now.attempt >= 2 ? `  ↻ ${now.attempt}` : '';
  const room = w - prefix.length;
  /** @type {Segment[]} */
  const kept = [];
  // Newest first: each older pill is kept only if the whole set still lays out.
  for (let i = pills.length - 1; i >= 0; i--) {
    const text = pillText(pills[i], room - 2 - attempt.length);
    if (!text) continue;
    const next = [seg(text, pillTone(pills[i]?.kind)), ...kept];
    if (layout(next, room, attempt.length, FLOW_ROWS) === null) break;
    kept.unshift(next[0]);
  }
  const gutter = seg(prefix, 'dim');
  if (!kept.length) return attempt ? [[gutter, seg(attempt.trim(), 'warn')]] : [];
  const rows = /** @type {Segment[][]} */ (layout(kept, room, attempt.length, FLOW_ROWS));
  const lines = rows.map((row, r) => [gutter, ...(r === 0 ? [] : [seg('  ', 'plain')]), ...row]);
  if (attempt) lines[lines.length - 1].push(seg(attempt, 'warn'));
  return lines;
}

const FLOW_ROWS = 2;

/**
 * Wraps pills into rows; continuation rows are indented 2 more columns.
 * @param {Segment[]} pills @param {number} room @param {number} tail columns kept free on the last row
 * @param {number} maxRows
 * @returns {Segment[][]|null} null when they need more than `maxRows` rows.
 */
function layout(pills, room, tail, maxRows) {
  /** @type {Segment[][]} */
  const rows = [[]];
  let used = 0;
  for (const p of pills) {
    const row = rows[rows.length - 1];
    const width = room - (rows.length > 1 ? 2 : 0);
    const cost = p.text.length + (row.length ? 3 : 0);
    if (row.length && used + cost > width) {
      if (rows.length === maxRows) return null;
      rows.push([seg('→ ', 'dim'), p]);
      used = p.text.length + 2;
      continue;
    }
    if (!row.length && cost > width) return null;
    if (row.length) row.push(seg(' → ', 'dim'));
    row.push(p);
    used += cost;
  }
  const lastWidth = room - (rows.length > 1 ? 2 : 0);
  return used + tail <= lastWidth ? rows : null;
}

const AGENT_GLYPH = { running: ['●', 'active'], done: ['✓', 'done'], stale: ['○', 'dim'], error: ['✗', 'error'] };

/**
 * "Agents" block: one row per subagent, running ones first. A row is
 * `▸ ● <name>  d/t · <latest step>`; an expanded row (`▾`, the first running
 * agent, or every agent with `expandAll`) shows the agent's own steps under it
 * as an arrow story: its milestones when it made a plan, else its story steps.
 * @param {RenderableAgent[]} agents
 * @param {number} w
 * @param {boolean} expandAll
 * @returns {Line[]} none when there are no agents.
 */
function agentLines(agents, w, expandAll) {
  if (!agents.length) return [];
  const rank = (a) => (a.status === 'running' ? 0 : 1);
  const recent = (a) => Date.parse(a.updatedAt ?? '') || 0;
  // Running first (in start order); finished ones most recent first.
  const sorted = agents
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || (rank(x.a) === 0 ? x.i - y.i : recent(y.a) - recent(x.a)))
    .map((x) => x.a);
  const shown = sorted.slice(0, AGENTS_SHOWN);
  /** @type {Line[]} */
  const lines = [[], [seg('Agents', 'dim')]];
  shown.forEach((a, i) => {
    const open = expandAll || (i === 0 && a.status === 'running');
    const [glyph, tone] = AGENT_GLYPH[/** @type {keyof typeof AGENT_GLYPH} */ (a.status)] ?? ['·', 'dim'];
    const running = a.status === 'running';
    const ms = Array.isArray(a.milestones) ? a.milestones.filter((m) => m && typeof m === 'object') : [];
    const count = ms.length ? `  ${ms.filter((m) => m.status === 'done').length}/${ms.length}` : '';
    const story = open ? agentStory(a, ms, running, w - 4) : [];
    const activity = str(a.activity) || (running ? 'starting…' : '');
    // Collapsed, or open with nothing to show under it: the latest step stays on the row.
    const tail = !story.length && activity ? activity : '';
    const name = clip(str(a.name) || 'agent', tail ? Math.max(8, Math.floor((w - 4 - count.length) * 0.5)) : w - 4 - count.length);
    /** @type {Line} */
    const row = [seg(open ? '▾ ' : '▸ ', running ? 'active' : 'dim'), seg(glyph, /** @type {Tone} */ (tone)), seg(' ', 'plain'),
      seg(name, running ? 'bold' : 'dim'), seg(count, 'plain')];
    if (tail) row.push(seg(count ? ' · ' : ' — ', 'dim'), seg(clip(tail, w - 4 - name.length - count.length - 3), 'dim'));
    lines.push(row);
    for (const r of story) lines.push([seg('    ', 'plain'), ...r]);
  });
  if (shown.length < sorted.length) lines.push([seg(`  +${sorted.length - shown.length} more`, 'dim')]);
  return lines;
}

/**
 * An expanded agent's own steps as an arrow story, oldest first, wrapped onto
 * up to AGENT_ROWS rows (oldest dropped first). With a plan: its done
 * milestones and the active one; else its story steps.
 * @param {RenderableAgent} a
 * @param {import('./state.mjs').Milestone[]} ms
 * @param {boolean} running
 * @param {number} room
 * @returns {Segment[][]}
 */
function agentStory(a, ms, running, room) {
  /** @type {Segment[]} */
  let items;
  if (ms.length) {
    items = ms
      .filter((m) => m.status === 'done' || m.status === 'active')
      .map((m) => {
        const t = str(m.title) || str(m.key) || '?';
        if (m.status === 'done') return seg(clip(`✓ ${t}`, room), 'done');
        return running ? seg(clip(`${t} ▶`, room), 'active') : seg(clip(t, room), 'plain');
      });
  } else {
    const steps = Array.isArray(a.steps) ? a.steps : [];
    items = steps
      .filter((p) => p && str(p.label))
      .map((p) => {
        const t = str(p.label);
        if (p.kind === 'ok') return seg(clip(`✓ ${t}`, room), 'done');
        if (p.kind === 'warn') return seg(clip(`✗ ${t}`, room), 'warn');
        if (p.kind === 'active' && running) return seg(clip(`${t} ▶`, room), 'active');
        return seg(clip(t, room), 'dim');
      });
  }
  /** @type {Segment[]} */
  const kept = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const next = [items[i], ...kept];
    if (layout(next, room, 0, AGENT_ROWS) === null) break;
    kept.unshift(items[i]);
  }
  return kept.length ? /** @type {Segment[][]} */ (layout(kept, room, 0, AGENT_ROWS)) : [];
}

/**
 * Neutral recap of a done, planless job: last 3 pill labels, all dim.
 * @param {import('./state.mjs').Now} now
 * @param {number} w
 * @returns {Line}
 */
function recentLine(now, w) {
  const pills = Array.isArray(now.pills) ? now.pills : [];
  const labels = pills.map((p) => str(p?.label)).filter(Boolean).slice(-3);
  if (!labels.length) return [];
  return [seg('  ', 'plain'), seg(clip(labels.join(' → '), w - 2), 'dim')];
}

/** @param {{label?: string, kind?: string}} p @param {number} room @returns {string} label plus its status mark, clipped to `room` */
function pillText(p, room) {
  const label = str(p?.label);
  if (!label) return '';
  const mark = p.kind === 'ok' ? ' ✓' : p.kind === 'active' ? ' ▶' : '';
  return clip(label, room - mark.length) + mark;
}

/** @param {string|undefined} kind @returns {Tone} */
function pillTone(kind) {
  if (kind === 'ok') return 'done';
  if (kind === 'warn') return 'warn';
  if (kind === 'active') return 'active';
  return 'dim';
}

/**
 * @param {import('./state.mjs').Milestone[]} milestones
 * @param {boolean} isDone
 * @param {unknown} nowKey `job.now.milestone`, a milestone key.
 * @returns {string} now.milestone's title, else the active one, else the next pending one, else "Done".
 */
function currentMilestone(milestones, isDone, nowKey) {
  const byKey = typeof nowKey === 'string' && nowKey !== '' ? milestones.find((m) => m?.key === nowKey) : undefined;
  const active = isDone ? undefined : byKey ?? milestones.find((m) => m?.status === 'active');
  const next = active ?? milestones.find((m) => m?.status !== 'done');
  if (!next || isDone) return 'Done';
  return str(next.title) || str(next.key) || '?';
}

/** @param {string|undefined} status @returns {Segment[]} */
function statusTail(status) {
  if (status === 'waiting') return [seg(' · waiting for you', 'warn')];
  if (status === 'error') return [seg(' · error', 'error')];
  return [];
}

/**
 * Title-line hint while subagents of the job still run, e.g. ` · 2 agents running`.
 * @param {unknown} n @param {boolean} compact @returns {Segment[]}
 */
function agentsHint(n, compact) {
  if (!Number.isInteger(n) || n <= 0) return [];
  const noun = n === 1 ? 'agent' : 'agents';
  return [seg(compact ? ` · ${n} ${noun}` : ` · ${n} ${noun} running`, 'dim')];
}

/** @param {Segment[]} tail */
function tailLen(tail) {
  return tail.reduce((n, s) => n + s.text.length, 0);
}

/**
 * @param {RenderableJob} job
 * @param {number} nowMs
 * @returns {string} e.g. `42s`, `4m12s`, `1h05m`.
 */
export function elapsed(job, nowMs) {
  const start = Date.parse(job?.startedAt ?? '');
  const end = job?.endedAt ? Date.parse(job.endedAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '–';
  const s = Math.max(0, Math.floor((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Cuts a line's segments so its total length is at most `w`. @param {Line} line @param {number} w */
function fit(line, w) {
  /** @type {Line} */
  const out = [];
  let left = w;
  for (const s of line) {
    if (left <= 0) break;
    const text = s.text.length > left ? s.text.slice(0, left) : s.text;
    out.push(seg(text, s.tone));
    left -= text.length;
  }
  return out;
}

/** @param {string} text @param {number} room */
function clip(text, room) {
  if (room <= 0) return '';
  if (text.length <= room) return text;
  return room === 1 ? '…' : `${text.slice(0, room - 1)}…`;
}

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** @param {string} text @param {Tone} tone @returns {Segment} */
function seg(text, tone) {
  return { text, tone };
}

/** @param {Segment} s */
function nonEmpty(s) {
  return s.text !== '';
}
