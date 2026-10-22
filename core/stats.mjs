// Token stats since the weekly limit reset: the pane's Stats tab (the menubar computes the same in Swift).

const DAY_MS = 24 * 60 * 60 * 1000;
export const STAT_DAYS = [1, 3, 5];
export const STAT_JOBS = [3, 10, 25, 50];

/**
 * The weekly window's start: 7 days before `resetsAt`, or the last 7 days without a reading
 * (no subscription, nothing measured yet) or with a reset already past.
 * @param {{resetsAt?: string}|null|undefined} sevenDay @param {number} now
 * @returns {{since: number, fromReset: boolean}}
 */
export function windowStart(sevenDay, now) {
  const reset = Date.parse(sevenDay?.resetsAt ?? '');
  return Number.isFinite(reset) && reset > now ? { since: reset - 7 * DAY_MS, fromReset: true } : { since: now - 7 * DAY_MS, fromReset: false };
}

/**
 * @param {{time: number, tokens: number}[]} items every job: `endedAt ?? updatedAt`, and its tokens with its agents'
 * @param {{now: number, since: number}} at
 */
export function tokenStats(items, { now, since }) {
  const inWindow = items.filter((i) => i.time >= since).sort((a, b) => b.time - a.time);
  const sum = (list) => list.reduce((t, i) => t + i.tokens, 0);
  return {
    since,
    total: sum(inWindow),
    jobs: inWindow.length,
    days: STAT_DAYS.map((d) => ({ d, tokens: sum(inWindow.filter((i) => i.time >= Math.max(since, now - d * DAY_MS))) })),
    last: STAT_JOBS.map((n) => ({ n, count: Math.min(n, inWindow.length), tokens: sum(inWindow.slice(0, n)) })),
  };
}

// Self-check: node core/stats.mjs
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const now = 10 * DAY_MS;
  const items = [{ time: now - 1000, tokens: 5 }, { time: now - 2 * DAY_MS, tokens: 7 }, { time: now - 6 * DAY_MS, tokens: 11 }, { time: now - 9 * DAY_MS, tokens: 99 }];
  const s = tokenStats(items, { now, since: now - 7 * DAY_MS });
  console.assert(s.total === 23 && s.jobs === 3, 'window');
  console.assert(s.days.map((x) => x.tokens).join() === '5,12,12', 'days');
  console.assert(s.last.map((x) => `${x.count}:${x.tokens}`).join() === '3:23,3:23,3:23,3:23', 'last');
  console.assert(windowStart({ resetsAt: new Date(now + DAY_MS).toISOString() }, now).since === now - 6 * DAY_MS, 'reset');
  console.assert(windowStart(null, now).fromReset === false, 'fallback');
  console.log('ok');
}
