/**
 * What to draw around one task — pure, so the rules can be checked without a
 * browser (`npm run check`).
 *
 *   task: { id, inputs: [ids, main first], state, at, recipe, params, run }
 *   state: queued | running | done | failed | stopped | waiting (a person's turn)
 *
 * Upstream (what fed the task) is drawn whole; downstream is one path. A task
 * that failed has no children: jobrun refuses it as a parent.
 */

export function indexTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const kids = new Map(tasks.map((t) => [t.id, []]))
  const inputs = new Map(tasks.map((t) => [t.id, (t.inputs || []).filter((p) => byId.has(p))]))
  for (const [id, ps] of inputs) for (const p of ps) kids.get(p).push(id)
  return { byId, kids, inputs }
}

function walk(start, next) {
  const seen = new Set()
  const stack = [start]
  while (stack.length) for (const n of next(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n) }
  return seen
}

const newer = (a, b) => (b.at || '').localeCompare(a.at || '') || String(b.id).localeCompare(String(a.id))
const up = (ix, id) => walk(id, (n) => ix.inputs.get(n) || [])
const down = (ix, id) => walk(id, (n) => ix.kids.get(n) || [])

/** The last task of a set, a stopped branch not counting. */
function latest(ix, ids) {
  return [...ids].map((id) => ix.byId.get(id)).filter((t) => t.state !== 'stopped').sort(newer)[0]?.id
}

/** Downstream of `anchor`: my pin, else a project pin, else the latest job; walked back from that end. */
export function forwardPath(ix, anchor, pins = {}) {
  const desc = down(ix, anchor)
  if (!desc.size) return [anchor]
  const pinned = (list = []) => [...list].sort((a, b) => (b.at || '').localeCompare(a.at || '')).find((p) => desc.has(p.end))?.end
  const end = pinned(pins.mine) ?? pinned(pins.shared) ?? latest(ix, desc)
  if (!end) return [anchor]
  const path = []
  for (let cur = end; cur && cur !== anchor; cur = ix.inputs.get(cur).find((p) => p === anchor || desc.has(p))) path.unshift(cur)
  return [anchor, ...path]
}

/** The branches a card does not show: one row per child that was not drawn. */
export function branches(ix, id, shown) {
  return (ix.kids.get(id) || []).filter((k) => !shown.has(k)).map((kid) => {
    const all = new Set([kid, ...down(ix, kid)])
    const end = latest(ix, all) ?? kid
    return { kid, end, size: all.size, state: ix.byId.get(end).state, at: ix.byId.get(end).at }
  }).sort((a, b) => (b.at || '').localeCompare(a.at || ''))
}

const edgeKey = (from, to) => `${from}>${to}`
const paramsKey = (t) => JSON.stringify(Object.entries(t.params || {}).filter(([k]) => k !== 'run').sort())
const PRIORITY = { failed: 0, waiting: 1, running: 2, queued: 3 }

/** Columns: the anchor is 0, each input one further left, by the longest way. */
function depths(anchor, edges) {
  const out = new Map()
  for (const { from, to } of edges.values()) out.set(to, [...(out.get(to) || []), from])
  const d = new Map([[anchor, 0]])
  let moved = true
  for (let guard = 0; moved && guard <= edges.size + 1; guard++) {
    moved = false
    for (const [to, froms] of out) {
      if (!d.has(to)) continue
      for (const f of froms) if ((d.get(f) ?? -1) < d.get(to) + 1) { d.set(f, d.get(to) + 1); moved = true }
    }
  }
  return d
}

/** Drop whatever no longer reaches the anchor. */
function prune(anchor, nodes, edges) {
  const inputsOf = new Map()
  for (const { from, to } of edges.values()) inputsOf.set(to, [...(inputsOf.get(to) || []), from])
  const keep = new Set([anchor, ...walk(anchor, (n) => inputsOf.get(n) || [])])
  const gone = []
  for (const id of [...nodes.keys()]) if (!keep.has(id) && nodes.get(id).role === 'up') { gone.push(nodes.get(id)); nodes.delete(id) }
  for (const [k, e] of [...edges]) if (!nodes.has(e.from) || !nodes.has(e.to)) edges.delete(k)
  return gone
}

function retarget(edges, from, to) {
  for (const [k, e] of [...edges]) {
    const f = from.has(e.from) ? to : e.from
    const t = from.has(e.to) ? to : e.to
    if (f === e.from && t === e.to) continue
    edges.delete(k)
    if (f !== t) edges.set(edgeKey(f, t), { from: f, to: t })
  }
}

/** Auto-fold 1: tasks that differ only in run number and feed the same thing. */
function bundle(nodes, edges, expanded) {
  for (let changed = true; changed;) {
    changed = false
    const consumers = new Map()
    for (const { from, to } of edges.values()) consumers.set(from, [...(consumers.get(from) || []), to])
    const buckets = new Map()
    for (const n of nodes.values()) {
      if (n.type !== 'task' || n.role !== 'up') continue
      const key = `g:${n.task.recipe}|${paramsKey(n.task)}|${(consumers.get(n.id) || []).sort().join(',')}`
      if (!expanded.has(key)) buckets.set(key, [...(buckets.get(key) || []), n])
    }
    for (const [key, group] of buckets) {
      if (group.length < 3) continue
      const ids = new Set(group.map((n) => n.id))
      const states = {}
      for (const n of group) states[n.task.state] = (states[n.task.state] || 0) + 1
      const runs = group.map((n) => Number(n.task.run ?? n.task.params?.run)).filter(Number.isFinite)
      for (const id of ids) nodes.delete(id)
      nodes.set(key, { id: key, type: 'group', role: 'up', recipe: group[0].task.recipe, members: [...ids], count: ids.size, states,
        runs: runs.length ? [Math.min(...runs), Math.max(...runs)] : null })
      retarget(edges, ids, key)
      changed = true
    }
  }
}

/** Auto-fold 2: a column taller than maxRows keeps what matters and folds the rest. */
function capRows(anchor, nodes, edges, expanded, maxRows) {
  for (let d = 1; ; d++) {
    const depth = depths(anchor, edges)
    const col = [...nodes.values()].filter((n) => n.role === 'up' && depth.get(n.id) === d)
    if (!col.length && ![...depth.values()].some((v) => v > d)) return
    const key = `more:${d}`
    if (col.length <= maxRows || expanded.has(key)) continue
    const score = (n) => [PRIORITY[n.task?.state] ?? 9, n.task?.at || '']
    const sorted = [...col].sort((a, b) => score(a)[0] - score(b)[0] || score(b)[1].localeCompare(score(a)[1]))
    const hide = sorted.slice(maxRows - 1)
    const ids = new Set(hide.map((n) => n.id))
    for (const id of ids) nodes.delete(id)
    for (const [k, e] of [...edges]) if (ids.has(e.to)) edges.delete(k) // what only they fed folds with them
    nodes.set(key, { id: key, type: 'more', role: 'up', members: hide.flatMap((n) => n.members || [n.id]) })
    retarget(edges, ids, key)
    for (const n of prune(anchor, nodes, edges)) nodes.get(key).members.push(...(n.members || [n.id]))
    nodes.get(key).count = nodes.get(key).members.length
  }
}

/** Auto-fold 3: only when upstream is wider than the room left of the anchor, plain one-in one-out stretches shrink, longest first. */
function shrinkChains(anchor, nodes, edges, expanded, maxUp) {
  for (let guard = 0; guard < 64; guard++) {
    const depth = depths(anchor, edges)
    if (Math.max(0, ...depth.values()) > maxUp) {
      const inOf = new Map(); const outOf = new Map()
      for (const { from, to } of edges.values()) {
        inOf.set(to, [...(inOf.get(to) || []), from]); outOf.set(from, [...(outOf.get(from) || []), to])
      }
      const plain = (n) => n?.type === 'task' && n.role === 'up' && n.task.state === 'done' && !n.folded
        && (inOf.get(n.id) || []).length === 1 && (outOf.get(n.id) || []).length === 1
      const runs = []
      for (const n of nodes.values()) {
        if (!plain(n) || plain(nodes.get(outOf.get(n.id)[0]))) continue
        const run = [n.id]
        for (let p = nodes.get(inOf.get(n.id)[0]); plain(p); p = nodes.get(inOf.get(p.id)[0])) run.push(p.id)
        if (run.length >= 2 && !expanded.has(`chain:${n.id}`)) runs.push(run)
      }
      runs.sort((a, b) => b.length - a.length)
      if (runs[0]) {
        const key = `chain:${runs[0][0]}`
        const ids = new Set(runs[0])
        for (const id of ids) nodes.delete(id)
        nodes.set(key, { id: key, type: 'chain', role: 'up', members: [...ids], count: ids.size })
        retarget(edges, ids, key)
        continue
      }
    }
    return
  }
}

/**
 * opts: { pins:{mine,shared}, folded:Set, expanded:Set, maxRows (cards in a column), maxUp (columns left of the anchor), full (no auto-fold) }
 * → { nodes, edges, forward, shown }. Each node: { id, type: task|group|more|chain,
 *   role: anchor|up|forward, col, task?, count?, members?, hidden, forks, extra, foldable }.
 */
export function view(ix, anchor, { pins = {}, folded = new Set(), expanded = new Set(), maxRows = 6, maxUp = Infinity, full = false } = {}) {
  const forward = forwardPath(ix, anchor, pins)
  const nodes = new Map()
  const edges = new Map()
  const put = (id, role) => nodes.has(id) || nodes.set(id, { id, type: 'task', role, task: ix.byId.get(id), folded: folded.has(id) })

  put(anchor, 'anchor')
  forward.slice(1).forEach((id) => put(id, 'forward'))
  const stack = [anchor]
  const seen = new Set(stack)
  while (stack.length) {
    const n = stack.pop()
    if (folded.has(n)) continue
    for (const p of ix.inputs.get(n)) {
      put(p, 'up')
      edges.set(edgeKey(p, n), { from: p, to: n })
      if (!seen.has(p)) { seen.add(p); stack.push(p) }
    }
  }

  if (full) {
    // The wide board is the whole flow: every job linked to this one either way, every link
    // between them, and nothing folded (no group, no "more", no shortened chain).
    const flow = new Set([anchor, ...walk(anchor, (n) => [...(ix.inputs.get(n) || []), ...(ix.kids.get(n) || [])])])
    for (const id of flow) {
      put(id, 'up')
      for (const p of ix.inputs.get(id)) if (flow.has(p)) edges.set(edgeKey(p, id), { from: p, to: id })
    }
  } else {
    bundle(nodes, edges, expanded)
    capRows(anchor, nodes, edges, expanded, maxRows)
    shrinkChains(anchor, nodes, edges, expanded, maxUp)
  }

  const depth = depths(anchor, edges)
  forward.slice(1).forEach((id, i) => {
    edges.set(edgeKey(forward[i], id), { from: forward[i], to: id, spine: true })
  })

  // The main line: first drawn input of each, back from the anchor.
  const inputsOf = new Map()
  for (const e of edges.values()) if (!forward.includes(e.to) || e.to === anchor) inputsOf.set(e.to, [...(inputsOf.get(e.to) || []), e.from])
  for (let cur = anchor, guard = 0; inputsOf.get(cur)?.length && guard < nodes.size; guard++) {
    const task = nodes.get(cur)?.task
    const first = task ? (ix.inputs.get(cur).find((p) => inputsOf.get(cur).includes(p)) ?? inputsOf.get(cur)[0]) : inputsOf.get(cur)[0]
    edges.get(edgeKey(first, cur)).spine = true
    cur = first
  }

  const shown = new Set()
  for (const n of nodes.values()) { if (n.members) n.members.forEach((m) => shown.add(m)); else shown.add(n.id) }

  for (const n of nodes.values()) {
    n.col = n.role === 'forward' ? forward.indexOf(n.id) : -(depth.get(n.id) ?? 0)
    if (n.type !== 'task') continue
    const rest = branches(ix, n.id, shown)
    n.forks = rest.length
    n.forksBad = rest.filter((b) => b.state === 'failed' || b.state === 'waiting').length
    n.extra = n.role === 'forward' ? ix.inputs.get(n.id).filter((p) => !shown.has(p)).length : 0
    n.hidden = n.folded ? [...up(ix, n.id)].filter((p) => !shown.has(p)).length : 0
    // Downstream cards hang off the anchor; their input side is what is centred.
    n.foldable = n.role !== 'forward' && ix.inputs.get(n.id).length > 0
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], forward, shown }
}

/**
 * The main line through the card looked at (`id`), so the dark line is the one that card sits on:
 * back through its first drawn input each step, and down along the drawn links to the board's
 * last job. Every other link is drawn plain. A card folded into a group counts as that group.
 */
export function spineThrough(v, ix, id) {
  const here = v.nodes.find((n) => n.id === id) || v.nodes.find((n) => n.members?.includes(id))
  if (!here) return v
  const edges = v.edges.map((e) => ({ ...e, spine: false }))
  const into = new Map()
  const out = new Map()
  for (const e of edges) {
    into.set(e.to, [...(into.get(e.to) || []), e])
    out.set(e.from, [...(out.get(e.from) || []), e])
  }
  const seen = new Set([here.id])
  for (let cur = here.id; into.get(cur)?.length;) {
    const order = ix.inputs.get(cur) || []
    const e = into.get(cur).find((x) => order[0] === x.from) || [...into.get(cur)].sort((a, b) => order.indexOf(a.from) - order.indexOf(b.from))[0]
    if (seen.has(e.from)) break
    e.spine = true
    seen.add(e.from)
    cur = e.from
  }
  // Down: the shortest drawn path to the board's last job (breadth first, so one path).
  const end = v.forward.at(-1)
  const back = new Map([[here.id, null]])
  const queue = [here.id]
  while (queue.length && !back.has(end)) {
    const n = queue.shift()
    for (const e of out.get(n) || []) if (!back.has(e.to)) { back.set(e.to, e); queue.push(e.to) }
  }
  for (let e = back.get(end); e; e = back.get(e.from)) e.spine = true
  return { ...v, edges }
}

/** A parameter that names an earlier job (jobrun's `job` type): drawn as the edge, not as text. */
export const isJobParam = (t, v) => (t.inputs || []).includes(`jobrun-${v}`)

/** The flows: jobs joined by their inputs, each whole. → [{ id (its oldest job), tasks (oldest first), ids, at }], latest first. */
export function flowsOf(tasks) {
  const near = new Map(tasks.map((t) => [t.id, []]))
  for (const t of tasks) for (const id of t.inputs) if (near.has(id)) { near.get(t.id).push(id); near.get(id).push(t.id) }
  const oldest = [...tasks].sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  const seen = new Set()
  const flows = []
  for (const t of oldest) {
    if (seen.has(t.id)) continue
    const ids = new Set()
    const todo = [t.id]
    while (todo.length) {
      const id = todo.pop()
      if (seen.has(id)) continue
      seen.add(id)
      ids.add(id)
      todo.push(...near.get(id))
    }
    const members = oldest.filter((x) => ids.has(x.id))
    flows.push({ id: t.id, tasks: members, ids, at: members.at(-1).at })
  }
  return flows.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
}

export const flowName = (f) => (f.tasks.length > 1 ? `${f.tasks[0].recipe} → ${f.tasks.at(-1).recipe}` : f.tasks[0].recipe)

/** The whole flow of every job `keep` picks. */
export const withFlows = (tasks, keep) => flowsOf(tasks).filter((f) => f.tasks.some(keep)).flatMap((f) => f.tasks)

/** The tags that put a job on project `p`: all of them for an all-tags project, else the one that names only it. */
export function tagsFor(p, projects) {
  if (p.match === 'and') return p.tags
  const key = (t) => String(t).toLowerCase()
  const others = new Set(projects.filter((x) => x.id !== p.id).flatMap((x) => x.tags.map(key)))
  return [p.tags.find((t) => key(t) === key(p.name)) || p.tags.find((t) => !others.has(key(t))) || p.tags[0]]
}

/** A project's own tag: the path that says where it sits (AToM-X/ihm is inside AToM-X) — the tag that is
 *  its name or ends in it, not just its first (KO-25-20 also wears ELARK); else its name. */
export function ownTag(p) {
  const n = String(p.name || '').toLowerCase()
  return String((p.tags || []).find((t) => { const k = String(t).toLowerCase(); return k === n || k.endsWith(`/${n}`) }) || p.name || '')
}

/**
 * Projects as an outline: a sub-project (its tag inside another project's tag) under that one,
 * the nearest such parent winning. [{ p, depth, parent }], each parent before its children.
 */
export function projectTree(projects) {
  const key = (p) => ownTag(p).toLowerCase()
  const parentOf = new Map(projects.map((p) => [p.id, projects
    .filter((q) => q.id !== p.id && key(p).startsWith(`${key(q)}/`))
    .sort((a, b) => key(b).length - key(a).length)[0] || null]))
  const out = []
  const add = (parent, depth) => {
    for (const p of projects.filter((x) => (parentOf.get(x.id)?.id || null) === (parent?.id || null))) {
      out.push({ p, depth, parent })
      add(p, depth + 1)
    }
  }
  add(null, 0)
  return out
}

/** A short tag for each card: only the parameters its same-recipe neighbours differ in. */
export function differing(nodes) {
  const byRecipe = new Map()
  for (const n of nodes) if (n.type === 'task') byRecipe.set(n.task.recipe, [...(byRecipe.get(n.task.recipe) || []), n.task])
  const tags = new Map()
  for (const list of byRecipe.values()) {
    // Alone, a card shows its first parameter; beside its own kind, only what differs.
    const all = [...new Set(list.flatMap((t) => Object.keys(t.params || {}).filter((k) => !isJobParam(t, t.params[k]))))].filter((k) => k !== 'run')
    const keys = list.length < 2 ? all.slice(0, 1) : all.filter((k) => new Set(list.map((t) => String(t.params?.[k]))).size > 1)
    for (const t of list) tags.set(t.id, keys.slice(0, 2).map((k) => `${k}=${t.params?.[k]}`).join(' '))
  }
  return tags
}

/** Where the arrow keys go: the nearest card that way. */
export function neighbour(positions, from, dir) {
  const a = positions[from]
  if (!a) return null
  const axis = dir === 'left' || dir === 'right' ? 'x' : 'y'
  const sign = dir === 'left' || dir === 'up' ? -1 : 1
  let best = null
  let bestScore = Infinity
  for (const [id, b] of Object.entries(positions)) {
    if (id === from) continue
    const along = (b[axis] - a[axis]) * sign
    if (along <= 1) continue
    const across = Math.abs(b[axis === 'x' ? 'y' : 'x'] - a[axis === 'x' ? 'y' : 'x'])
    const score = along + across * 2
    if (score < bestScore) { bestScore = score; best = id }
  }
  return best
}

/**
 * The job list's lines, git-graph style. `rows` are the listed jobs in list order (top first).
 * Each parent with children in the list gets one trunk: a vertical line in a lane of its own from
 * its top member row to its bottom one, a stub into every member row (the parent's and each
 * child's). Trunks that share rows take different lanes; more than `lanes` and the rest are not
 * drawn but counted on their children's rows (`more`). Parents not in the list are counted too
 * (`outside`). A failed job's first child (its retry) is moved to sit right above it.
 * Returns { rows (reordered), trunks: [{ parent, lane, top, bot, members:Set<row> }], more, outside }.
 */
export function listGraph(list, lanes = 6) {
  const failedRetry = new Map()
  const at = new Map(list.map((t, i) => [t.id, i]))
  for (const t of list) {
    for (const p of t.inputs || []) {
      const par = list[at.get(p)]
      if (par?.state === 'failed' && (!failedRetry.has(p) || at.get(t.id) > at.get(failedRetry.get(p)))) failedRetry.set(p, t.id)
    }
  }
  const moved = new Set(failedRetry.values())
  const rows = []
  for (const t of list) {
    if (moved.has(t.id)) continue
    const retry = failedRetry.get(t.id)
    if (retry) rows.push(list[at.get(retry)])
    rows.push(t)
  }
  const row = new Map(rows.map((t, i) => [t.id, i]))
  const kids = new Map()
  const outside = new Map()
  for (const t of rows) {
    for (const p of t.inputs || []) {
      if (row.has(p)) kids.set(p, [...(kids.get(p) || []), t.id])
      else outside.set(t.id, (outside.get(t.id) || 0) + 1)
    }
  }
  const trunks = [...kids].map(([parent, ks]) => {
    const members = new Set([row.get(parent), ...ks.map((k) => row.get(k))])
    return { parent, kids: ks, members, top: Math.min(...members), bot: Math.max(...members), lane: -1 }
  })
  // Top first, each in the first lane free over its rows. (Shortest first was tried: it drops the
  // long trunks, which are the shared parents, and those count on every child — more overflow.)
  const used = []       // per lane, the [top, bot] spans on it
  const more = new Map()
  for (const tr of [...trunks].sort((x, y) => x.top - y.top || x.bot - y.bot)) {
    let l = used.findIndex((spans) => spans.every(([t, b]) => b < tr.top || t > tr.bot))
    if (l < 0) l = used.length
    if (l >= lanes) { for (const k of tr.kids) more.set(k, (more.get(k) || 0) + 1); continue }
    ;(used[l] ||= []).push([tr.top, tr.bot])
    tr.lane = l
  }
  return { rows, trunks: trunks.filter((x) => x.lane >= 0), more, outside }
}
