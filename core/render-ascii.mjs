/**
 * ASCII rendering of one job for fixed-width terminals: title + %, block
 * progress bar, metro line of milestones, and a mini flow under the active
 * milestone. No Node built-ins: the Claude Code mod imports this file.
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
 */

/** Below this width the metro line is dropped for a one-line summary. */
export const COMPACT_WIDTH = 40;
const BAR_MAX = 30;
const BAR_MIN = 6;
const STEP_MIN = 6;
const STEP_MAX = 14;

/**
 * @param {RenderableJob} job
 * @param {number} width Columns available.
 * @param {number} [nowMs] Clock for the elapsed time of an unfinished job.
 * @returns {string[]} Plain lines, none longer than `width`.
 */
export function renderJob(job, width, nowMs = Date.now()) {
  return renderJobSegments(job, width, nowMs).map((line) => line.map((s) => s.text).join(''));
}

/**
 * @param {RenderableJob} job
 * @param {number} width
 * @param {number} [nowMs]
 * @returns {Line[]}
 */
export function renderJobSegments(job, width, nowMs = Date.now()) {
  const w = Math.max(10, Math.floor(width) || 0);
  const title = str(job?.title) || 'Untitled job';
  const milestones = Array.isArray(job?.milestones) ? job.milestones : [];
  const status = job?.status;
  const isDone = status === 'done';
  const { done, total, pct } = progress(job);
  const tail = statusTail(status);

  if (total === 0) {
    // "Planning · 0/?" comes from the missing plan, whatever the status says.
    const label = isDone ? `Done · ${elapsed(job, nowMs)}` : 'Planning · 0/?';
    const lead = `${clip(title, w - label.length - 2 - tailLen(tail))}  `;
    /** @type {Line[]} */
    const lines = [[seg(lead, 'bold'), seg(label, isDone ? 'done' : 'dim'), ...tail]];
    // Spec §7 fallback: a planless job still shows what the agent is doing.
    const now = job?.now;
    if (!isDone && now && typeof now === 'object') {
      const flow = flowLine(now, w);
      if (flow.length) lines.push(flow);
    } else if (isDone && now && typeof now === 'object') {
      const recent = recentLine(now, w);
      if (recent.length) lines.push(recent);
    }
    return lines.map((l) => fit(l.filter(nonEmpty), w));
  }

  const pctText = `${pct}%`;

  if (w < COMPACT_WIDTH) {
    const current = currentMilestone(milestones, isDone, job?.now?.milestone);
    const info = ` · ${done}/${total} · ${pctText}`;
    const name = clip(current, w - 2 - info.length - tailLen(tail));
    return [
      [seg(clip(title, w), 'bold')],
      [seg('▸ ', isDone ? 'done' : 'active'), seg(name, 'plain'), seg(info, 'dim'), ...tail],
    ].map((l) => fit(l, w));
  }

  /** @type {Line[]} */
  const lines = [];

  const titleRoom = w - pctText.length - 1;
  const shownTitle = clip(title, titleRoom);
  lines.push([seg(shownTitle, 'bold'), seg(' '.repeat(w - shownTitle.length - pctText.length), 'plain'), seg(pctText, 'bold')]);

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
    const flow = flowLine(now, w);
    if (flow.length) lines.push(flow);
    const file = str(now.file);
    if (file) lines.push([seg('  ', 'plain'), seg(clip(file, w - 2), 'dim')]);
  }

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
 * @param {import('./state.mjs').Now} now
 * @param {number} w
 * @returns {Line} Most recent pills that fit, oldest dropped first.
 */
function flowLine(now, w) {
  const pills = Array.isArray(now.pills) ? now.pills : [];
  const attempt = Number.isFinite(now.attempt) && now.attempt >= 2 ? `  ↻ ${now.attempt}` : '';
  const room = w - 2 - attempt.length;
  /** @type {Segment[]} */
  const kept = [];
  let used = 0;
  for (let i = pills.length - 1; i >= 0; i--) {
    const p = pills[i];
    const text = pillText(p);
    if (!text) continue;
    const cost = text.length + (kept.length ? 3 : 0);
    if (used + cost > room) break;
    kept.unshift(seg(text, pillTone(p?.kind)));
    used += cost;
  }
  if (!kept.length) return attempt ? [seg('  ', 'plain'), seg(attempt.trim(), 'warn')] : [];
  /** @type {Line} */
  const line = [seg('  ', 'plain')];
  kept.forEach((s, i) => {
    if (i) line.push(seg(' → ', 'dim'));
    line.push(s);
  });
  if (attempt) line.push(seg(attempt, 'warn'));
  return line;
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

/** @param {{label?: string, kind?: string}} p */
function pillText(p) {
  const label = str(p?.label);
  if (!label) return '';
  if (p.kind === 'ok') return `${label} ✓`;
  if (p.kind === 'active') return `${label} ▶`;
  return label;
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
