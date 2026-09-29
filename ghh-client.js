// GHH API client for the web UI: request envelope, snapshot loader, adapters
// from API entities to the shapes GHH.dc.html renders, and the bell listener.
(function () {
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // UUIDv7, as the api port requires: 48-bit unix ms, version 7, variant 10.
  function uuidv7() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    let ms = Date.now();
    for (let i = 5; i >= 0; i--) { b[i] = ms % 256; ms = Math.floor(ms / 256); }
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = hex(b);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  class GHHError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  }

  const pad = (n) => String(n).padStart(2, '0');
  // Unix ms <-> the local 'YYYY-MM-DDTHH:mm' strings the editor works in.
  const isoLocal = (ms) => {
    if (ms == null) return '';
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const toMs = (iso) => (iso ? new Date(iso).getTime() : null);
  const dayLocal = (ms) => isoLocal(ms).slice(0, 10);

  function ago(ms, now) {
    const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  const conf = { endpoint: '', token: '' };

  function httpUrl() {
    const raw = conf.endpoint.trim();
    if (!raw) throw new GHHError('unconfigured', 'Set the API endpoint under Settings.');
    return /^https?:\/\//.test(raw) ? raw : 'http://' + raw;
  }

  // Bell port beside the api port on the same model: .../ports/api -> .../ports/bell.
  function bellUrl() {
    const u = httpUrl();
    if (!/\/ports\/api\/?$/.test(u)) return null;
    return u.replace(/^http/, 'ws').replace(/\/ports\/api\/?$/, '/ports/bell');
  }

  async function call(op, args, key) {
    const url = httpUrl();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, conf.token ? { Authorization: 'Bearer ' + conf.token } : {}),
        body: JSON.stringify({ request_id: uuidv7(), idempotency_key: key || null, command: { op, args: args || {} } })
      });
    } catch (e) { throw new GHHError('unreachable', 'Could not reach ' + conf.endpoint.trim() + '. Either the service is down or it rejected this page\'s origin (' + location.origin + '): RELATIVE_ALLOWED_ORIGINS must contain exactly that string.'); }
    let body;
    try { body = await res.json(); } catch (e) { throw new GHHError('bad_reply', 'HTTP ' + res.status + ' with no JSON body.'); }
    if (!body || !body.emitted || !body.value) {
      throw new GHHError('bad_reply', 'HTTP ' + res.status + ': ' + ((body && (body.error || body.message)) || 'the model did not reply.'));
    }
    const v = body.value;
    if (!v.ok) throw new GHHError(v.error.code, v.error.message, v.error.details);
    return v.result;
  }

  const mutate = (op, args) => call(op, args, 'ui-' + uuidv7());

  async function all(op, args, maxPages) {
    let items = [], after;
    for (let i = 0; i < (maxPages || 25); i++) {
      const r = await call(op, Object.assign({}, args, { limit: 200 }, after ? { after } : {}));
      items = items.concat(r.items);
      if (!r.next_after) break;
      after = r.next_after;
    }
    return items;
  }

  const adaptUser = (u) => ({ id: u.id, name: u.name, desc: u.description || '', agent: u.role === 'agent', system: u.role === 'system', role: u.role, admin: !!u.is_admin });
  const adaptTask = (t) => ({
    id: t.id, p: t.project_id, name: t.name, desc: t.description || '',
    status: t.state === 'finished' ? 'done' : t.state, as: t.assignee_id || '', by: t.created_by,
    start: isoLocal(t.scheduling.start), due: isoLocal(t.scheduling.due), startMs: t.scheduling.start, dueMs: t.scheduling.due,
    deps: [], outcome: t.outcome || '', v: t.version, stale: !!t.stale, blocked: !!t.blocked, parent: t.parent_id, updatedAt: t.updated_at, ev: []
  });
  const adaptProject = (p, members) => ({
    id: p.id, name: p.name, desc: p.description || '', stale: p.stale_after_hours, members: members.map((m) => m.user_id), roles: members
  });

  // Every call costs ~0.4s on the server and they run one at a time, so the
  // load is split: cold data (identity, projects, members, subscriptions,
  // config) changes rarely; hot data (tasks, edges, notifications) is what a
  // bell ring refetches. project_graph already returns every task of a project.
  async function loadCold() {
    const [me, users, projects, subs, cfg] = await Promise.all([
      call('query.me'), all('query.users', {}), all('query.projects', {}), call('query.subscriptions'), call('query.config')
    ]);
    const members = await Promise.all(projects.map((p) => call('query.members', { project_id: p.id })));
    return {
      me: adaptUser(me), users: users.map(adaptUser), projects: projects.map((p, i) => adaptProject(p, members[i].members)),
      subs: subs.items, config: { stale: cfg.stale_after_hours, dueSoon: cfg.due_soon_hours }
    };
  }

  // Identity of the project list, so a hot load can tell that cold data is stale.
  const projectKey = (ps) => JSON.stringify(ps.map((p) => [p.id, p.name, p.desc, p.stale]).sort());

  async function loadHot(projectIds, withNotes) {
    const own = new Set(projectIds);
    const [graphs, notes, projects] = await Promise.all([
      Promise.all(projectIds.map((id) => call('query.project_graph', { project_id: id }))), withNotes === false ? [] : all('query.notifications', {}, 50),
      all('query.projects', {})
    ]);
    const byId = new Map(), ghosts = {}, edges = new Set();
    for (const g of graphs) {
      for (const t of g.tasks) {
        if (own.has(t.project_id)) byId.set(t.id, adaptTask(t));
        else if (!ghosts[t.id]) ghosts[t.id] = adaptTask(t);
      }
      for (const e of g.edges) edges.add(e.task_id + '>' + e.depends_on_id);
    }
    for (const id of Object.keys(ghosts)) if (byId.has(id)) delete ghosts[id];
    for (const k of edges) {
      const [a, b] = k.split('>'), t = byId.get(a);
      if (t) t.deps.push(b);
    }
    return { tasks: Array.from(byId.values()), ghosts, notes: notes.slice().reverse(), projectKey: projectKey(projects.map((p) => ({ id: p.id, name: p.name, desc: p.description || '', stale: p.stale_after_hours }))) };
  }

  async function snapshot() {
    const cold = await loadCold();
    return Object.assign(cold, await loadHot(cold.projects.map((p) => p.id)));
  }

  // One line per event, without the actor.
  function eventText(e, look) {
    const u = (id) => (look.user(id) || { name: id || 'someone' }).name, t = (id) => look.task(id).name, d = e.data || {};
    const date = (ms) => (ms == null ? 'none' : isoLocal(ms).replace('T', ' '));
    switch (e.type) {
      case 'task.created': return 'created this task';
      case 'task.updated': return 'updated ' + Object.keys(d.after || {}).map((k) => (k === 'description' ? 'description' : k === 'parent_id' ? 'parent' : k)).join(', ');
      case 'task.scheduled': return 'rescheduled: start ' + date(d.after.start) + ', due ' + date(d.after.due);
      case 'task.state_changed':
        if (d.to === 'active') return 'started';
        if (d.to === 'finished') return 'finished: ' + (d.outcome || '');
        if (d.to === 'canceled') return 'canceled';
        return d.from === 'active' ? 'unclaimed' : 'reopened';
      case 'task.assigned': return 'assigned to ' + u(d.to);
      case 'task.handed_off': return 'handed off to ' + u(d.to) + (d.reason ? ': "' + d.reason + '"' : '');
      case 'task.deleted': return 'deleted this task';
      case 'task.unblocked': return 'was unblocked: ' + t(d.resolved_by) + ' finished';
      case 'task.due_soon': return 'is due soon (' + date(d.due) + ')';
      case 'task.overdue': return 'is overdue (was due ' + date(d.due) + ')';
      case 'task.stale': return 'has had no activity since ' + date(d.last_event_at);
      case 'dependency.added': return 'added prerequisite ' + t(d.depends_on);
      case 'dependency.removed': return 'removed prerequisite ' + t(d.depends_on);
      case 'note.added': return 'added a note: ' + d.text;
      case 'project.created': return 'created project ' + (d.project && d.project.name);
      case 'project.updated': return 'updated the project';
      case 'project.archived': return 'archived the project';
      case 'project.deleted': return 'deleted the project';
      case 'project.member_added': return 'added ' + u(d.user) + ' to the project';
      case 'project.member_removed': return 'removed ' + u(d.user) + ' from the project';
    }
    return e.type;
  }

  // Bell: a data-free "something committed" ping. Frames are not queued, so
  // onOpen must refetch; reconnects back off up to 15s.
  function connectBell(handlers) {
    let ws, closed = false, tries = 0, timer;
    const open = () => {
      let url;
      try { url = bellUrl(); } catch (e) { url = null; }
      if (!url) { handlers.status('off'); return; }
      handlers.status('connecting');
      try { ws = new WebSocket(url); } catch (e) { retry(); return; }
      ws.onopen = () => { tries = 0; handlers.status('live'); handlers.ring(); };
      ws.onmessage = () => handlers.ring();
      ws.onclose = () => { if (!closed) { handlers.status('offline'); retry(); } };
      ws.onerror = () => {};
    };
    const retry = () => { clearTimeout(timer); timer = setTimeout(open, Math.min(15000, 1000 * Math.pow(2, tries++))); };
    open();
    return () => { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} };
  }

  const newToken = () => 'ghh_' + hex(crypto.getRandomValues(new Uint8Array(20)));
  const newSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
  const sha256hex = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

  window.GHH = { projectKey, conf, call, mutate, all, adaptUser, adaptProject, snapshot, loadCold, loadHot, eventText, connectBell, uuidv7, GHHError, isoLocal, toMs, dayLocal, ago, newToken, newSecret, sha256hex, adaptTask, httpUrl, bellUrl };
})();
