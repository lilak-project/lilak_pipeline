// Made-up tasks for `?demo=1` — the shape of a STARK analysis, not its data.
let clock = 0
const at = () => `20261110${String(80000 + (clock++) * 300).padStart(6, '0')}`
const task = (id, recipe, inputs = [], params = {}, state = 'done') => ({ id, recipe, inputs, params, state, at: at(), record: { title: `${recipe} ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ')}`.trim() } })

const runs = Array.from({ length: 12 }, (_, i) => task(`unpack-${101 + i}`, 'unpack', [], { run: 101 + i, format: 'mfm' }, i === 6 ? 'failed' : 'done'))
const okRuns = runs.filter((r) => r.state === 'done').map((r) => r.id)

export const SAMPLE = [
  ...runs,
  task('gain', 'gain-fit', [], { source: '3alpha' }),
  task('lise', 'eloss-table', [], { tool: 'LISE++' }),
  task('merge', 'merge', okRuns),
  task('calib', 'calibrate', ['merge', 'gain', 'lise'], { gain: 'v2' }),
  task('build', 'event-build', ['calib'], { window: 200 }),
  task('pid-a', 'pid', ['build'], { cut: 3.0 }),
  task('pid-b', 'pid', ['build'], { cut: 2.0 }),
  task('ang-a', 'angdist', ['pid-a'], { bins: 40 }),
  task('pid-c', 'pid', ['build'], { cut: 1.5 }, 'failed'),
  task('target', 'target-check', [], {}, 'waiting'),
  task('ang-b', 'angdist', ['pid-b'], { bins: 40 }),
  task('xs-a', 'cross-section', ['ang-a', 'lise'], { norm: 'beam' }),
  task('ang-b2', 'angdist', ['pid-b'], { bins: 60 }, 'running'),
]
