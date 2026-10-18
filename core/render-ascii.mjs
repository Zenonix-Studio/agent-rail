/**
 * ASCII rendering of one job for fixed-width terminals: title + %, block
 * progress bar, metro line of milestones, the flow of human-readable steps
 * under the active milestone, and one line per subagent of the job. No Node
 * built-ins: the Claude Code mod imports this file.
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
 * @typedef {Pick<import('./state.mjs').Agent, 'name'|'status'|'activity'> & {updatedAt?: string}} RenderableAgent
 * @typedef {number|RenderableAgent[]} AgentsArg Running count only (title hint), or the job's
 *   subagents (`jobAgents` in core/progress.mjs): the hint plus an "Agents" block in the wide layout.
 */

/** Below this width the metro line is dropped for a one-line summary. */
export const COMPACT_WIDTH = 40;
const BAR_MAX = 30;
const BAR_MIN = 6;
const STEP_MIN = 6;
const STEP_MAX = 14;
const AGENTS_SHOWN = 4;

/**
 * @param {RenderableJob} job
 * @param {number} width Columns available.
 * @param {number} [nowMs] Clock for the elapsed time of an unfinished job.
 * @param {AgentsArg} [agents]
 * @returns {string[]} Plain lines, none longer than `width`.
 */
export function renderJob(job, width, nowMs = Date.now(), agents = 0) {
  return renderJobSegments(job, width, nowMs, agents).map((line) => line.map((s) => s.text).join(''));
}

/**
 * @param {RenderableJob} job
 * @param {number} width
 * @param {number} [nowMs]
 * @param {AgentsArg} [agents]
 * @returns {Line[]}
 */
export function renderJobSegments(job, width, nowMs = Date.now(), agents = 0) {
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
  const block = w < COMPACT_WIDTH ? [] : agentLines(list, w);
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
      lines.push(...flowLines(now, w));
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

  const metro = metroLines(milestones, w, isDone);
  lines.push(...metro.lines);

  const now = job?.now;
  if (!isDone && now && typeof now === 'object') {
    // Anchor the flow under now.milestone (a key); else the active-status node.
    const byKey = milestones.findIndex((m) => str(m?.key) !== '' && m.key === now.milestone);
    const anchor = byKey >= 0 ? byKey : milestones.findIndex((m) => m?.status === 'active');
    const col = anchor >= 0 ? metro.nodeCols[anchor] ?? -1 : -1;
    if (col >= 0) lines.push([seg(' '.repeat(col), 'plain'), seg('↓', 'active')]);
    lines.push(...flowLines(now, w));
    const file = str(now.file);
    if (file) lines.push([seg('  ', 'plain'), seg(clip(file, w - 2), 'dim')]);
  }
  lines.push(...block);

  return lines.map((l) => fit(l.filter(nonEmpty), w));
}

/**
 * Metro line plus aligned labels. A done job's leftover 'active' milestone is
 * drawn neutral (plain ◉, no accent): it never finished, but nothing runs now.
 * @param {import('./state.mjs').Milestone[]} milestones
 * @param {number} w
 * @param {boolean} isDone
 * @returns {{ lines: Line[], nodeCols: number[] }} nodeCols[i] is node i's column, or -1 when not drawn.
 */
function metroLines(milestones, w, isDone) {
  const n = milestones.length;
  // Gap between node columns: connector glyphs + 1 for the node itself.
  // Wide enough for the longest label (capped), never past the width.
  const longest = Math.max(0, ...milestones.map((m) => (str(m?.title) || str(m?.key)).length));
  const want = Math.min(STEP_MAX, Math.max(STEP_MIN, longest + 1));
  const step = n <= 1 ? w : Math.min(want, Math.floor((w - 1) / (n - 1)));
  if (step < 1) {
    return { lines: [[seg(clip(`${n} milestones`, w), 'dim')]], nodeCols: milestones.map(() => -1) };
  }

  /** @type {Line} */
  const track = [];
  /** @type {Line} */
  const labels = [];
  /** @type {number[]} */
  const nodeCols = [];
  let labelEnd = 0;

  milestones.forEach((m, i) => {
    const tone = nodeTone(m?.status, isDone);
    const col = i * step;
    if (i > 0) {
      const reached = m?.status === 'done' || (m?.status === 'active' && !isDone);
      track.push(seg((reached ? '━' : '┄').repeat(step - 1), reached ? 'done' : 'dim'));
    }
    track.push(seg(nodeGlyph(m?.status), tone));
    nodeCols.push(col);

    // Label starts at its node, clipped one column short of the next node.
    const room = (i === n - 1 ? w : col + step - 1) - col;
    const text = clip(str(m?.title) || str(m?.key) || '?', room);
    if (col >= labelEnd && text) {
      labels.push(seg(' '.repeat(col - labelEnd), 'plain'), seg(text, tone === 'pending' ? 'dim' : tone));
      labelEnd = col + text.length;
    }
  });

  return { lines: [track, labels], nodeCols };
}

/**
 * The story of the latest steps: `A ✓ → B → C ▶`, on up to FLOW_ROWS lines.
 * Most recent pills that fit are kept, oldest dropped first; an arrow travels
 * with the pill after it, so a line never ends on "→".
 * @param {import('./state.mjs').Now} now
 * @param {number} w
 * @returns {Line[]}
 */
function flowLines(now, w) {
  const pills = Array.isArray(now.pills) ? now.pills : [];
  const attempt = Number.isFinite(now.attempt) && now.attempt >= 2 ? `  ↻ ${now.attempt}` : '';
  const room = w - 2;
  /** @type {Segment[]} */
  const kept = [];
  // Newest first: each older pill is kept only if the whole set still lays out.
  for (let i = pills.length - 1; i >= 0; i--) {
    const text = pillText(pills[i], room - 2 - attempt.length);
    if (!text) continue;
    const next = [seg(text, pillTone(pills[i]?.kind)), ...kept];
    if (layout(next, room, attempt.length) === null) break;
    kept.unshift(next[0]);
  }
  if (!kept.length) return attempt ? [[seg('  ', 'plain'), seg(attempt.trim(), 'warn')]] : [];
  const rows = /** @type {Segment[][]} */ (layout(kept, room, attempt.length));
  const lines = rows.map((row, r) => [seg(r === 0 ? '  ' : '    ', 'plain'), ...row]);
  if (attempt) lines[lines.length - 1].push(seg(attempt, 'warn'));
  return lines;
}

const FLOW_ROWS = 2;

/**
 * Wraps pills into rows; continuation rows are indented 2 more columns.
 * @param {Segment[]} pills @param {number} room @param {number} tail columns kept free on the last row
 * @returns {Segment[][]|null} null when they need more than FLOW_ROWS rows.
 */
function layout(pills, room, tail) {
  /** @type {Segment[][]} */
  const rows = [[]];
  let used = 0;
  for (const p of pills) {
    const row = rows[rows.length - 1];
    const width = room - (rows.length > 1 ? 2 : 0);
    const cost = p.text.length + (row.length ? 3 : 0);
    if (row.length && used + cost > width) {
      if (rows.length === FLOW_ROWS) return null;
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
 * "Agents" block: one line per subagent, `● <name> — <latest activity>`, running ones first.
 * @param {RenderableAgent[]} agents
 * @param {number} w
 * @returns {Line[]} none when there are no agents.
 */
function agentLines(agents, w) {
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
  const lines = [[seg('  Agents', 'dim')]];
  for (const a of shown) {
    const [glyph, tone] = AGENT_GLYPH[/** @type {keyof typeof AGENT_GLYPH} */ (a.status)] ?? ['·', 'dim'];
    const activity = str(a.activity) || (a.status === 'running' ? 'starting…' : '');
    const nameRoom = activity ? Math.max(8, Math.floor((w - 6) * 0.45)) : w - 6;
    const name = clip(str(a.name) || 'agent', nameRoom);
    const line = [seg('  ', 'plain'), seg(glyph, /** @type {Tone} */ (tone)), seg(' ', 'plain'), seg(name, a.status === 'running' ? 'plain' : 'dim')];
    if (activity) line.push(seg(' — ', 'dim'), seg(clip(activity, w - 4 - name.length - 3), 'dim'));
    lines.push(line);
  }
  if (shown.length < sorted.length) lines.push([seg(`    +${sorted.length - shown.length} more`, 'dim')]);
  return lines;
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

/** @param {string|undefined} status @param {boolean} isDone @returns {Tone} */
function nodeTone(status, isDone) {
  if (status === 'done') return 'done';
  if (status === 'active') return isDone ? 'plain' : 'active';
  return 'pending';
}

/** @param {string|undefined} status */
function nodeGlyph(status) {
  if (status === 'done') return '●';
  if (status === 'active') return '◉';
  return '○';
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
