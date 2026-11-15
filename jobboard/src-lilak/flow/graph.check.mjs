// The drawing rules, on made-up tasks: npm run check
import assert from 'node:assert/strict'
import { spineThrough, projectTree, indexTasks, forwardPath, view, branches, differing, flowsOf, flowName, withFlows, tagsFor } from './graph.js'
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
  assert.ok(L.segs.filter((sg) => sg.arrow).every((sg) => sg.y1 === sg.y2 && sg.x2 > sg.x1), 'arrowheads point right')
  const boxes = Object.values(L.pos)
  for (const sg of L.segs) {
    if (sg.y1 !== sg.y2) continue
    const lo = Math.min(sg.x1, sg.x2), hi = Math.max(sg.x1, sg.x2)
    for (const b of boxes) assert.ok(!(sg.y1 > b.y && sg.y1 < b.y + 30 && lo < b.x + 100 - 1 && hi > b.x + 1), `link through a card at ${b.x},${b.y}`)
  }
  // k0 → k5 skips three ranks: it runs through slots of its own.
  assert.ok(L.segs.filter((sg) => sg.y1 === sg.y2 && Math.abs(sg.x2 - sg.x1) === 100).length >= 3)
  // Oldest on the left: every link ends further right than it starts.
  assert.ok(L.segs.filter((sg) => sg.arrow).every((sg) => sg.x2 > sg.x1))
}

// A link that skips columns keeps to its own row where that row is free: one turn, at the end.
{
  const g = indexTasks([t('x0'), t('x1', ['x0']), t('x2', ['x1']), t('x3', ['x2', 'x0']), t('b1', ['x0']), t('b2', ['b1']), t('b3', ['b2'])])
  const L = modulesLayout(view(g, 'x0', { full: true }), { w: 100, h: 30, gap: 20, side: 20 })
  const y = L.pos.x0.y + 15, end = L.pos.x3.x
  const along = L.segs.filter((sg) => sg.y1 === y && sg.y2 === y && sg.x1 >= 100 && sg.x2 <= end)
  assert.ok(along.some((sg) => sg.x2 === end - 10), "x0 → x3 runs along x0's row to the last gap")
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

// Approvals: an agent-only approval marks the job and everything built on it; a person's later approval clears it.
{
  const { agentTainted, approvalOf } = await import('./approval.js')
  const ok = (by, at = '1') => ({ record: { approvals: [{ at, action: 'approve', by }] } })
  const tix = indexTasks([t('p', [], ok('플랫폼 agent')), t('q', ['p']), t('r', [], ok('사람')), t('s', ['r'])])
  assert.deepEqual(agentTainted(tix), new Set(['p', 'q']))
  const back = { approvals: [{ at: '1', action: 'approve', by: '사람' }, { at: '2', action: 'revoke', by: '사람' }, { at: '3', action: 'request', by: '플랫폼 agent' }] }
  assert.deepEqual([approvalOf(back).approved, approvalOf(back).requested], [false, true])
  // A person confirming the agent's approval: no longer "agent 제시".
  const conf = { record: { approvals: [{ at: '1', action: 'approve', by: '플랫폼 agent' }, { at: '2', action: 'confirm', by: '사람' }] } }
  assert.deepEqual(agentTainted(indexTasks([t('p2', [], conf), t('q2', ['p2'])])), new Set())
  // A person cancelling it: what was built on it, not looked at since, needs a second look.
  const { needsReview } = await import('./approval.js')
  const undone = { record: { approvals: [{ at: '1', action: 'approve', by: '플랫폼 agent' }, { at: '2', action: 'revoke', by: '사람', undid: '플랫폼 agent' }] } }
  const rix = indexTasks([t('u', [], undone), t('v', ['u']), t('w', ['v'], ok('사람', '3')), t('x', ['w'])])
  assert.deepEqual(needsReview(rix), new Set(['v', 'x']))
}

// Sub-projects: a tag inside another project's tag sits under it, the nearest parent winning.
{
  const P = (id, tag) => ({ id, name: tag.split('/').pop(), tags: [tag] })
  const tree = projectTree([P('x', 'AToM-X/ihm/scan'), P('a', 'AToM-X'), P('t', 'test'), P('i', 'AToM-X/ihm')])
  assert.deepEqual(tree.map((r) => [r.p.id, r.depth, r.parent?.id || null]),
    [['a', 0, null], ['i', 1, 'a'], ['x', 2, 'i'], ['t', 0, null]])
  const ko = { id: 'k', name: 'KO-25-20', tags: ['ELARK', 'KO-25-20'] }
  assert.deepEqual(projectTree([ko, P('e', 'ELARK')]).map((r) => [r.p.id, r.depth]), [['k', 0], ['e', 0]], 'its own tag, not its first')
}

// The dark line runs through the card looked at: up its first inputs, down to the board's last job.
{
  const sx = indexTasks([t('r'), t('a', ['r']), t('b', ['r']), t('c', ['a', 'b']), t('end', ['c'])])
  const vv = view(sx, 'end', { maxRows: 99 })
  const darkOf = (id) => spineThrough(vv, sx, id).edges.filter((e) => e.spine).map((e) => `${e.from}>${e.to}`).sort()
  assert.deepEqual(darkOf('end'), ['a>c', 'c>end', 'r>a'])
  assert.deepEqual(darkOf('b'), ['b>c', 'c>end', 'r>b'], 'b is the second input of c, yet the line runs through it')
  assert.equal(spineThrough(vv, sx, 'nope'), vv, 'not on the board: drawn as it was')
}

// Wide: the whole flow, every link, nothing folded.
{
  const wx = indexTasks([t('w0'), t('w1', ['w0']), t('w2', ['w0']), t('w3', ['w1', 'w2']), t('w4', ['w3']), t('w5', ['w3']), t('x0')])
  const vv = view(wx, 'w1', { full: true, maxRows: 1, maxUp: 1 })
  assert.deepEqual(new Set(vv.nodes.map((n) => n.id)), new Set(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']), 'siblings and every branch, not the unlinked x0')
  assert.equal(vv.edges.length, 6)
  assert.ok(vv.nodes.every((n) => n.type === 'task'), 'nothing folded')
}

// The job list's lines: one lane per parent, a retry beside its failed job, the rest counted.
{
  const { listGraph } = await import('./graph.js')
  const j = (id, inputs = [], state = 'done') => ({ id, inputs, state })
  // newest first: c2 is the retry of the failed f (submitted later), k a child of both a and f's retry
  const list = [j('k', ['a', 'c2']), j('c2', ['f']), j('x'), j('f', [], 'failed'), j('a'), j('o', ['gone'])]
  const g = listGraph(list)
  assert.deepEqual(g.rows.map((t) => t.id), ['k', 'x', 'c2', 'f', 'a', 'o'], 'the retry sits right above its failed job')
  assert.equal(g.outside.get('o'), 1, 'a parent not in the list is counted')
  const lanes = g.trunks.map((t) => [t.parent, t.lane])
  assert.equal(new Set(g.trunks.filter((t) => t.top <= 3 && t.bot >= 0).map((t) => t.lane)).size, g.trunks.length, `overlapping trunks take their own lanes ${lanes}`)
  const fan = [j('z', ['p1', 'p2', 'p3']), j('p1'), j('p2'), j('p3')]
  const h = listGraph(fan, 2)
  assert.equal(h.trunks.length, 2)
  assert.equal(h.more.get('z'), 1, 'past the lanes, the parent is counted on the child')
}
