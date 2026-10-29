// Turkish strings, taken from the menubar app's Localizable.xcstrings where it has the same text.
const TR = {
  'Filter jobs…': 'İşleri filtrele…', 'Loading…': 'Yükleniyor…', Back: 'Geri',
  History: 'Geçmiş', Stats: 'İstatistikler', Colors: 'Renkler', Notifications: 'Bildirimler',
  '{0} jobs · {1} agents': '{0} iş · {1} agent', 'Done today: {0}': 'Bugün biten: {0}',
  'No live jobs': 'Çalışan iş yok', 'No finished jobs yet': 'Henüz biten iş yok', 'No steps': 'Henüz adım yok',
  planning: 'planlıyor', running: 'çalışıyor', 'waiting for you': 'seni bekliyor', done: 'bitti', error: 'hata', stale: 'etkinlik yok',
  'No activity for {0} min': 'Etkinlik yok: {0} dk', hidden: 'gizlendi',
  '{0}m': '{0} dk', '{0}h {1}m': '{0} sa {1} dk',
  Agents: "Agent'lar", 'Agents · {0} running': "Agent'lar · {0} çalışıyor", 'quiet {0}m': '{0}dk sessiz',
  Hide: 'Gizle', 'Hide this job here; its session is not stopped': 'Bu işi burada gizler; oturumu durdurmaz',
  'Stop session…': 'Oturumu durdur…', 'Ends the whole session and its agents': 'Tüm oturumu ve ajanlarını kapatır',
  '{0}: the whole session and its agents stop. Work it has not saved is lost.': '{0}: tüm oturum ve ajanları kapanır. Kaydedilmemiş iş kaybolur.',
  'Process not found (already closed?)': 'Süreç bulunamadı (zaten kapanmış olabilir)',
  Done: 'Bitti', 'Needs you': 'Seni bekliyor', Failing: 'Hata veriyor',
  Stages: 'Aşamalar', States: 'Durumlar', plan: 'plan', analyse: 'analiz', dev: 'geliştirme', fix: 'düzeltme', review: 'inceleme',
  'Planning the work': 'İşi planlıyor', 'Reading and searching': 'Okuyor ve arıyor', 'Writing code': 'Kod yazıyor',
  'Fixing after a failure': 'Hatadan sonra düzeltiyor', 'Building, testing, reviewing': 'Derliyor, test ediyor, inceliyor',
  'An agent is working on it': 'Bir ajan üzerinde çalışıyor', 'Waiting for your answer or a permission': 'Cevabını ya da iznini bekliyor',
  'Builds or tests failed 3 times in a row': 'Derleme veya test üst üste 3 kez başarısız', quiet: 'sessiz',
  'An agent sent nothing for 5 min': 'Ajan 5 dakikadır hiçbir şey göndermedi', 'Every step finished': 'Bütün adımlar bitti',
  'Since the weekly reset · {0} jobs · resets {1}': 'Haftalık sıfırlamadan beri · {0} iş · sıfırlanma {1}', '{0}% used': '%{0} kullanıldı',
  'Last 7 days · {0} jobs (no weekly limit reading yet)': 'Son 7 gün · {0} iş (haftalık limit henüz okunmadı)',
  'By day': 'Güne göre', 'By job': 'İşe göre', 'Last 1 day': 'Son 1 gün', 'Last {0} days': 'Son {0} gün',
  'Last {0} jobs': 'Son {0} iş', 'Last {0} jobs ({1})': 'Son {0} iş ({1})',
};

/** Runs in the browser: serialized into the page, so it may only use its arguments and browser globals. */
function client(lang, dict) {
  const L = lang === 'tr' ? dict : {};
  const t = (s, ...a) => (L[s] ?? s).replace(/\{(\d)\}/g, (_, i) => a[i]);
  // Under the Windows tray, tray.ps1 posts the notifications (it runs with the window closed too).
  const TRAY = new URLSearchParams(location.search).has('tray');
  const MIN = 60000, DAY = 1440 * MIN;
  const STATUS = { waiting: 'waiting for you' };
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // "820 tok", "64k tok", "1.2M tok": the menubar app's L10n.tokens.
  const fmt = (n) => (n < 1000 ? `${n} tok` : n < 999500 ? `${Math.round(n / 1000)}k tok` : `${(n / 1e6).toFixed(n < 99950000 ? 1 : 0)}M tok`);
  const time = (iso) => Date.parse(iso) || 0;
  const ago = (iso) => {
    const s = (time(iso) - Date.now()) / 1000;
    const [n, u] = Math.abs(s) < 3600 ? [s / 60, 'minute'] : Math.abs(s) < 86400 ? [s / 3600, 'hour'] : [s / 86400, 'day'];
    return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(Math.round(n), u);
  };
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / MIN)); return m < 60 ? t('{0}m', m) : t('{0}h {1}m', Math.floor(m / 60), m % 60); };
  // Per-viewer choices; the page works the same when storage is blocked.
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // Liveness, the menubar's rules: a session's last unfinished job, moved in the last 24 h; stale after 10 min
  // without an event (60 with a tool still running); hidden until its session moves again.
  const isStale = (j, now) => (j.status === 'running' || j.status === 'planning')
    && now - time(j.sessionUpdatedAt) > (j.status === 'running' && j.toolInFlight ? 60 : 10) * MIN;
  let hidden = store.get('hidden', {});
  const isHidden = (j) => hidden[j.id] != null && time(j.sessionUpdatedAt) <= hidden[j.id];
  const hide = (id) => {
    const now = Date.now();
    hidden = Object.fromEntries(Object.entries({ ...hidden, [id]: now }).filter(([, at]) => now - at < 30 * DAY));
    store.set('hidden', hidden);
    render();
  };
  const liveJobs = (now) => jobs.filter((j) => j.latest && j.status !== 'done' && now - time(j.sessionUpdatedAt) <= DAY && !isHidden(j))
    .map((j) => ({ j, rank: j.status === 'waiting' ? 0 : isStale(j, now) ? 2 : 1 }))
    .sort((a, b) => a.rank - b.rank || time(b.j.updatedAt) - time(a.j.updatedAt)).map((x) => x.j);
  const ended = (j) => time(j.endedAt ?? j.updatedAt);
  const historyJobs = () => jobs.filter((j) => j.status === 'done' || isHidden(j)).sort((a, b) => ended(b) - ended(a)).slice(0, 50);

  const row = (j, now) => {
    const stale = isStale(j, now);
    const state = stale ? t('No activity for {0} min', Math.floor((now - time(j.sessionUpdatedAt)) / MIN)) : t(STATUS[j.status] ?? j.status);
    return `<li class="job${stale ? ' stale' : ''}" data-job-id="${escape(j.id)}" data-status="${escape(j.status)}"><details><summary>
      <span class="dot"></span><strong title="${escape(j.title)}">${escape(j.title)}</strong>
      <span class="percent">${j.percent === null ? '—' : `${j.percent}%`}</span>
      <span class="meta">${[state, j.project, fmt(j.tokens)].map(escape).join(' · ')}</span>
      <progress max="100" value="${j.percent ?? 0}"></progress>
    </summary><div class="detail"></div></details></li>`;
  };
  const historyRow = (j) => `<li class="job" data-job-id="${escape(j.id)}" data-status="${escape(j.status)}"><details><summary>
      <span class="dot"></span><strong title="${escape(j.title)}">${escape(j.title)}</strong>
      <span class="percent">${j.status === 'done' ? '' : `${t('hidden')} · `}${ago(j.endedAt ?? j.updatedAt)}</span>
      <span class="meta">${[j.project, dur(ended(j) - time(j.startedAt)), j.tokens > 0 ? fmt(j.tokens) : ''].filter(Boolean).map(escape).join(' · ')}</span>
      ${j.progress ? `<span class="note">${escape(j.progress)}</span>` : ''}
    </summary><div class="detail"></div></details></li>`;

  // Agents: the menubar's agentCurrentStep / agentSteps.
  const openAgents = new Set();
  const quietMin = (a, now) => (a.status === 'running' && now - time(a.updatedAt) >= 5 * MIN ? Math.floor((now - time(a.updatedAt)) / MIN) : null);
  const currentStep = (a) => (a.milestones.find((m) => m.status === 'active') ?? a.milestones.find((m) => m.status === 'pending'))?.title || a.activity;
  const agentSteps = (a) => {
    const run = a.status === 'running';
    if (a.milestones.length) {
      const next = a.milestones.some((m) => m.status === 'active') ? null : a.milestones.find((m) => m.status !== 'done');
      return a.milestones.filter((m) => m.status === 'done' || m.status === 'active' || m === next)
        .map((m) => ({ label: m.title, state: m.status === 'done' ? 'done' : m.status === 'active' && run ? 'active' : '' }));
    }
    return a.steps.map((p) => ({ label: p.label, state: p.kind === 'ok' ? 'done' : p.kind === 'warn' ? 'failed' : p.kind === 'active' && run ? 'active' : '' }));
  };
  const agentRow = (a, now) => {
    const q = quietMin(a, now);
    const steps = agentSteps(a);
    return `<li class="agent" data-agent-id="${escape(a.id)}" data-status="${q === null ? escape(a.status) : 'quiet'}"><details${openAgents.has(a.id) ? ' open' : ''}><summary>
      <span class="dot"></span><strong>${escape(a.name)}</strong><span class="percent">${a.tokens ? fmt(a.tokens) : ''}</span>
      <span class="meta">${escape(q === null ? currentStep(a) || t(STATUS[a.status] ?? a.status) : t('quiet {0}m', q))}</span>
    </summary>${steps.length ? `<ol class="ms">${steps.map((s) => `<li class="${s.state}"><span class="dot"></span>${escape(s.label)}</li>`).join('')}</ol>` : ''}</details></li>`;
  };
  const detail = (d, now) => {
    const running = d.agents.filter((a) => a.status === 'running').length;
    const actions = [
      isStale(d, now) && !isHidden(d) ? `<button data-act="hide" title="${escape(t('Hide this job here; its session is not stopped'))}">${t('Hide')}</button>` : '',
      d.canStop ? `<button data-act="stop" class="danger" title="${escape(t('Ends the whole session and its agents'))}">${t('Stop session…')}</button>` : '',
    ].join('');
    return (d.milestones.length
      ? `<ol class="ms">${d.milestones.map((m) => `<li class="${escape(m.status)}" data-stage="${escape(m.stage ?? '')}"><span class="dot"></span>${escape(m.title)}</li>`).join('')}</ol>`
      : `<p class="none">${t('No steps')}</p>`)
      + (d.agents.length ? `<h3>${running ? t('Agents · {0} running', running) : t('Agents')}</h3><ul class="agents">${d.agents.map((a) => agentRow(a, now)).join('')}</ul>` : '')
      + (actions ? `<div class="actions">${actions}</div>` : '');
  };

  const statsView = (w) => {
    const head = w.fromReset
      ? t('Since the weekly reset · {0} jobs · resets {1}', w.jobs, new Date(w.resetsAt).toLocaleString(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))
        + (w.percentUsed == null ? '' : ` · ${t('{0}% used', Math.round(w.percentUsed))}`)
      : t('Last 7 days · {0} jobs (no weekly limit reading yet)', w.jobs);
    const stat = (label, n) => `<li class="stat"><span>${escape(label)}</span><b>${fmt(n)}</b></li>`;
    return `<p class="big">${fmt(w.total)}</p><p class="sub">${escape(head)}</p>
      <h2>${t('By day')}</h2><ul>${w.days.map((r) => stat(r.d === 1 ? t('Last 1 day') : t('Last {0} days', r.d), r.tokens)).join('')}</ul>
      <h2>${t('By job')}</h2><ul>${w.last.map((r) => stat(r.count < r.n ? t('Last {0} jobs ({1})', r.n, r.count) : t('Last {0} jobs', r.n), r.tokens)).join('')}</ul>`;
  };
  const STAGES = [['plan', 'Planning the work'], ['analyse', 'Reading and searching'], ['dev', 'Writing code'], ['fix', 'Fixing after a failure'], ['review', 'Building, testing, reviewing']];
  const STATES = [['running', 'running', 'An agent is working on it'], ['waiting', 'Needs you', 'Waiting for your answer or a permission'],
    ['error', 'Failing', 'Builds or tests failed 3 times in a row'], ['quiet', 'quiet', 'An agent sent nothing for 5 min'], ['done', 'Done', 'Every step finished']];
  const legend = () => `<h2>${t('Stages')}</h2><ul class="legend">${STAGES.map(([s, d]) => `<li data-stage="${s}"><span class="dot"></span><b>${t(s)}</b><span>${t(d)}</span></li>`).join('')}</ul>
    <h2>${t('States')}</h2><ul class="legend">${STATES.map(([s, n, d]) => `<li data-status="${s}"><span class="dot"></span><b>${t(n)}</b><span>${t(d)}</span></li>`).join('')}</ul>`;

  const ICONS = {
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    legend: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>',
  };
  const TITLES = { history: 'History', stats: 'Stats', legend: 'Colors' };
  const icon = (name) => `<a class="icon" href="#${name}" title="${t(TITLES[name])}" aria-label="${t(TITLES[name])}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg></a>`;

  const bar = document.getElementById('bar'), view = document.getElementById('view'), q = document.getElementById('q');
  const today = document.getElementById('today'), notify = document.getElementById('notify');
  let jobs = [], week = null, ready = false;
  const details = new Map();

  function render() {
    const now = Date.now();
    const page = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'jobs';
    const live = liveJobs(now);
    const active = live.filter((j) => !isStale(j, now));
    bar.innerHTML = page === 'jobs'
      ? `<h1>agent-rail</h1><span id="sum">${escape(t('{0} jobs · {1} agents', active.length, active.reduce((n, j) => n + 1 + j.agentsRunning, 0)))}</span>${icon('history')}${icon('stats')}${icon('legend')}`
      : `<a class="back" href="#" aria-label="${t('Back')}">‹</a><h1>${t(TITLES[page])}</h1>`;
    today.textContent = t('Done today: {0}', jobs.filter((j) => j.status === 'done' && new Date(ended(j)).toDateString() === new Date(now).toDateString()).length);
    q.hidden = page === 'stats' || page === 'legend';
    if (page === 'legend') { view.innerHTML = legend(); return; }
    if (page === 'stats') { view.innerHTML = week ? statsView(week) : `<p class="empty">${t('Loading…')}</p>`; return; }
    if (!ready) { view.innerHTML = `<p class="empty">${t('Loading…')}</p>`; return; }
    // Keep expanded cards open across live updates; the toggle event reloads their detail.
    const open = new Set([...view.querySelectorAll('.job > details[open]')].map((d) => d.parentElement.dataset.jobId));
    const needle = q.value.toLocaleLowerCase(lang);
    const shown = (page === 'history' ? historyJobs() : live).filter((j) => String(j.title).toLocaleLowerCase(lang).includes(needle));
    view.innerHTML = `<ul>${shown.map((j) => (page === 'history' ? historyRow(j) : row(j, now))).join('')
      || `<li class="empty">${t(page === 'history' ? 'No finished jobs yet' : 'No live jobs')}</li>`}</ul>`;
    for (const li of view.querySelectorAll('.job')) if (open.has(li.dataset.jobId)) li.querySelector('details').open = true;
  }

  async function loadDetail(li) {
    const id = li.dataset.jobId;
    const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
    if (!r.ok) return;
    const d = await r.json();
    details.set(id, d);
    const box = view.querySelector(`.job[data-job-id="${CSS.escape(id)}"] .detail`);
    if (box) box.innerHTML = detail(d, Date.now());
  }
  async function loadStats() {
    const r = await fetch('/api/stats');
    if (r.ok) { week = (await r.json()).week; if (location.hash === '#stats') render(); }
  }

  view.addEventListener('toggle', (e) => {
    const li = e.target.parentElement;
    if (li.classList.contains('agent')) { if (e.target.open) openAgents.add(li.dataset.agentId); else openAgents.delete(li.dataset.agentId); }
    else if (e.target.open) loadDetail(li);
  }, true);
  view.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const id = e.target.closest('.job').dataset.jobId;
    if (act === 'hide') return hide(id);
    if (!confirm(t('{0}: the whole session and its agents stop. Work it has not saved is lost.', details.get(id)?.title ?? id))) return;
    const r = await fetch(`/api/jobs/${encodeURIComponent(id)}/stop`, { method: 'POST', headers: { 'x-agent-rail': '1' } });
    if (!r.ok || !(await r.json()).stopped) alert(t('Process not found (already closed?)'));
  });
  q.addEventListener('input', render);
  addEventListener('hashchange', () => { q.value = ''; if (location.hash === '#stats') loadStats(); render(); });

  // Notifications when a job finishes, waits for the user or starts failing (the menubar's JobNotifier).
  const canNotify = !TRAY && 'Notification' in window;
  notify.closest('label').hidden = !canNotify;
  notify.checked = canNotify && store.get('notify', true) && Notification.permission !== 'denied';
  notify.addEventListener('change', async () => {
    store.set('notify', notify.checked);
    if (notify.checked && Notification.permission === 'default') notify.checked = (await Notification.requestPermission()) === 'granted';
  });
  const firstSentence = (s) => (s.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? s).trim();
  const body = (j) => (j.status === 'done' ? [t('Done'), firstSentence(j.progress)] : j.status === 'waiting' ? [t('Needs you')] : [t('Failing'), j.warn])
    .filter(Boolean).join(' · ');
  let seen = null;
  const notifyChanges = () => {
    // The first payload only seeds what was seen: jobs already done at launch never notify.
    const prev = seen;
    seen = new Map(jobs.map((j) => [j.id, j.status]));
    if (!prev || !notify.checked || Notification.permission !== 'granted') return;
    for (const j of jobs) {
      if (prev.get(j.id) !== j.status && ['done', 'waiting', 'error'].includes(j.status)) new Notification(j.title, { body: body(j), tag: j.id });
    }
  };

  new EventSource('/events').addEventListener('jobs', (e) => {
    jobs = JSON.parse(e.data);
    ready = true;
    if (canNotify) notifyChanges();
    if (location.hash === '#stats') loadStats();
    render();
  });
  // Ages and staleness move with the clock, not only with the files.
  setInterval(render, 30000);
  if (location.hash === '#stats') loadStats();
  render();
}

const STYLE = `
/* The menubar app's Theme.swift palette. */
:root { color-scheme: light dark; --bg: #f7f6f2; --raised: rgb(0 0 0 / .035); --fg: #1f1f1d; --dim: #5e5d56; --line: #dad9d2;
  --accent: #9a4519; --done: #1f7a42; --waiting: #7a6a00; --error: #b02a22; --quiet: #3e3d38;
  --plan: #6a3fb8; --analyse: #2c5bb0; --dev: var(--accent); --fix: #b02a22; --review: #0e716c; }
@media (prefers-color-scheme: dark) { :root { --bg: #242422; --raised: rgb(255 255 255 / .045); --fg: #ecebe6; --dim: #aaa99f; --line: #3a3a35;
  --accent: #e08a5c; --done: #5cb87a; --waiting: #f2d541; --error: #ec746c; --quiet: #f1f0ea;
  --plan: #b49af2; --analyse: #7fa8f0; --fix: #ec746c; --review: #4cc2b6; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 420px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; }
#view { flex: 1; }
header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; min-height: 43px; padding: 8px 10px 8px 12px; background: var(--bg); border-bottom: 1px solid var(--line); }
h1 { margin: 0; font-size: 13px; }
#sum { color: var(--dim); font-size: 12px; margin: 0 4px 0 auto; }
.icon, .back { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; color: var(--dim); text-decoration: none; }
.icon:hover, .back:hover { background: var(--raised); color: var(--fg); }
.back { font-size: 20px; line-height: 1; }
a:focus-visible, summary:focus-visible, input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
#q { width: calc(100% - 16px); margin: 8px 8px 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--raised); color: inherit; font: inherit; }
ul { list-style: none; margin: 0; padding: 8px; display: grid; gap: 6px; }
.job { background: var(--raised); border: 1px solid var(--line); border-radius: 10px; }
.job.stale > details > summary { opacity: .6; }
summary { display: grid; grid-template-columns: 10px 1fr auto; gap: 2px 8px; align-items: center; padding: 8px 10px; cursor: pointer; list-style: none; border-radius: 10px; }
summary::-webkit-details-marker { display: none; }
strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.percent { color: var(--dim); font-size: 11px; font-variant-numeric: tabular-nums; }
.meta, .note { grid-column: 2 / 4; color: var(--dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 11.5px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
progress { grid-column: 2 / 4; width: 100%; height: 4px; appearance: none; border: 0; border-radius: 2px; background: var(--line); overflow: hidden; }
progress::-webkit-progress-bar { background: var(--line); }
/* Separate rules: a selector list with an unknown pseudo-element is dropped whole. */
progress::-webkit-progress-value { background: var(--c, var(--dim)); }
progress::-moz-progress-bar { background: var(--c, var(--dim)); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--dim)); flex: none; }
[data-status=running] { --c: var(--accent); } [data-status=done] { --c: var(--done); } [data-status=waiting] { --c: var(--waiting); }
[data-status=error] { --c: var(--error); } [data-status=quiet] { --c: var(--quiet); } [data-status=planning] { --c: var(--plan); }
/* li[data-stage] outranks the step state colors below: a job's steps show their stage. */
li[data-stage=plan] { --c: var(--plan) !important; } li[data-stage=analyse] { --c: var(--analyse) !important; } li[data-stage=dev] { --c: var(--dev) !important; }
li[data-stage=fix] { --c: var(--fix) !important; } li[data-stage=review] { --c: var(--review) !important; }
.job[data-status=running]:not(.stale) > details > summary .dot, .agent[data-status=running] > details > summary .dot { animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none !important; } }
.detail { padding: 0 10px 10px 28px; }
.ms { list-style: none; margin: 0; padding: 0; color: var(--dim); font-size: 12px; display: grid; gap: 3px; }
.ms li { display: flex; align-items: center; gap: 8px; }
.ms .done { opacity: .7; } .ms .active { color: var(--fg); font-weight: 600; } .ms .failed { color: var(--error); }
.ms .done { --c: var(--done); } .ms .active { --c: var(--accent); } .ms .failed { --c: var(--error); }
.none { margin: 0; color: var(--dim); font-size: 12px; }
h3 { margin: 10px 0 4px; font-size: 11px; font-weight: 600; color: var(--dim); }
.agents { padding: 0; gap: 2px; }
.agents summary { padding: 4px 0; grid-template-columns: 8px 1fr auto; }
.agents .ms { padding: 2px 0 6px 16px; }
.actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
button { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--raised); color: var(--fg); cursor: pointer; }
button:hover { border-color: var(--dim); } .danger { color: var(--error); }
.empty { text-align: center; color: var(--dim); padding: 28px; }
h2 { margin: 12px 12px 0; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); }
.legend li { display: flex; align-items: baseline; gap: 10px; padding: 0 4px; font-size: 12px; }
.legend .dot { align-self: center; } .legend b { font-weight: 600; } .legend span:last-child { color: var(--dim); }
.big { margin: 12px 12px 0; font-size: 22px; font-weight: 600; } .sub { margin: 4px 12px 0; color: var(--dim); font-size: 12px; }
.stat { display: flex; justify-content: space-between; padding: 7px 12px; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; font-size: 12.5px; }
.stat b { font-variant-numeric: tabular-nums; }
footer { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg); border-top: 1px solid var(--line); color: var(--dim); font-size: 12px; }
footer label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
`;

/** The popover page, laid out like the macOS menubar app (~400px); the browser renders it from /events. */
export function page(lang = 'en') {
  const s = (k) => (lang === 'tr' && TR[k]) || k;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>agent-rail</title>
<style>${STYLE}</style></head>
<body><main>
<header id="bar"></header>
<input id="q" type="search" placeholder="${s('Filter jobs…')}" aria-label="${s('Filter jobs…')}">
<div id="view"></div>
<footer><span id="today"></span><label><input id="notify" type="checkbox"> ${s('Notifications')}</label></footer>
</main>
<script>(${client})(${JSON.stringify(lang)}, ${JSON.stringify(TR)});</script></body></html>`;
}
