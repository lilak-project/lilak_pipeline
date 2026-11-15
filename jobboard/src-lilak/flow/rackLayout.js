/**
 * Where the cards go — pure, so `npm run check` tests it.
 *
 * It starts from dagre's ranks and order: a column per rank, cards packed into rows
 * from the top near their inputs. A link that skips columns owns one free row through
 * the columns it crosses.
 *
 * Drawn left to right, the oldest first: a column per rank, the slots stacked in it;
 * links bend only in the gaps between columns and pass through the slots they own.
 */
import dagre from '@dagrejs/dagre'

function snap(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const bins = []
  for (const v of sorted) if (!bins.length || v - bins[bins.length - 1].at(-1) > tol) bins.push([v]); else bins[bins.length - 1].push(v)
  return (v) => bins.findIndex((b) => v >= b[0] - tol && v <= b.at(-1) + tol)
}

export function grid(v) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 4, ranksep: 20, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of v.nodes) g.setNode(n.id, { width: 10, height: 10 })
  for (const e of v.edges) g.setEdge(e.from, e.to, { weight: e.spine ? 8 : 1 })
  dagre.layout(g)
  const at = (n) => g.node(n.id)
  const colOf = snap(v.nodes.map((n) => Math.round(at(n).x)), 3)
  const col = new Map(v.nodes.map((n) => [n.id, colOf(Math.round(at(n).x))]))
  const ncol = Math.max(0, ...col.values()) + 1
  // Rows packed from the top: column by column, in dagre's order, each card as near its inputs'
  // row as the cards above it allow. (dagre's own heights left most of the grid empty.)
  const ins = new Map(v.nodes.map((n) => [n.id, []]))
  for (const e of v.edges) ins.get(e.to)?.push(e.from)
  const slot = new Map()
  for (let c = 0; c < ncol; c++) {
    let next = 0
    for (const n of v.nodes.filter((x) => col.get(x.id) === c).sort((p, q) => at(p).y - at(q).y)) {
      const rs = ins.get(n.id).map((id) => slot.get(id)).filter((r) => r !== undefined).sort((p, q) => p - q)
      const want = rs.length ? rs[Math.floor((rs.length - 1) / 2)] : next
      slot.set(n.id, Math.max(next, want))
      next = slot.get(n.id) + 1
    }
  }
  // A link that skips columns runs along one row through the columns it crosses: its source's,
  // else its target's, else the nearest row where no card sits and no unrelated link runs.
  const taken = new Map(v.nodes.map((n) => [`${col.get(n.id)}:${slot.get(n.id)}`, null]))
  const free = (e, r, cs) => cs.every((c) => {
    const k = `${c}:${r}`
    return !taken.has(k) || (taken.get(k) && taken.get(k).every((o) => o.from === e.from || o.to === e.to))
  })
  const routes = v.edges.map((e) => {
    const a = col.get(e.from), b = col.get(e.to), r0 = slot.get(e.from), r1 = slot.get(e.to)
    const cs = Array.from({ length: Math.max(0, b - a - 1) }, (_, j) => a + 1 + j)
    let lane = null
    if (cs.length) {
      lane = [r0, r1].find((r) => free(e, r, cs))
      for (let d = 1; lane === undefined; d++) lane = [r0 - d, r0 + d].find((r) => r >= 0 && free(e, r, cs))
      for (const c of cs) taken.set(`${c}:${lane}`, [...(taken.get(`${c}:${lane}`) || []), e])
    }
    return { edge: e, cells: [[a, r0], ...cs.map((c) => [c, lane]), [b, r1]] }
  })
  const nslot = Math.max(0, ...routes.flatMap((r) => r.cells.map((c) => c[1]))) + 1
  return { col, slot, routes, ncol, nslot }
}

/** dims: { w, h (a card), gap (between columns), side (between cards in a column) }. pos is a card's top left.
 *  `dark` (a Set of "from>to") says which links are drawn as the main line; the places come from
 *  v's own spine either way, so choosing a card recolours the links without moving the cards. */
export function modulesLayout(v, { w, h, gap, side }, dark = null) {
  const { col: rank, slot, routes, ncol, nslot } = grid(v)
  const x = (r) => r * (w + gap)
  const y = (s) => s * (h + side)
  const mid = (s) => y(s) + h / 2
  const segs = []
  for (const { edge, cells } of routes) {
    const spine = dark ? dark.has(`${edge.from}>${edge.to}`) : !!edge.spine
    cells.forEach(([r, s], i) => {
      if (i === cells.length - 1) return
      if (i > 0) segs.push({ x1: x(r), y1: mid(s), x2: x(r) + w, y2: mid(s), spine }) // through its own empty slot
      const [r2, s2] = cells[i + 1]
      const xm = x(r) + w + gap / 2
      segs.push({ x1: x(r) + w, y1: mid(s), x2: xm, y2: mid(s), spine })
      if (s !== s2) segs.push({ x1: xm, y1: mid(s), x2: xm, y2: mid(s2), spine })
      segs.push({ x1: xm, y1: mid(s2), x2: x(r2), y2: mid(s2), spine, arrow: i === cells.length - 2 })
    })
  }
  const cells = new Map()
  for (const n of v.nodes) cells.set(`${rank.get(n.id)}:${slot.get(n.id)}`, n)
  const pos = {}
  for (const n of v.nodes) pos[n.id] = { x: x(rank.get(n.id)), y: y(slot.get(n.id)) }
  return { cells, segs, pos, width: x(ncol) - gap, height: y(nslot) - side }
}
