/**
 * The line above the flow: the board's label on the left (all jobs, a project, a flow),
 * room for the board's controls in the middle, the wide view on the right — and the
 * project board, where a board is chosen and flows are put on projects.
 * The projects are project_manager's; a job is on a project's board if it wears
 * that project's tags (racklist projectWears) or shares a flow with one that does.
 * Labels are the rack's own: a project is .rl-proj, a job a ticket.
 */
import { useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import Select from 'lilak-ui/components/Select.jsx'
import { projectWears } from 'racklist/tags.js'
import { projectTree, withFlows } from './graph.js'
import { Ticket } from './Detail.jsx'

/** What a board is, as a label: a project, or a flow (its first job → its last). */
export function BoardLabel({ project, flow, onOpen }) {
  if (flow) return <FlowTickets f={flow} onOpen={onOpen} />
  return <span className="rl-proj">{project?.name || tr('pick_project')}</span>
}

/** A flow's two ends as tickets. */
function FlowTickets({ f, onOpen }) {
  const ends = f.tasks.length > 1 ? [f.tasks[0], f.tasks.at(-1)] : f.tasks
  return (
    <span className="fb-flow-tickets">
      {ends.map((t, i) => (
        <span key={t.id} className="fb-flow-tickets">
          {i > 0 && <span className="fb-flow-arrow" aria-hidden="true">→</span>}
          {onOpen
            ? <button type="button" className="fb-ticket-btn" title={tr('job_open')}
              onClick={(e) => { e.stopPropagation(); onOpen(t.id) }}><Ticket id={t.id} name={t.recipe} /></button>
            : <Ticket id={t.id} name={t.recipe} />}
        </span>
      ))}
    </span>
  )
}

export const ZOOMS = [1, 0.75, 0.5, 0.35]

export function BoardBar({ label, picking, onPick, wide, onWide, zoom = 1, onZoom }) {
  const i = ZOOMS.indexOf(zoom)
  return (
    <div className="fb-bbar" data-nofocus>
      <button type="button" className={`fb-bbar-name${picking ? ' on' : ''}`} aria-pressed={picking} title={tr('pick_project')} onClick={onPick}>
        <span className="fb-bbar-text">{label}</span><span aria-hidden="true">▾</span>
      </button>
      <div className="fb-bbar-mid" />
      {wide && onZoom && <>
        <button type="button" className="fb-bbar-wide" title={tr('zoom_out')} aria-label={tr('zoom_out')} disabled={i === ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[i + 1])}>−</button>
        <button type="button" className="fb-bbar-wide" title={tr('zoom_reset')} onClick={() => onZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="fb-bbar-wide" title={tr('zoom_in')} aria-label={tr('zoom_in')} disabled={i === 0} onClick={() => onZoom(ZOOMS[i - 1])}>+</button>
      </>}
      <button type="button" className="fb-bbar-wide" aria-pressed={wide} onClick={onWide}>{tr(wide ? 'board_narrow' : 'board_wide')}</button>
    </div>
  )
}

export function ProjectPicker({ projects, current, tasks, flows, onChoose, onCreate, onAssign, onOpen }) {
  const [draft, setDraft] = useState('')
  const [under, setUnder] = useState('')   // the project a new one goes under ('' = top)
  const list = projects || []
  const tree = projectTree(list)
  const wears = (p) => (t) => projectWears(p, t.record?.tags)
  // The project shown open: the board's, or the one whose flow is the board.
  const [open, setOpen] = useState(() => list.find((p) => p.id === current
    || flows.some((f) => `flow:${f.id}` === current && f.tasks.some(wears(p))))?.id || '')
  // A row chooses its board; a ticket in it opens that job instead.
  const pick = (id, then) => ({
    role: 'button', tabIndex: 0, onClick: () => { onChoose(id); then?.() },
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onChoose(id); then?.() } },
  })
  // One job of the open project, latest first: it opens the job. The project chips act on its
  // whole flow, which is what a board shows.
  const jobRow = (t) => {
    const f = flows.find((x) => x.ids.has(t.id)) || { id: t.id, tasks: [t], ids: new Set([t.id]) }
    const on = list.filter((p) => f.tasks.some(wears(p)))
    const free = list.filter((p) => p.tags.length && !on.includes(p))
    const open1 = () => onOpen(t.id)
    return (
      <div key={t.id} className="fb-flow" role="button" tabIndex={0} title={tr('job_open')} onClick={open1}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open1() } }}>
        <span className="fb-pick-name"><Ticket id={t.id} name={t.recipe} /></span>
        <span className={`fb-state s-${t.state}`}>{tr(`state_${t.state}`)}</span>
        <span className="fb-pick-tags">{t.record?.date?.slice(5)} {t.record?.time || ''}</span>
        {on.map((p) => (
          <span key={p.id} className="rl-proj fb-flow-proj">{p.name}
            <button type="button" aria-label={tr('flow_remove', p.name)} title={tr('flow_remove', p.name)}
              onClick={(e) => { e.stopPropagation(); onAssign(f, p, false) }}>✕</button>
          </span>
        ))}
        {free.length > 0 && (
          // Its list sits inside the row: a pick there must not also open the job.
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Select className="rl-btn rl-pick fb-flow-add" value="" aria-label={tr('flow_add')}
              onChange={(e) => onAssign(f, free.find((p) => p.id === e.target.value), true)}>
              <option value="">{tr('flow_add')}</option>
              {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="fb-picker" data-nofocus>
      <div className="fb-sub">{tr('pick_project')}</div>
      <form className="fb-newproj" onSubmit={async (e) => { e.preventDefault(); if (await onCreate(draft, under)) { setDraft(''); setUnder('') } }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr('project_new')} aria-label={tr('project_new')} />
        <Select className="rl-btn rl-pick" value={under} onChange={(e) => setUnder(e.target.value)} aria-label={tr('project_under')} title={tr('project_under')}>
          <option value="">{tr('project_top')}</option>
          {tree.map(({ p, depth }) => <option key={p.id} value={p.id}>{`${'  '.repeat(depth)}${p.name}`}</option>)}
        </Select>
        <button type="submit" className="fb-barbtn" disabled={!draft.trim()}>{tr(under ? 'project_make_sub' : 'project_make')}</button>
      </form>
      {tree.map(({ p, depth }) => {
        const mine = withFlows(tasks, wears(p)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        const isOpen = open === p.id
        return (
          <div key={p.id}>
            <div className={`fb-pick${p.id === current ? ' on' : ''}`} aria-expanded={isOpen} style={{ paddingLeft: 10 + depth * 18 }}
              {...pick(p.id, () => setOpen((o) => (o === p.id ? '' : p.id)))}>
              <span className="fb-pick-open" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              <span className="fb-pick-name"><BoardLabel project={p} /></span>
              <span className="fb-pick-tags">{p.tags.map((t) => `#${t}`).join(' ')}</span>
              <span className="fb-pick-n">{mine.length}</span>
              <button type="button" className="fb-pick-sub" title={tr('project_sub_of', p.name)} aria-label={tr('project_sub_of', p.name)}
                onClick={(e) => { e.stopPropagation(); setUnder(p.id); e.currentTarget.closest('.fb-picker')?.querySelector('.fb-newproj input')?.focus() }}>+</button>
            </div>
            {isOpen && (mine.length ? mine.map(jobRow) : <p className="fb-pick-hint">{tr('board_empty')}</p>)}
          </div>
        )
      })}
      <p className="fb-pick-hint">{tr('pick_hint')}</p>
    </div>
  )
}
