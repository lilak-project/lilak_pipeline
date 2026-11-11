// The drawing rules, on made-up tasks: npm run check
import assert from 'node:assert/strict'
import { indexTasks, forwardPath, view, branches, differing, flowsOf, flowName, withFlows, tagsFor } from './graph.js'
import { modulesLayout } from './rackLayout.js'

let clock = 0
const t = (id, inputs = [], extra = {}) => ({ id, inputs, state: 'done', recipe: id, at: String(1000 + clock++), ...extra })
const ids = (v) => new Set(v.nodes.map((n) => n.id))
const node = (v, id) => v.nodes.find((n) => n.id === id)

// a → b → c → d, and a calibration that skips columns into d; c also branches to e, f.
const base = [t('a'), t('cal'), t('b', ['a']), t('c', ['b']), t('d', ['c', 'cal']), t('e', ['c']), t('f', ['c'])]
const ix = indexTasks(base)

// Upstream whole, downstream one path — the latest job.
let v = view(ix, 'c')
assert.deepEqual(ids(v), new Set(['a', 'b', 'c', 'f']))
assert.deepEqual(v.forward, ['c', 'f'])
assert.equal(node(v, 'a').col, -2)
assert.equal(node(v, 'f').col, 1)
assert.equal(node(v, 'c').forks, 2, 'd and e are not drawn')

// Merge: every input of the anchor is drawn, with the longest column.
v = view(ix, 'd')
assert.deepEqual(ids(v), new Set(['a', 'b', 'c', 'cal', 'd']))
assert.ok(v.edges.find((e) => e.from === 'c' && e.to === 'd').spine, 'first input is the main line')
assert.ok(!v.edges.find((e) => e.from === 'cal').spine)

// A pin beats the latest; mine beats the project's.
assert.deepEqual(forwardPath(ix, 'c', { shared: [{ end: 'e', at: '1' }] }), ['c', 'e'])
assert.deepEqual(forwardPath(ix, 'c', { mine: [{ end: 'd', at: '1' }], shared: [{ end: 'e', at: '9' }] }), ['c', 'd'])
assert.deepEqual(forwardPath(ix, 'd', { mine: [{ end: 'e', at: '1' }] }), ['d'], 'a pin elsewhere is ignored')

// A failed latest job is still the end; a stopped one is not.
const failed = indexTasks([t('r'), t('ok', ['r']), t('bad', ['r'], { state: 'failed' }), t('off', ['r'], { state: 'stopped' })])
assert.deepEqual(forwardPath(failed, 'r'), ['r', 'bad'])
assert.equal(branches(failed, 'r', new Set(['r', 'bad'])).length, 2)
assert.deepEqual(forwardPath(indexTasks([t('r2'), t('s', ['r2'], { state: 'stopped' })]), 'r2'), ['r2'])

// Diamond: drawn once.
const diamond = indexTasks([t('x'), t('l', ['x']), t('m', ['x']), t('j', ['l', 'm'])])
v = view(diamond, 'j')
assert.equal(v.nodes.filter((n) => n.id === 'x').length, 1)
assert.equal(node(v, 'x').col, -2)

// A card fold hides its inputs and says how many, but keeps what another card still needs.
v = view(ix, 'd', { folded: new Set(['c']) })
assert.deepEqual(ids(v), new Set(['c', 'cal', 'd']))
assert.equal(node(v, 'c').hidden, 2)
v = view(diamond, 'j', { folded: new Set(['l']) })
assert.ok(ids(v).has('x'), 'm still needs x')
assert.equal(node(v, 'l').hidden, 0)
assert.equal(node(v, 'j').foldable, true)
assert.equal(node(view(ix, 'c'), 'f').foldable, false, 'downstream cards have no input side to fold')

// Auto-fold 1: runs of one recipe bundle; a different parameter stays out.
const runs = Array.from({ length: 12 }, (_, i) => t(`run${i}`, [], { recipe: 'reco', params: { run: 101 + i, cut: 2 }, state: i === 3 ? 'failed' : 'done' }))
const merged = indexTasks([...runs, t('odd', [], { recipe: 'reco', params: { run: 500, cut: 3 } }), t('sum', [...runs.map((r) => r.id), 'odd'])])
v = view(merged, 'sum')
const group = v.nodes.find((n) => n.type === 'group')
assert.equal(group.count, 12)
assert.deepEqual(group.runs, [101, 112])
assert.deepEqual(group.states, { done: 11, failed: 1 })
assert.ok(ids(v).has('odd'))
v = view(merged, 'sum', { expanded: new Set([group.id]), maxRows: 99 })
assert.equal(v.nodes.length, 14, 'expanded in place')

// Auto-fold 2: a tall column keeps failures first and folds the rest, with what only they fed.
const wide = Array.from({ length: 9 }, (_, i) => t(`w${i}`, [`src${i}`], { recipe: `r${i}`, state: i === 0 ? 'failed' : 'done' }))
const tall = indexTasks([...wide.map((w, i) => t(`src${i}`)), ...wide, t('top', wide.map((w) => w.id))])
v = view(tall, 'top', { maxRows: 6 })
assert.equal(v.nodes.filter((n) => n.col === -1).length, 6)
assert.ok(ids(v).has('w0'), 'the failure stays')
const more = node(v, 'more:1')
assert.equal(more.count, 8, 'four tasks and their four sources')
assert.equal(v.shown.size, 19 - 8 + 8)
assert.equal(view(tall, 'top', { maxRows: 6, expanded: new Set(['more:1']) }).nodes.filter((n) => n.col === -1).length, 9)

// Auto-fold 3: only when too wide.
const long = indexTasks(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'].map((id, i, all) => t(id, i ? [all[i - 1]] : [])))
assert.equal(view(long, 'p5').nodes.length, 6)
v = view(long, 'p5', { maxUp: 3 })
assert.ok(v.nodes.find((n) => n.type === 'chain'))
assert.ok(Math.max(...v.nodes.map((n) => -n.col)) <= 3)

// Downstream cards name the inputs that were left out.
const side = indexTasks([t('s0'), t('other'), t('s1', ['s0', 'other'])])
assert.equal(node(view(side, 's0'), 's1').extra, 1)

// Bad references are ignored rather than fatal.
assert.deepEqual(view(indexTasks([t('solo', ['gone'])]), 'solo').forward, ['solo'])


// R1: no two cards share a cell, and a link never runs across a card.
{
  const big = indexTasks([t('k0'), t('k1'), t('k2', ['k0']), t('k3', ['k2']), t('k4', ['k3', 'k1']), t('k5', ['k4', 'k0']), t('k6', ['k5'])])
  const vv = view(big, 'k5')
  const L = modulesLayout(vv, { w: 100, h: 30, gap: 20, side: 20 })
  assert.equal(L.cells.size, vv.nodes.length, 'one card per cell')
  assert.equal(L.segs.filter((sg) => sg.arrow).length, vv.edges.length, 'one arrowhead per link')
  assert.ok(L.segs.filter((sg) => sg.arrow).every((sg) => sg.x1 === sg.x2 && sg.y2 > sg.y1), 'arrowheads point down')
  const boxes = Object.values(L.pos)
  for (const sg of L.segs) {
    if (sg.x1 !== sg.x2) continue
    const lo = Math.min(sg.y1, sg.y2), hi = Math.max(sg.y1, sg.y2)
    for (const b of boxes) assert.ok(!(sg.x1 > b.x && sg.x1 < b.x + 100 && lo < b.y + 30 - 1 && hi > b.y + 1), `link through a card at ${b.x},${b.y}`)
  }
  // k0 → k5 skips three ranks: it runs through slots of its own.
  assert.ok(L.segs.filter((sg) => sg.x1 === sg.x2 && Math.abs(sg.y2 - sg.y1) === 30).length >= 3)
}

// A parameter naming the parent job is the edge, not the card's tag.
{
  const plot = { id: 'jobrun-p', recipe: 'plot', inputs: ['jobrun-20261110-220405-219c0f'], params: { scan: '20261110-220405-219c0f' } }
  assert.equal(differing([{ type: 'task', task: plot }]).get('jobrun-p'), '')
}

// Flows: joined jobs together, latest flow first; a project's board takes a flow whole.
{
  const fl = flowsOf([t('o1'), t('o2', ['o1']), t('o3', ['o1']), t('alone'), t('dangling', ['gone'])])
  assert.deepEqual(fl.map((f) => f.tasks.length).sort(), [1, 1, 3])
  assert.equal(fl.find((f) => f.ids.has('o3')).id, 'o1')
  assert.equal(flowName(fl.find((f) => f.ids.has('o3'))), 'o1 → o3')
  assert.equal(flowsOf([t('l1', ['l2']), t('l2', ['l1'])]).length, 1, 'a loop ends')
  assert.deepEqual(withFlows([t('p1'), t('p2', ['p1']), t('q')], (x) => x.id === 'p2').map((x) => x.id).sort(), ['p1', 'p2'])
}

// Assigning uses the tag that names only this project: ELARK would put the job on both.
{
  const ko = { id: 'k', name: 'KO-25-20', tags: ['ELARK', 'KO-25-20'], match: 'or' }
  const st = { id: 's', name: 'STARK', tags: ['STARK', 'ELARK'], match: 'or' }
  const u = { id: 'u', name: 'Other', tags: ['ELARK', 'mine'], match: 'or' }
  assert.deepEqual(tagsFor(ko, [ko, st, u]), ['KO-25-20'])
  assert.deepEqual(tagsFor(u, [ko, st, u]), ['mine'])
  assert.deepEqual(tagsFor({ ...st, match: 'and' }, [st]), ['STARK', 'ELARK'])
}

console.log('ok')
