// Positions from dagre (layout only; drawing is ours). The main line weighs more so it stays straight.
import dagre from '@dagrejs/dagre'

export function layout(v, { w, h, rank, sep }) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: sep, ranksep: rank, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of v.nodes) g.setNode(n.id, { width: w, height: h })
  for (const e of v.edges) g.setEdge(e.from, e.to, { weight: e.spine ? 8 : 1 })
  dagre.layout(g)
  const pos = {}
  for (const n of v.nodes) { const p = g.node(n.id); pos[n.id] = { x: p.x - w / 2, y: p.y - h / 2 } }
  const edges = v.edges.map((e) => ({ ...e, points: g.edge(e.from, e.to).points }))
  return { pos, edges, width: g.graph().width || w, height: g.graph().height || h }
}

/** A smooth line through dagre's bend points. */
export function pathOf(points) {
  if (!points?.length) return ''
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
    d += ` Q${points[i].x},${points[i].y} ${mid.x},${mid.y}`
  }
  const last = points[points.length - 1]
  return `${d} L${last.x},${last.y}`
}
