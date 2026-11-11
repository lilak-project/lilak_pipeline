/**
 * Where the cards go — pure, so `npm run check` tests it.
 *
 * It starts from dagre's order snapped to a grid: a rank per step of the history,
 * a slot per place within it. The bend points dagre gives a long edge are snapped
 * too, so a link that skips ranks owns a free slot in each rank it crosses.
 *
 * Drawn top to bottom, the oldest first: a row per rank, the slots side by side;
 * links bend only in the gaps between rows and pass through the slots they own.
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
  const inner = v.edges.map((e) => g.edge(e.from, e.to).points.slice(1, -1))
  const colOf = snap(v.nodes.map((n) => Math.round(at(n).x)), 3)
  const slotOf = snap([...v.nodes.map((n) => Math.round(at(n).y)), ...inner.flat().map((p) => Math.round(p.y))], 2)
  const col = new Map(v.nodes.map((n) => [n.id, colOf(Math.round(at(n).x))]))
  const slot = new Map(v.nodes.map((n) => [n.id, slotOf(Math.round(at(n).y))]))
  // Each link as the (column, slot) cells it runs through, in column order.
  const routes = v.edges.map((e, i) => {
    const cells = [[col.get(e.from), slot.get(e.from)]]
    for (const p of inner[i]) {
      const c = colOf(Math.round(p.x))
      if (c > cells.at(-1)[0] && c < col.get(e.to)) cells.push([c, slotOf(Math.round(p.y))])
    }
    cells.push([col.get(e.to), slot.get(e.to)])
    return { edge: e, cells }
  })
  const ncol = Math.max(0, ...col.values()) + 1
  const nslot = Math.max(0, ...slot.values(), ...routes.flatMap((r) => r.cells.map((c) => c[1]))) + 1
  return { col, slot, routes, ncol, nslot }
}

/** dims: { w, h (a card), gap (between rows), side (between cards in a row) }. pos is a card's top left. */
export function modulesLayout(v, { w, h, gap, side }) {
  const { col: rank, slot, routes, ncol, nslot } = grid(v)
  const x = (s) => s * (w + side)
  const y = (r) => r * (h + gap)
  const mid = (s) => x(s) + w / 2
  const segs = []
  for (const { edge, cells } of routes) {
    const spine = !!edge.spine
    cells.forEach(([r, s], i) => {
      if (i === cells.length - 1) return
      if (i > 0) segs.push({ x1: mid(s), y1: y(r), x2: mid(s), y2: y(r) + h, spine }) // through its own empty slot
      const [r2, s2] = cells[i + 1]
      const ym = y(r) + h + gap / 2
      segs.push({ x1: mid(s), y1: y(r) + h, x2: mid(s), y2: ym, spine })
      if (s !== s2) segs.push({ x1: mid(s), y1: ym, x2: mid(s2), y2: ym, spine })
      segs.push({ x1: mid(s2), y1: ym, x2: mid(s2), y2: y(r2), spine, arrow: i === cells.length - 2 })
    })
  }
  const cells = new Map()
  for (const n of v.nodes) cells.set(`${rank.get(n.id)}:${slot.get(n.id)}`, n)
  const pos = {}
  for (const n of v.nodes) pos[n.id] = { x: x(slot.get(n.id)), y: y(rank.get(n.id)) }
  return { cells, segs, pos, width: x(nslot) - side, height: y(ncol) - gap }
}
