/**
 * Where the board's data comes from: this jobboard project's document — its jobs
 * (the portal's copy of the analysis server's job DB) and what people decide here. `?demo=1` swaps in
 * made-up tasks and keeps everything in this browser.
 */
import { PORTAL_BASE, authHeaders, load, save, projectKey, linkProject } from 'racklist/portal.js'
import { SAMPLE } from './sample.js'

export const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')

// jobboard stores its statuses in Korean (as pull_stark writes them).
const STATE = { 대기: 'queued', 실행: 'running', 성공: 'done', 실패: 'failed', 중지: 'stopped', '사람 차례': 'waiting' }

/** A sortable time: jobrun ids carry seconds (YYYYMMDD-HHMMSS-xxxxxx), the record only minutes. */
function stamp(r) {
  const m = String(r.jobId || '').match(/^(\d{8})-(\d{6})/)
  return m ? m[1] + m[2] : `${String(r.date || '').replace(/-/g, '')}${String(r.time || '').replace(':', '')}00`
}

export function fromJobboard(r) {
  return {
    id: r.id,
    inputs: (r.inputs || []).map((x) => (x && typeof x === 'object' ? x.id : x)).filter(Boolean),
    state: STATE[r.status] || 'queued',
    at: stamp(r),
    recipe: r.recipe || r.tool || r.title || '?',
    params: r.paramValues || {},
    run: r.run,
    record: r,
  }
}

const json = async (res) => {
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
const send = (method, path, body) => fetch(PORTAL_BASE + path, {
  method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(json)

export async function loadTasks() {
  if (DEMO) return SAMPLE
  const doc = await fetch(`${PORTAL_BASE}/api/data`, { headers: authHeaders() }).then(json)
  return (doc.jobs || []).map(fromJobboard)
}

/** One job as its jobrun has it now: log end, files, recipe description. */
export async function loadJob(jobId) {
  if (DEMO || !jobId) return null
  return fetch(`${PORTAL_BASE}/api/jobrun/${encodeURIComponent(jobId)}`, { headers: authHeaders() }).then(json)
}

/** One job record's changes, newest first: [{at, kind, size, delta, added, removed, changed}]. */
export async function loadHistory(id) {
  if (DEMO || !id) return []
  return fetch(`${PORTAL_BASE}/api/history/jobs/${encodeURIComponent(id)}`, { headers: authHeaders() }).then(json)
}

/** A file of a job's output as an object URL (the request needs the portal token, an <img src> would not send it). */
export async function fileUrl(jobId, name) {
  const res = await fetch(`${PORTAL_BASE}/api/jobrun/${encodeURIComponent(jobId)}/file/${encodeURIComponent(name)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`${res.status}`)
  return URL.createObjectURL(await res.blob())
}

const demoKey = (what) => projectKey('jb-flow-demo', what)

export async function loadOwn() {
  if (DEMO) return { evaluations: load(demoKey('evaluations'), []), prefs: load(demoKey('prefs'), []), pins: load(demoKey('pins'), []), me: 'demo' }
  const [doc, me] = await Promise.all([
    fetch(`${PORTAL_BASE}/api/data`, { headers: authHeaders() }).then(json),
    fetch(`${PORTAL_BASE}/api/whoami`, { headers: authHeaders() }).then(json).catch(() => ({})),
  ])
  return { evaluations: doc.evaluations || [], prefs: doc.prefs || [], pins: doc.pins || [], evidenceLog: doc.evidence_log || [], me: me.email || me.username || '', name: me.username || '' }
}

/** One record into `key` (evaluations, pins) — or, with `id` already there, laid over it (prefs). */
export async function putRecord(key, record, exists) {
  if (DEMO) {
    const list = load(demoKey(key), [])
    const at = new Date().toISOString()
    const next = exists ? list.map((r) => (r.id === record.id ? { ...r, ...record, updatedAt: at } : r))
      : [{ id: record.id || crypto.randomUUID(), createdAt: at, ...record }, ...list]
    save(demoKey(key), next)
    return next.find((r) => r.id === (record.id || next[0].id))
  }
  const out = exists
    ? await send('POST', '/api/records/update', { key, id: record.id, fields: record })
    : await send('POST', '/api/records', { key, record })
  return out.record
}

export async function removePin(id) {
  if (DEMO) { save(demoKey('pins'), load(demoKey('pins'), []).filter((p) => p.id !== id)); return }
  // A shared pin is stopped, not deleted: the record of who pinned what stays.
  await send('POST', '/api/records/update', { key: 'pins', id, fields: { removed: new Date().toISOString() } })
}

/** Approve or cancel (approval_api.py): { allowed, mode, entry, state }. A person here is always `by: 사람`. */
export async function approve(id, body) {
  return send('POST', `/api/approve/${encodeURIComponent(id)}`, body)
}

/** A person confirms every agent approval among `ids` at once (a result and all above it). */
export async function confirmAll(ids, reason) {
  return send('POST', '/api/confirm', { ids, reason })
}

/** A place cited again: make it a part (and re-point every link at it), or "not now" (evidence_api.py). */
export const promoteEvidence = (body) => send('POST', '/api/evidence/promote', body)
export const declineEvidence = (body) => send('POST', '/api/evidence/decline', body)

let focusTimer = null
/** Where I am looking, for a local agent (`GET /api/focus`). Sent at most every 400 ms. */
export function sendFocus(payload) {
  if (DEMO) return
  clearTimeout(focusTimer)
  focusTimer = setTimeout(() => { send('PUT', '/api/focus', payload).catch(() => {}) }, 400)
}


/** A new project in project_manager, wearing a tag of its own. */
/** `tag` is its place: its own name, or under a parent's tag for a sub-project (AToM-X/ihm). */
export function createProject(name, tag = name) {
  return fetch(`/pp/project_manager/${linkProject('project_manager')}/api/records`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'projects', record: { name, tags: [tag], match: 'or' } }),
  }).then(json)
}

export const boardProject = () => load(projectKey('jb-flow', 'project'), '')
export const saveBoardProject = (id) => save(projectKey('jb-flow', 'project'), id)
export const listOpen = () => load(projectKey('jb-flow', 'listOpen'), true)
export const saveListOpen = (v) => save(projectKey('jb-flow', 'listOpen'), v)
export const listWidth = () => load(projectKey('jb-flow', 'listWidth'), 380)
export const saveListWidth = (w) => save(projectKey('jb-flow', 'listWidth'), w)
export const localFolded = () => new Set(load(projectKey('jb-flow', 'folded'), []))
export const saveFolded = (set) => save(projectKey('jb-flow', 'folded'), [...set])
export const seenFailed = () => new Set(load(projectKey('jb-flow', 'seenFailed'), []))
export const saveSeenFailed = (set) => save(projectKey('jb-flow', 'seenFailed'), [...set])
