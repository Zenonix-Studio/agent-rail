import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.AGENT_RAIL_HOME = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures');
const { tokenSum, summarize, allJobs } = await import('../lib/jobs.mjs');

test('tokenSum leaves out cache reads and treats missing fields as 0', () => {
  assert.equal(tokenSum({ input: 1, output: 2, cacheRead: 100, cacheWrite: 3 }), 6);
  assert.equal(tokenSum({ output: 5 }), 5);
  assert.equal(tokenSum(undefined), 0);
});

test('summarize counts done milestones', () => {
  const j = summarize({ project: 'p', agents: {} }, { id: 'x', seq: 99, title: 't', status: 'running', updatedAt: '2026-01-01T00:00:00Z',
    milestones: [{ title: 'a', status: 'done' }, { title: 'b', status: 'active', stage: 'dev' }] });
  assert.equal(j.done, 1);
  assert.equal(j.total, 2);
  assert.equal(j.percent, 50);
  assert.deepEqual(j.milestones[1], { title: 'b', status: 'active', stage: 'dev' });
});

test('allJobs reads the fixtures and skips the broken file', () => {
  const jobs = allJobs();
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((j) => typeof j.id === 'string'));
});
