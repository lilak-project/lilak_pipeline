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
import { projectWears } from 'racklist/tags.js'
import { withFlows } from './graph.js'
import { Ticket } from './Detail.jsx'

/** What a board is, as a label: every job, a project, or a flow (its first job → its last). */
export function BoardLabel({ project, flow, onOpen }) {
  if (project) return <span className="rl-proj">{project.name}</span>
  if (flow) return <FlowTickets f={flow} onOpen={onOpen} />
  return <span className="rl-tag">{tr('board_all')}</span>
}

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

export function BoardBar({ label, picking, onPick, wide, onWide }) {
  return (
    <div className="fb-bbar" data-nofocus>
      <button type="button" className={`fb-bbar-name${picking ? ' on' : ''}`} aria-expanded={picking} title={tr('pick_project')} onClick={onPick}>
        <span className="fb-bbar-text">{label}</span><span aria-hidden="true">▾</span>
      </button>
      <div className="fb-bbar-mid" />
      <button type="button" className="fb-ic" aria-pressed={wide} title={tr(wide ? 'board_narrow' : 'board_wide')}
        aria-label={tr(wide ? 'board_narrow' : 'board_wide')} onClick={onWide}>{wide ? '⤡' : '⤢'}</button>
    </div>
  )
}

export function ProjectPicker({ projects, current, tasks, flows, onChoose, onCreate, onAssign, onOpen }) {
  const [draft, setDraft] = useState('')
  const list = projects || []
  const wears = (p) => (t) => projectWears(p, t.record?.tags)
  // A row chooses its board; a ticket in it opens that job instead.
  const pick = (id) => ({
    role: 'button', tabIndex: 0, onClick: () => onChoose(id),
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onChoose(id) } },
  })
  const row = (id, label, tags, n) => (
    <div key={id} className={`fb-pick${id === current ? ' on' : ''}`} {...pick(id)}>
      <span className="fb-pick-name">{label}</span>
      <span className="fb-pick-tags">{tags.map((t) => `#${t}`).join(' ')}</span>
      <span className="fb-pick-n">{n}</span>
    </div>
  )
  return (
    <div className="fb-picker" data-nofocus>
      <div className="fb-sub">{tr('pick_project')}</div>
      <form className="fb-newproj" onSubmit={async (e) => { e.preventDefault(); if (await onCreate(draft)) setDraft('') }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr('project_new')} aria-label={tr('project_new')} />
        <button type="submit" className="fb-barbtn" disabled={!draft.trim()}>{tr('project_make')}</button>
      </form>
      {row('', <BoardLabel />, [], tasks.length)}
      {flows.map((f) => {
        const on = list.filter((p) => f.tasks.some(wears(p)))
        const free = list.filter((p) => p.tags.length && !on.includes(p))
        const id = `flow:${f.id}`
        return (
          <div key={f.id} className={`fb-flow${id === current ? ' on' : ''}`} {...pick(id)}>
            <span className="fb-pick-name"><FlowTickets f={f} onOpen={onOpen} /></span>
            <span className="fb-pick-tags">{f.tasks.at(-1).record?.date?.slice(5)}</span>
            <span className="fb-pick-n">{f.tasks.length}</span>
            {on.map((p) => (
              <span key={p.id} className="rl-proj fb-flow-proj">{p.name}
                <button type="button" aria-label={tr('flow_remove', p.name)} title={tr('flow_remove', p.name)}
                  onClick={(e) => { e.stopPropagation(); onAssign(f, p, false) }}>✕</button>
              </span>
            ))}
            {free.length > 0 && (
              <select className="fb-flow-add" value="" aria-label={tr('flow_add')} onClick={(e) => e.stopPropagation()}
                onChange={(e) => onAssign(f, free.find((p) => p.id === e.target.value), true)}>
                <option value="">{tr('flow_add')}</option>
                {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        )
      })}
      {list.map((p) => row(p.id, <BoardLabel project={p} />, p.tags, withFlows(tasks, wears(p)).length))}
      <p className="fb-pick-hint">{tr('pick_hint')}</p>
    </div>
  )
}
