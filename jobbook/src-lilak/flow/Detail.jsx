/**
 * One job's information above the flow, in five tabs:
 *   history    the flow that led here: every earlier job, oldest first, then this one
 *   decision   why it ran: who had a hand in it, goal, reasoning, references
 *   progress   how it ran: when, where, method and command, who, parameters, log end
 *   results    what came of it: summary/report, output files (pictures shown), used by
 *   briefing   briefing and suggestions, and comments for the next step
 * What jobrun knows now (log, files, recipe text) is read from its server when the
 * job is shown. Every row is a focus target (left click); a row with more to show
 * opens it on right click / long press, or with its ▸ button.
 */
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { focusAttr, useFocused } from './focus.js'
import { loadJob, fileUrl } from './data.js'
import { isJobParam } from './graph.js'

export const TABS = ['history', 'decision', 'progress', 'results', 'briefing']

function Item({ kind, id, label, value, more, mono, text }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const focused = useFocused(kind, id)
  useEffect(() => {
    const el = ref.current
    const toggle = () => setOpen((o) => !o)
    el?.addEventListener('fb-detail', toggle)
    return () => el?.removeEventListener('fb-detail', toggle)
  }, [])
  return (
    <div ref={ref} className={`fb-item${focused ? ' focused' : ''}`} data-focus={focusAttr(kind, id, { label: String(label) })}
      data-detail={more ? 'item' : undefined}>
      <span className="fb-item-k">{label}</span>
      <span className={`fb-item-v${mono ? ' mono' : ''}${text ? ' text' : ''}`}>{value}</span>
      {more ? <button type="button" className="fb-more" aria-expanded={open} aria-label={tr('more_info')} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button> : <span />}
      {open && <div className="fb-item-more">{more}</div>}
    </div>
  )
}

/** Written text (goal, report…): kept as written, or a quiet "not yet". */
const Text = ({ task, k, label, value }) => (
  <Item kind="field" id={`${task.id}:${k}`} label={label} text
    value={String(value || '').trim() || <span className="fb-muted">{tr('unwritten')}</span>} />
)

/** A row with nothing to show yet: the same title | value line, the value quiet. */
const Note = ({ label = '', children }) => (
  <div className="fb-item note"><span className="fb-item-k">{label}</span><span className="fb-item-v fb-muted">{children}</span><span /></div>
)

/** A row that is another task: drawn as a link, a left click moves the board (and
 *  this panel) to it. The job on show (`here`) is the same row without the link. */
/** A job as a link: its name on a ticket, its short id on the stub (the end of its job/ tag). */
export function Ticket({ id, name }) {
  const short = id.split('-').pop().slice(-6)
  return (
    <span className="fb-ticket" title={`#job/${short}`}>
      <span className="fb-ticket-in">
        {name && <span className="fb-ticket-name">{name}</span>}
        <span className="fb-ticket-id">{short}</span>
      </span>
    </span>
  )
}

function TaskRow({ id, name, stateOf, label, here }) {
  const focused = useFocused('task', id)
  const what = <Ticket id={id} name={name(id)} />
  return (
    <div className={`fb-item task${focused ? ' focused' : ''}${here ? ' here' : ''}`} data-focus={focusAttr('task', id)}
      data-detail="task" title={here ? undefined : tr('go_hint')}>
      <span className="fb-item-k">{label}</span>
      <span className="fb-item-v">{what}</span>
      <span className="fb-go-arrow" aria-hidden="true">{here ? '' : '→'}</span>
    </div>
  )
}

/** Every job upstream, oldest first: the flow that led to this one. */
function history(ix, id) {
  const seen = new Set()
  const stack = [...(ix.inputs.get(id) || [])]
  while (stack.length) {
    const n = stack.pop()
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(ix.inputs.get(n) || []))
  }
  return [...seen].map((n) => ix.byId.get(n)).sort((a, b) => (a.at || '').localeCompare(b.at || '')).map((t) => t.id)
}

/** Everyone with a hand in the job, each once, with what they did: submitted, wrote it up (agent), evaluated. */
function people(r, evaluations) {
  const who = new Map()
  const add = (name, role) => { if (name) who.set(name, [...new Set([...(who.get(name) || []), role])]) }
  add(r.submitter, tr('role_submit'))
  add(r.agent, tr('role_agent'))
  for (const e of evaluations) add((e.author || '').split('@')[0], tr('role_eval'))
  return [...who].map(([name, roles]) => `${name} (${roles.join(', ')})`).join(' · ')
}

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i
const clock = (s) => String(s || '').replace('T', ' ').slice(0, 19)
function took(a, b) {
  const s = Math.round((new Date(b) - new Date(a)) / 1000)
  if (!a || !b || !(s >= 0)) return ''
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}

function Picture({ jobId, name }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let u = null
    fileUrl(jobId, name).then((x) => { u = x; setUrl(x) }).catch(() => setUrl(''))
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [jobId, name])
  return (
    <figure className="fb-pic">
      {url ? <img src={url} alt={name} /> : <div className="fb-muted fb-pad">{url === '' ? tr('live_failed', name) : tr('live_loading')}</div>}
      <figcaption className="mono">{name}</figcaption>
    </figure>
  )
}

const openFile = async (jobId, name) => {
  const u = await fileUrl(jobId, name)
  const a = Object.assign(document.createElement('a'), { href: u, target: '_blank', rel: 'noopener' })
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 60000)
}

export default function Detail({ task, ix, tab, setTab, name, stateOf, evaluations, mine, actions }) {
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState({ for: null })
  const r = task?.record || {}
  const state = task ? stateOf(task.id) : ''
  const jobId = r.jobId
  useEffect(() => {
    if (!jobId) return undefined
    let alive = true
    setLive({ for: jobId })
    loadJob(jobId).then((j) => alive && setLive({ for: jobId, job: j }))
      .catch((e) => alive && setLive({ for: jobId, error: e.message }))
    return () => { alive = false }
  }, [jobId, state])
  if (!task) return null

  const job = live.for === jobId ? live.job : null
  const liveNote = !jobId ? null : live.error ? tr('live_failed', live.error) : !job ? tr('live_loading') : null
  const params = Object.entries(task.params || {})
  const kids = ix.kids.get(task.id) || []
  const past = history(ix, task.id)
  const fav = (mine?.favorites || []).includes(task.id)
  const rep = mine?.rep === task.id
  const files = (job?.files || []).filter((f) => f !== 'job.log')

  const pages = {
    history: (
      <>
        {past.length === 0 && <Note label={tr('f_earlier')}>{tr('no_history')}</Note>}
        {past.map((id) => <TaskRow key={id} id={id} name={name} stateOf={stateOf} label={[ix.byId.get(id)?.record?.date, ix.byId.get(id)?.record?.time].filter(Boolean).join(' ')} />)}
        <TaskRow id={task.id} name={name} stateOf={stateOf} label={tr('f_this')} here />
      </>
    ),
    decision: (
      <>
        <Item kind="field" id={`${task.id}:people`} label={tr('f_people')} value={people(r, evaluations) || '—'} />
        <Text task={task} k="goal" label={tr('f_goal')} value={r.goal} />
        <Text task={task} k="why" label={tr('f_why')} value={r.why} />
        <Text task={task} k="references" label={tr('f_refs')} value={r.references} />
        {r.note && <Text task={task} k="note" label={tr('f_note')} value={r.note} />}
      </>
    ),
    progress: (
      <>
        <Item kind="field" id={`${task.id}:state`} label={tr('f_state')} value={tr(`state_${state}`)} more={r.error && <span className="mono">{r.error}</span>} />
        {state === 'failed' && <div className="fb-callout">{tr('failed_stop')}</div>}
        <Item kind="field" id={`${task.id}:when`} label={tr('f_time')} value={[r.date, r.time].filter(Boolean).join(' ') || '—'} />
        <Item kind="field" id={`${task.id}:ran`} label={tr('f_ran')}
          value={r.started ? `${clock(r.started)} → ${r.ended ? clock(r.ended) : tr('running_for')}${r.ended ? ` (${took(r.started, r.ended)})` : ''}` : '—'} />
        <Item kind="field" id={`${task.id}:where`} label={tr('f_where')} value={[r.server, r.output].filter(Boolean).join(' · ') || '—'} mono />
        <Item kind="field" id={`${task.id}:method`} label={tr('f_method')} value={job?.recipe_info?.description ? `${task.recipe} — ${job.recipe_info.description}` : task.recipe} text />
        {r.command && <Item kind="field" id={`${task.id}:command`} label={tr('f_command')} value={r.command} mono />}
        <Item kind="field" id={`${task.id}:who`} label={tr('f_who')} value={[r.submitter, r.agent].filter(Boolean).join(' · ') || '—'} />
        <Item kind="field" id={`${task.id}:job`} label={tr('f_jobid')} value={r.jobId || task.id} mono />
        <div className="fb-sub">{tr('jb_f_params')}</div>
        {params.length ? params.map(([k, val]) => isJobParam(task, val)
          ? <TaskRow key={k} id={`jobrun-${val}`} name={name} stateOf={stateOf} label={k} />
          : (
          <Item key={k} kind="param" id={`${task.id}:${k}`} label={k} value={String(val)} mono more={<span className="fb-muted">{tr('param_source')}</span>} />
        )) : <Note>{tr('no_params')}</Note>}
        <div className="fb-sub">{tr('f_log')}</div>
        {liveNote ? <Note>{liveNote}</Note> : <pre className="fb-log">{job?.log_tail || '—'}</pre>}
      </>
    ),
    results: (
      <>
        <Text task={task} k="goal" label={tr('f_goal')} value={r.goal} />
        <Text task={task} k="report" label={tr('f_report')} value={r.report} />
        <div className="fb-sub">{tr('f_files')}</div>
        {liveNote && <Note>{liveNote}</Note>}
        {job && files.length === 0 && <Note>—</Note>}
        <div className="fb-pics">{files.filter((f) => IMAGE.test(f)).map((f) => <Picture key={f} jobId={jobId} name={f} />)}</div>
        {files.filter((f) => !IMAGE.test(f)).map((f) => (
          <Item key={f} kind="artifact" id={`${task.id}:${f}`} label={f} mono
            value={<button type="button" className="fb-link" onClick={() => openFile(jobId, f)}>{tr('file_open')} ↗</button>} />
        ))}
        <div className="fb-sub">{tr('f_usedby')}</div>
        {kids.length ? kids.map((id) => <TaskRow key={id} id={id} name={name} stateOf={stateOf} label={tr('f_usedby')} />)
          : <Note label={tr('f_usedby')}>{tr('unused')}</Note>}
      </>
    ),
    briefing: (
      <>
        <Text task={task} k="briefing" label={tr('f_briefing')} value={r.briefing} />
        <div className="fb-sub">{tr('f_evals')}</div>
        {evaluations.length === 0 && <Note>{tr('eval_none')}</Note>}
        {evaluations.map((e) => (
          <Item key={e.id} kind="evaluation" id={e.id} label={`${(e.author || '').split('@')[0] || '?'} · ${tr(e.by === 'agent' ? 'by_agent' : 'by_person')}`}
            value={e.text} text more={<span className="fb-muted">{String(e.createdAt || '').replace('T', ' ').slice(0, 16)}</span>} />
        ))}
        <form className="fb-eval" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { actions.addEval(task.id, draft.trim()); setDraft('') } }}>
          <textarea value={draft} rows={2} placeholder={tr('eval_placeholder')} aria-label={tr('eval_placeholder')}
            onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" disabled={!draft.trim()}>{tr('eval_save')}</button>
        </form>
      </>
    ),
  }

  return (
    <div className="fb-detail">
      <div className="fb-detail-head" data-nofocus>
        <span className={`fb-lamp s-${state}`} aria-hidden="true" />
        <span className="fb-detail-title">{r.title || name(task.id)}</span>
        <span className="fb-push" />
        <button type="button" className="fb-barbtn" aria-pressed={fav} onClick={() => actions.toggleFav(task.id)}>{tr(fav ? 'fav_remove' : 'fav_add')}</button>
        <button type="button" className="fb-barbtn" aria-pressed={rep} onClick={() => actions.setRep(task.id)}>{tr(rep ? 'rep_is' : 'rep_set')}</button>
      </div>
      <nav className="fb-tabs" data-nofocus>
        {TABS.map((id) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{tr(`tab_${id}`)}</button>)}
      </nav>
      <div className="fb-detail-body">{pages[tab]}</div>
    </div>
  )
}
