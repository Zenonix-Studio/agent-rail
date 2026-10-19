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
 * @typedef {Pick<import('./state.mjs').Job, 'title'|'status'|'milestones'|'startedAt'|'endedAt'|'now'> & {summary?: string}} RenderableJob
 * @typedef {Pick<import('./state.mjs').Agent, 'name'|'status'|'activity'> & {
 *   id?: string, startedAt?: string, updatedAt?: string, milestones?: import('./state.mjs').Milestone[], steps?: import('./state.mjs').Pill[]
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
/** Cells of an agent row's mini progress bar. */
const MINI_BAR = 6;
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
    if (w >= COMPACT_WIDTH) lines.push(...summaryLines(job, w));
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
  lines.push(...summaryLines(job, w));

  const now = !isDone && job?.now && typeof job.now === 'object' ? job.now : null;
  lines.push(...railLines(milestones, w, isDone, now));
  lines.push(...block);

  return lines.map((l) => fit(l.filter(nonEmpty), w));
}

/**
 * Vertical rail: one milestone per line with its full title (`✓` done, `◉`
 * active, `○` pending), the now-flow under the anchored one behind a `│`
 * gutter. Past RAIL_MAX milestones, the done ones before the first unfinished
 * one fold into `✓ N done`; from there RAIL_AHEAD milestones show (always
 * through the anchored one), then `+N more`. Every milestone is either shown
 * or counted.
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
    // Only done milestones fold: the window starts at the first unfinished one.
    const open = milestones.findIndex((m) => m?.status !== 'done');
    from = open >= 0 ? open : milestones.length;
    to = Math.min(milestones.length, Math.max(from + RAIL_AHEAD, anchor + 1));
    if (from > 0) lines.push([seg('✓', 'done'), seg(` ${from} done`, 'dim')]);
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
 * "Agents · N running" block, laid out like the menubar's agent rows. One row
 * per subagent: `▸ ● <name>  <current step>` with, when it keeps its own plan,
 * a right-aligned mini bar and `done/total`. An open row (`▾`: the first
 * running agent, or every agent with `expandAll`) lists under it what the
 * agent was asked to do and its own steps, one per line with a status node.
 * @param {RenderableAgent[]} agents
 * @param {number} w
 * @param {boolean} expandAll
 * @returns {Line[]} none when there are no agents.
 */
function agentLines(agents, w, expandAll) {
  if (!agents.length) return [];
  const sorted = sortAgents(agents);
  const shown = sorted.slice(0, AGENTS_SHOWN);
  const running = agents.filter((a) => a.status === 'running').length;
  /** @type {Line[]} */
  const lines = [[], [seg(running > 0 ? `Agents · ${running} running` : 'Agents', 'dim')]];
  shown.forEach((a, i) => {
    const open = expandAll || (i === 0 && a.status === 'running');
    lines.push(agentRow(a, w, open));
    if (open) lines.push(...agentBody(a, w));
  });
  if (shown.length < sorted.length) lines.push([seg(`+${sorted.length - shown.length} more`, 'dim')]);
  return lines;
}

/**
 * @param {RenderableAgent} a @param {number} w @param {boolean} open
 * @returns {Line} `▾ ● name  current step ……… ███░░░ 3/6`
 */
function agentRow(a, w, open) {
  const [glyph, tone] = AGENT_GLYPH[/** @type {keyof typeof AGENT_GLYPH} */ (a.status)] ?? ['·', 'dim'];
  const running = a.status === 'running';
  const ms = agentMilestones(a);
  const done = ms.filter((m) => m.status === 'done').length;
  const count = ms.length ? `${done}/${ms.length}` : '';
  const filled = ms.length ? Math.round((MINI_BAR * done) / ms.length) : 0;
  const right = ms.length ? MINI_BAR + 1 + count.length : 0;
  const room = w - 4 - (right ? right + 2 : 0);
  const name = clip(str(a.name) || 'agent', Math.max(8, Math.min(room, Math.ceil(room * 0.55))));
  const step = currentStep(a, ms) || (running ? 'starting…' : '');
  const stepText = step ? clip(step, room - name.length - 2) : '';
  /** @type {Line} */
  const row = [seg(open ? '▾ ' : '▸ ', running ? 'active' : 'dim'), seg(glyph, /** @type {Tone} */ (tone)), seg(' ', 'plain'),
    seg(name, running ? 'bold' : 'plain')];
  if (stepText) row.push(seg('  ', 'plain'), seg(stepText, 'dim'));
  if (right) {
    const used = 4 + name.length + (stepText ? 2 + stepText.length : 0);
    row.push(seg(' '.repeat(Math.max(2, w - used - right)), 'plain'),
      seg('█'.repeat(filled), 'done'), seg('░'.repeat(MINI_BAR - filled), 'dim'), seg(` ${count}`, 'dim'));
  }
  return row;
}

/**
 * An open agent row's body: its summary (when it says more than the name) and
 * its own steps, `✓` done, `◉` current, `✗` failed, `○` not started or unknown.
 * @param {RenderableAgent} a @param {number} w @returns {Line[]}
 */
function agentBody(a, w) {
  const pad = '    ';
  /** @type {Line[]} */
  const lines = [];
  const summary = str(a.summary);
  if (summary && summary !== str(a.name)) {
    for (const t of wrapText(summary, w - pad.length, 2)) lines.push([seg(pad, 'plain'), seg(t, 'dim')]);
  }
  for (const s of agentSteps(a)) {
    const [g, gt, tt] = STEP_STYLE[s.state];
    lines.push([seg(pad, 'plain'), seg(g, gt), seg(' ', 'plain'), seg(clip(s.label, w - pad.length - 2), tt)]);
  }
  return lines;
}

/** Node glyph, its tone and the label's tone per step state (the menubar's step list). */
const STEP_STYLE = /** @type {const} */ ({
  done: ['✓', 'done', 'dim'],
  current: ['◉', 'active', 'bold'],
  failed: ['✗', 'warn', 'warn'],
  neutral: ['○', 'dim', 'dim'],
});

/** @param {RenderableAgent} a @returns {import('./state.mjs').Milestone[]} */
function agentMilestones(a) {
  return Array.isArray(a.milestones) ? a.milestones.filter((m) => m && typeof m === 'object') : [];
}

/**
 * The steps an open agent row lists, oldest first (same rule as the menubar's
 * `agentSteps`). With a plan: its done milestones and the active one (or, with
 * none active, the next pending one). Without: its last 6 story steps.
 * @param {RenderableAgent} a
 * @returns {{label: string, state: 'done'|'current'|'failed'|'neutral'}[]}
 */
function agentSteps(a) {
  const running = a.status === 'running';
  const ms = agentMilestones(a);
  if (ms.length) {
    const active = ms.some((m) => m.status === 'active');
    const next = active ? null : ms.find((m) => m.status !== 'done');
    return ms
      .filter((m) => m.status === 'done' || (active ? m.status === 'active' : m === next))
      .map((m) => ({
        label: str(m.title) || str(m.key) || '?',
        state: m.status === 'done' ? 'done' : m.status === 'active' && running ? 'current' : 'neutral',
      }));
  }
  const steps = Array.isArray(a.steps) ? a.steps.filter((p) => p && str(p.label)) : [];
  return steps.slice(-6).map((p) => ({
    label: str(p.label),
    state: p.kind === 'ok' ? 'done' : p.kind === 'warn' ? 'failed' : p.kind === 'active' && running ? 'current' : 'neutral',
  }));
}

/**
 * Word-wraps one line of text to at most `maxLines` lines of `room` columns; the last one ends in "…" when cut.
 * @param {string} text @param {number} room @param {number} maxLines @returns {string[]}
 */
function wrapText(text, room, maxLines) {
  if (room <= 0) return [];
  /** @type {string[]} */
  const out = [];
  let rest = text.trim();
  while (rest && out.length < maxLines) {
    if (rest.length <= room) { out.push(rest); rest = ''; break; }
    if (out.length === maxLines - 1) { out.push(clip(rest, room)); rest = ''; break; }
    const cut = rest.lastIndexOf(' ', room);
    const at = cut > 0 ? cut : room;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  return out;
}

/**
 * A job's agents in display order: running first, then by start (`startedAt`,
 * else the order given). The menubar uses the same rule.
 * @template {RenderableAgent} T @param {T[]} agents @returns {T[]}
 */
export function sortAgents(agents) {
  const rank = (a) => (a.status === 'running' ? 0 : 1);
  const start = (a) => Date.parse(a.startedAt ?? '') || Date.parse(a.updatedAt ?? '') || 0;
  return agents
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || start(x.a) - start(y.a) || x.i - y.i)
    .map((x) => x.a);
}

/**
 * The step a collapsed agent row names: with a plan, its active milestone
 * (else the next pending one); without one, or with every step done, its `activity`.
 * @param {RenderableAgent} a @param {import('./state.mjs').Milestone[]} ms
 * @returns {string}
 */
function currentStep(a, ms) {
  const m = ms.find((x) => x.status === 'active') ?? ms.find((x) => x.status === 'pending');
  return (m && (str(m.title) || str(m.key))) || str(a.activity);
}

/**
 * The job's summary under its header, as on the menubar card: dim, up to 2 lines.
 * @param {RenderableJob} job @param {number} w @returns {Line[]}
 */
function summaryLines(job, w) {
  const summary = str(job?.summary);
  return summary ? wrapText(summary, w, 2).map((t) => [seg(t, 'dim')]) : [];
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
