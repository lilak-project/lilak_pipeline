/**
 * The left side of the flow tab while the flow drawing is folded away: choose a project,
 * then one of its sub-projects (or all of it), and its jobs below, numbered in the order they
 * were submitted (#1 the first) and listed newest first. A click opens the job on the right.
 * The list folds to a strip; open, its right edge is dragged to set its width (remembered).
 */
import { useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import Select from 'lilak-ui/components/Select.jsx'
import { projectWears } from 'racklist/tags.js'
import { projectTree, listGraph } from './graph.js'
import * as data from './data.js'

const MIN = 220
const LANES = 6, LW = 8   // the lines' column: up to LANES lanes LW apart, as wide as the lanes this list uses

/** One row's slice of the lines: each trunk passing it, its stub into the row, a dot where it meets. */
function Lines({ i, trunks, rowOf, anchor, GW }) {
  const a = rowOf.get(anchor)
  const cut = []
  let dot = false, hot = false
  for (const t of trunks) {
    if (i < t.top || i > t.bot) continue
    const x = GW - 6 - t.lane * LW
    const mine = t.parent === anchor
    const kid = !mine && t.kids.includes(anchor)
    const lo = Math.min(a ?? -1, rowOf.get(t.parent)), hi = Math.max(a ?? -1, rowOf.get(t.parent))
    const dark = mine || (kid && i >= lo && i <= hi)
    const cls = dark ? 'on' : ''
    cut.push(<line key={`v${t.parent}`} className={cls} x1={x} x2={x} y1={i === t.top ? '50%' : '0%'} y2={i === t.bot ? '50%' : '100%'} />)
    if (t.members.has(i)) {
      const stubDark = mine || (kid && (i === a || i === rowOf.get(t.parent)))
      cut.push(<line key={`h${t.parent}`} className={stubDark ? 'on' : ''} x1={x} x2={GW} y1="50%" y2="50%" />)
      dot = true
      hot ||= stubDark
    }
  }
  return (
    <svg className="fb-list-lines" width={GW} aria-hidden="true">
      {cut}
      {dot && <circle className={hot ? 'on' : ''} cx={GW - 2} cy="50%" r="2.5" />}
    </svg>
  )
}

/** {job id: its number in the project}: #1 the first submitted, stable as new jobs come. */
export function jobNumbers(project, tasks) {
  const mine = project ? (tasks || []).filter((t) => projectWears(project, t.record?.tags)) : []
  return new Map([...mine].sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).map((t, i) => [t.id, i + 1]))
}

export default function JobList({ projects, project, tasks, anchor, stateOf, onChoose, onOpen, onManage, managing, onEvidence, evOpen }) {
  const [open, setOpen] = useState(data.listOpen)
  const [width, setWidth] = useState(data.listWidth)
  const box = useRef(null)
  const tree = projectTree(projects || [])
  const parent = new Map(tree.map((x) => [x.p.id, x.parent]))
  const rootOf = (p) => { let q = p; while (q && parent.get(q.id)) q = parent.get(q.id); return q }
  const top = rootOf(project)
  const subs = tree.filter((x) => x.depth > 0 && rootOf(x.p)?.id === top?.id)
  const fold = (v) => { setOpen(v); data.saveListOpen(v) }

  // Numbers follow submission (stable as new jobs come); the list shows the newest first.
  const no = jobNumbers(project, tasks)
  const listed = (tasks || []).filter((t) => no.has(t.id)).sort((a, b) => no.get(b.id) - no.get(a.id))
  // Lines from each parent to its children (inputs); a failed job's retry is moved beside it.
  const { rows, trunks, more, outside } = listGraph(listed, LANES)
  // only the lanes in use: no empty column when the list has few or no lines
  const GW = trunks.length ? Math.max(...trunks.map((t) => t.lane + 1)) * LW + 6 : 0
  const rowOf = new Map(rows.map((t, i) => [t.id, i]))

  const drag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const left = box.current.getBoundingClientRect().left
    const max = () => Math.max(MIN, (box.current.parentElement?.clientWidth || 1200) * 0.7)
    let w = width
    const move = (ev) => { w = Math.round(Math.min(max(), Math.max(MIN, ev.clientX - left))); setWidth(w) }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); data.saveListWidth(w) }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  if (!open) {
    return (
      <section className="fb-list folded" data-nofocus>
        <button type="button" className="fb-list-fold" title={tr('list_open')} aria-label={tr('list_open')} onClick={() => fold(true)}>›</button>
      </section>
    )
  }
  return (
    <section className="fb-list" ref={box} style={{ width }} data-nofocus>
      <div className="fb-bbar">
        <Select className="rl-btn rl-pick fb-list-pick" value={top?.id || ''} aria-label={tr('list_project')} onChange={(e) => onChoose(e.target.value)}>
          {tree.filter((x) => x.depth === 0).map(({ p }) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <div className="fb-bbar-mid" />
        <button type="button" className={`fb-bbar-wide${evOpen ? ' on' : ''}`} aria-pressed={evOpen} onClick={onEvidence} title={tr('evl_hint')}>{tr('evl_title')}</button>
        <button type="button" className={`fb-bbar-wide${managing ? ' on' : ''}`} aria-pressed={managing} onClick={onManage}>{tr('list_manage')}</button>
        <button type="button" className="fb-bbar-wide" title={tr('list_fold')} aria-label={tr('list_fold')} onClick={() => fold(false)}>‹</button>
      </div>
      {subs.length > 0 && (
        <div className="fb-bbar">
          <Select className="rl-btn rl-pick fb-list-pick" value={project?.id === top?.id ? '' : project?.id || ''} aria-label={tr('list_sub')}
            onChange={(e) => onChoose(e.target.value || top.id)}>
            <option value="">{tr('list_all_subs', top?.name || '')}</option>
            {subs.map(({ p, depth }) => <option key={p.id} value={p.id}>{`${'  '.repeat(depth - 1)}${p.name}`}</option>)}
          </Select>
        </div>
      )}
      <div className="fb-list-rows">
        {rows.length === 0 && <p className="fb-pick-hint">{projects ? tr('board_empty') : tr('loading')}</p>}
        {rows.map((t, i) => {
          const state = stateOf(t.id) || t.state
          return (
            <div key={t.id} role="button" tabIndex={0} className={`fb-list-row${t.id === anchor ? ' on' : ''}`} title={t.record?.goal || undefined}
              onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(t.id) } }}>
              <span className="fb-list-no">{no.get(t.id)}</span>
              {GW > 0 && <Lines i={i} trunks={trunks} rowOf={rowOf} anchor={anchor} GW={GW} />}
              {/* the state is the name's colour: green done, red failed, blue running, grey waiting */}
              <span className={`fb-list-name s-${state}`} title={tr(`state_${state}`)}>{t.recipe}</span>
              {outside.get(t.id) > 0 && <span className="fb-list-off" title={tr('list_outside_hint', outside.get(t.id))}>{tr('list_outside', outside.get(t.id))}</span>}
              {more.get(t.id) > 0 && <span className="fb-list-off" title={tr('list_more_hint', more.get(t.id))}>{tr('list_more', more.get(t.id))}</span>}
              <span className="fb-list-at">{t.record?.date?.slice(5) || ''}</span>
            </div>
          )
        })}
      </div>
      <div className="fb-list-grip" role="separator" aria-orientation="vertical" aria-label={tr('list_width')} onPointerDown={drag} />
    </section>
  )
}
