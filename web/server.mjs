import { createServer } from 'node:http';
import { allJobs, filterJobs, findJob, stats } from './lib/jobs.mjs';
import { procRunning, signature, stopProc } from './lib/sessions.mjs';
import { page } from './lib/html.mjs';

const port = Number(process.env.PORT) || 4317;
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
const json = (res, code, body) => send(res, code, 'application/json', JSON.stringify(body));
const listJSON = (jobs) => JSON.stringify(jobs.map(({ milestones, agents, proc, ...j }) => ({ ...j, agentsRunning: agents.filter((a) => a.status === 'running').length })));
// Only our own origin: a DNS-rebound name fails the Host check, and a cross-site POST cannot send the custom header without a preflight we never answer.
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

const clients = new Set();
let sig = signature();
// Polling, not fs.watch: same behavior on Windows, macOS and Linux.
setInterval(() => {
  const now = signature();
  if (now === sig || clients.size === 0) { sig = now; return; }
  sig = now;
  const data = listJSON(allJobs());
  for (const res of clients) res.write(`event: jobs\ndata: ${data}\n\n`);
}, 500).unref();

createServer((req, res) => {
  if (!hosts.has(req.headers.host)) return send(res, 403, 'text/plain', 'forbidden');
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const stop = req.method === 'POST' && path.match(/^\/api\/jobs\/(.+)\/stop$/);
  if (stop) {
    if (req.headers['x-agent-rail'] !== '1') return send(res, 403, 'text/plain', 'forbidden');
    const job = findJob(decodeURIComponent(stop[1]));
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, { stopped: stopProc(job.proc) });
  }
  if (req.method !== 'GET') return send(res, 404, 'text/plain', 'not found');
  if (path === '/api/jobs') return send(res, 200, 'application/json', listJSON(filterJobs(allJobs(), url.searchParams)));
  if (path === '/api/stats') return json(res, 200, stats());
  if (path.startsWith('/api/jobs/')) {
    const job = findJob(decodeURIComponent(path.slice('/api/jobs/'.length)));
    if (!job) return json(res, 404, { error: 'job not found' });
    const { startedAt, proc, ...j } = job;
    return json(res, 200, { ...j, canStop: procRunning(proc) });
  }
  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: jobs\ndata: ${listJSON(allJobs())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (path === '/') return send(res, 200, 'text/html; charset=utf-8', page(/^tr\b/i.test(req.headers['accept-language'] ?? '') ? 'tr' : 'en'));
  send(res, 404, 'text/plain', 'not found');
}).listen(port, '127.0.0.1', () => console.log(`agent-rail viewer on http://127.0.0.1:${port}`));
