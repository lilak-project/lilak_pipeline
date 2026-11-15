/**
 * One job's information above the flow, in five tabs:
 *   history    the flow that led here: every earlier job, oldest first, then this one
 *   decision   why it ran: who had a hand in it, goal, reasoning, references
 *   progress   how it ran: when, where, method and command, who, parameters, log end,
 *              and the record's own changes (made, each update: which fields, size ±)
 *   results    what came of it: summary/report, output files (pictures shown), used by
 *   briefing   briefing and suggestions, and comments for the next step
 * What jobrun knows now (log, files, recipe text) is read from its server when the
 * job is shown. Every row is a focus target (left click); a row with more to show
 * opens it on right click / long press, or with its ▸ button.
 */
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { focusAttr, useFocused } from './focus.js'
import { loadJob, fileUrl, loadHistory, approve, confirmAll } from './data.js'
import { approvalOf, AGENT } from './approval.js'
import { Approval } from './Card.jsx'
import RootView from './RootView.jsx'
import Icon from 'lilak-ui/icons.jsx'
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
const ROOTFILE = /\.root$/i
const local = (at) => {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return String(at || '—')
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const kb = (n) => {
  const a = Math.abs(n)
  return a < 1024 ? `${n} B` : a < 1048576 ? `${(n / 1024).toFixed(1)} KB` : a < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`
}
const signed = (d) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${kb(Math.abs(d))}`
const fieldName = (k) => { const t = tr(`jb_f_${k === 'jobId' ? 'job_id' : k}`); return t.startsWith('jb_f_') ? k : t }

/** When the record was made and each change since: which fields, and how much it grew or shrank. */
function Changes({ id, updatedAt }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    loadHistory(id).then((x) => alive && setRows(x || [])).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [id, updatedAt])
  if (!rows) return <Note>{tr('live_loading')}</Note>
  if (!rows.length) return <Note>{tr('ch_none')}</Note>
  return rows.map((e, i) => (
    <Item key={`${e.at}-${i}`} kind="change" id={`${id}:ch:${i}`} label={local(e.at)}
      value={<span className="fb-change">
        <span className={`fb-change-kind k-${e.kind}`}>{tr(`ch_${e.kind}`)}</span>
        {e.added.map((k) => <span key={`+${k}`} className="fb-change-f add">+{fieldName(k)}</span>)}
        {e.changed.map((k) => <span key={`~${k}`} className="fb-change-f">{fieldName(k)}</span>)}
        {e.removed.map((k) => <span key={`-${k}`} className="fb-change-f del">−{fieldName(k)}</span>)}
        {e.out != null && <span className={`fb-change-out${e.outDelta > 0 ? ' up' : e.outDelta < 0 ? ' down' : ''}`}
          title={tr('ch_out_hint')}>{tr('ch_out')} {kb(e.out)}{e.outDelta !== e.out ? ` (${signed(e.outDelta)})` : ''}</span>}
        <span className={`fb-change-size${e.delta > 0 ? ' up' : e.delta < 0 ? ' down' : ''}`} title={tr('ch_size_hint')}>
          {kb(e.size)}{e.kind === 'updated' ? ` (${signed(e.delta)})` : ''}
        </span>
      </span>} />
  ))
}

const clock = (s) => String(s || '').replace('T', ' ').slice(0, 19)
function took(a, b) {
  const s = Math.round((new Date(b) - new Date(a)) / 1000)
  if (!a || !b || !(s >= 0)) return ''
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}

/** A comment box that grows with what is typed (no drag handle): one line empty, as many as written. */
export function AutoText({ value, onChange, rows = 1, ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} rows={rows} value={value} onChange={onChange} className="fb-autotext" {...rest} />
}

/** What people and agents said about one output file, newest last, and a line to add to it. */
function FileComments({ file, comments, onAdd }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="fb-fc">
      {comments.map((e) => (
        <div key={e.id} className="fb-fc-row">
          <span className="fb-muted">{(e.author || '').split('@')[0] || '?'}{e.by === 'agent' ? ` · ${tr('by_agent')}` : ''} · {local(e.createdAt)}</span>
          {e.verdict && <b className={`fb-verdict v-${e.verdict}`}>{tr(`v_${e.verdict}`)}</b>}
          <span className="fb-fc-text">{e.text}</span>
        </div>
      ))}
      <form className="fb-fc-add" onSubmit={(ev) => { ev.preventDefault(); if (draft.trim()) { onAdd(draft.trim(), file); setDraft('') } }}>
        <AutoText value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder={tr('fc_placeholder')} aria-label={tr('fc_placeholder')} />
        <button type="submit" className="rl-btn" disabled={!draft.trim()}>{tr('eval_save')}</button>
      </form>
    </div>
  )
}

/** A file's own line of explanation (the record's `files`), or a quiet warning that it has none. */
const FileNote = ({ text, picture }) => (text
  ? <div className="fb-file-note">{text}</div>
  : <div className="fb-file-note none">{tr(picture ? 'fig_no_note' : 'file_no_note')}</div>)

function Picture({ jobId, name, no, note, comments, onComment }) {
  const [url, setUrl] = useState(null)
  const big = useRef(null)   // the picture full size: a click anywhere or Esc closes it
  useEffect(() => {
    let u = null
    fileUrl(jobId, name).then((x) => { u = x; setUrl(x) }).catch(() => setUrl(''))
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [jobId, name])
  return (
    <figure className="fb-pic">
      {url ? <img src={url} alt={name} title={tr('pic_zoom')} style={{ cursor: 'zoom-in' }} onClick={() => big.current?.showModal()} /> : <div className="fb-muted fb-pad">{url === '' ? tr('live_failed', name) : tr('live_loading')}</div>}
      <figcaption className="mono"><span className="fb-fig-name"><span className="fb-fig-no" aria-label={tr('fig_no', no)}>{tr('fig_no', no)}</span>{name}</span>{url && <a className="fb-ic-btn fb-dl" href={url} download={name} data-tip={tr('file_download')} aria-label={tr('file_download')}><Icon name="download" size={15} /></a>}</figcaption>
      {url && (
        <dialog ref={big} className="fb-bigpic" data-nofocus aria-label={name} onClick={() => big.current?.close()}>
          <img src={url} alt={name} />
          <div className="fb-bigpic-name mono">{name}</div>
        </dialog>
      )}
      <FileNote text={note} picture />
      <FileComments file={name} comments={comments} onAdd={onComment} />
    </figure>
  )
}

/** A cut-off name gets its whole self as a (slower) tip; a name that fits needs none. */
function tipIfCut(e) {
  const box = e.currentTarget
  const cut = box.firstElementChild
  if (cut && cut.scrollWidth > cut.clientWidth) { box.dataset.tip = cut.textContent; box.classList.add('fb-tip-slow') }
  else { delete box.dataset.tip }
}

// download: saved under its own name; otherwise opened in a new tab.
const openFile = async (jobId, name, download = false) => {
  const u = await fileUrl(jobId, name)
  const a = Object.assign(document.createElement('a'), download ? { href: u, download: name } : { href: u, target: '_blank', rel: 'noopener' })
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 60000)
}

/** "플랫폼 agent (요청 jungwoo)" — who approved or worked on it, with whom the agent worked for. */
function byLabel(by, requester) {
  const name = by === AGENT ? tr('by_platform') : by === '사람' ? tr('by_person') : by || ''
  return by === AGENT && requester ? tr('by_for', name, requester) : name
}

/** Opens a platform agent's run in the portal (its run list), when the portal knows the message. */
const openRun = (run) => window.parent?.postMessage({ type: 'lilak:agent-run', id: String(run) }, location.origin)
const RunLink = ({ run }) => (run ? <button type="button" className="fb-link" onClick={() => openRun(run)}>{tr('ap_run', run)}</button> : null)

/** The job's approval now, the buttons, and every approve / cancel / agent request so far (newest first). */
function Approvals({ task, onDone, tainted, review, toConfirm }) {
  const r = task.record || {}
  const a = approvalOf(r)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn(); setReason(''); onDone() }
    catch (e) { setErr(tr('save_failed') + ` (${e.message})`) }
    setBusy(false)
  }
  // ponytail: "auto for jobs like this" (make_rule) is off the screen for now; the backend still takes it.
  const act = (action) => run(() => approve(task.id, { action, reason: reason.trim() }))
  const list = [...(r.approvals || [])].reverse()
  const cls = a.approved ? (a.confirmed ? 'person' : 'agent') : a.requested ? 'asked' : ''
  return (
    <>
      <Item kind="field" id={`${task.id}:approval`} label={tr('ap_state')}
        value={<span className={`fb-ap ${cls}`}>
          {a.approved ? tr('ap_ok', a.by === '사람' ? a.last?.who || byLabel(a.by) : byLabel(a.by, a.last?.requester)) : a.requested ? tr('ap_requested') : tr('ap_none')}
          {a.approved && a.by !== '사람' && ` · ${tr(a.confirmed ? 'ap_confirmed' : 'ap_unconfirmed')}`}</span>}
        more={<>
          {tainted && !(a.approved && !a.confirmed) && <span className="fb-ap tainted">{tr('ap_tainted')}</span>}
          {review && <span className="fb-ap review">{tr('ap_review')}</span>}
        </>} />
      <form className="fb-eval" onSubmit={(e) => { e.preventDefault(); act('approve') }}>
        <AutoText value={reason} placeholder={tr('ap_reason')} aria-label={tr('ap_reason')} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="rl-btn" disabled={busy}>{tr(a.approved ? 'ap_again' : 'ap_approve')}</button>
        {a.approved && !a.confirmed && <button type="button" className="rl-btn" disabled={busy} onClick={() => act('confirm')}>{tr('ap_confirm')}</button>}
        {a.approved && <button type="button" className="rl-btn" disabled={busy} onClick={() => act('revoke')}>{tr('ap_revoke')}</button>}
      </form>
      {toConfirm.length > 0 && (
        <div className="fb-callout">
          {tr('ap_up_n', toConfirm.length)}{' '}
          <button type="button" className="rl-btn" disabled={busy} onClick={() => run(() => confirmAll(toConfirm, reason.trim()))}>{tr('ap_up_confirm')}</button>
        </div>
      )}
      {err && <Note>{err}</Note>}
      {list.map((x, i) => (
        <Item key={`${x.at}-${i}`} kind="approval" id={`${task.id}:ap:${i}`} label={local(x.at)}
          value={<span className="fb-change">
            <span className={`fb-change-kind ap-${x.action}`}>{tr(`ap_did_${x.action}`)}</span>
            <span className={`fb-ap ${x.by === '사람' ? 'person' : 'agent'}`}>{x.by === '사람' ? x.who || x.by : byLabel(x.by, x.requester)}</span>
            {x.action !== 'confirm' && <span className="fb-muted">{tr(`ap_mode_${x.mode || 'human'}`)}{x.rule ? ` · ${tr('ap_by_rule')}` : ''}</span>}
            {x.undid && <span className="fb-ap review">{tr('ap_undid', byLabel(x.undid))}</span>}
            <RunLink run={x.run} />
            {x.reason && <span>{x.reason}</span>}
          </span>} />
      ))}
    </>
  )
}

/** The next step's proposal: read, and written here by a person; who wrote it, and when. */
function Briefing({ task, onSave }) {
  const r = task.record || {}
  const [edit, setEdit] = useState(null)   // the draft while editing
  const by = r.briefingBy || (r.briefing && r.agent ? byLabel(r.agent, r.agentRequester) : '')
  const save = async () => { if (await onSave(task.id, edit.trim())) setEdit(null) }
  if (edit !== null) {
    return (
      <form className="fb-eval" onSubmit={(e) => { e.preventDefault(); save() }}>
        <AutoText value={edit} rows={2} autoFocus placeholder={tr('brief_placeholder')} aria-label={tr('f_briefing')} onChange={(e) => setEdit(e.target.value)} />
        <button type="submit" className="rl-btn">{tr('brief_save')}</button>
        <button type="button" className="rl-btn" onClick={() => setEdit(null)}>{tr('brief_cancel')}</button>
      </form>
    )
  }
  return (
    <Item kind="field" id={`${task.id}:briefing`} label={tr('f_briefing')} text
      value={<>
        {String(r.briefing || '').trim() || <span className="fb-muted">{tr('unwritten')}</span>}
        <span className="fb-brief-foot">
          {by && <span className="fb-muted">{tr('brief_by', by, r.briefingAt ? local(r.briefingAt) : '')}</span>}
          <button type="button" className="fb-link" onClick={() => setEdit(r.briefing || '')}>{tr(r.briefing ? 'brief_edit' : 'brief_write')}</button>
        </span>
      </>} />
  )
}

export default function Detail({ task, ix, tab, setTab, name, stateOf, evaluations, mine, actions, no, tainted, review, toConfirm = [] }) {
  const [draft, setDraft] = useState('')
  const [verdict, setVerdict] = useState('')   // good | bad | unsure, or none
  const [rootOpen, setRootOpen] = useState('')  // the .root file drawn open
  const [talkOpen, setTalkOpen] = useState('')  // the file whose comments are open
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
  // Pictures first in their own order (01_, 02_… as the guide asks), then the other files.
  const files = (job?.files || []).filter((f) => f !== 'job.log').sort()
  const notes = r.files && typeof r.files === 'object' ? r.files : {}
  const fileComments = (f) => evaluations.filter((e) => e.file === f)
  const comment = (text, file) => actions.addEval(task.id, text, '', file)
  const overall = evaluations.filter((e) => !e.file)
  const pictures = files.filter((f) => IMAGE.test(f))
  const others = files.filter((f) => !IMAGE.test(f))

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
        <Item kind="field" id={`${task.id}:who`} label={tr('f_who')} value={[r.submitter, byLabel(r.agent, r.agentRequester)].filter(Boolean).join(' · ') || '—'} more={<RunLink run={r.agentRun} />} />
        <Item kind="field" id={`${task.id}:job`} label={tr('f_jobid')} value={r.jobId || task.id} mono />
        <div className="fb-sub">{tr('jb_f_params')}</div>
        {params.length ? params.map(([k, val]) => isJobParam(task, val)
          ? <TaskRow key={k} id={`jobrun-${val}`} name={name} stateOf={stateOf} label={k} />
          : (
          <Item key={k} kind="param" id={`${task.id}:${k}`} label={k} value={String(val)} mono more={<span className="fb-muted">{tr('param_source')}</span>} />
        )) : <Note>{tr('no_params')}</Note>}
        <div className="fb-sub">{tr('f_log')}</div>
        {liveNote ? <Note>{liveNote}</Note> : <pre className="fb-log">{job?.log_tail || '—'}</pre>}
        <div className="fb-sub">{tr('f_changes')}</div>
        <Changes id={task.id} updatedAt={r.updatedAt} />
      </>
    ),
    results: (
      <>
        <div className="fb-sub">{tr('ap_title')}</div>
        <Approvals task={task} onDone={actions.reload} tainted={tainted} review={review} toConfirm={toConfirm} />
        <div className="fb-sub">{tr('tab_results')}</div>
        <Text task={task} k="goal" label={tr('f_goal')} value={r.goal} />
        <Text task={task} k="report" label={tr('f_report')} value={r.report} />
        {/* the pictures under a heading of their own, the other files under theirs */}
        {(liveNote || (job && files.length === 0)) && <div className="fb-sub">{tr('f_files')}</div>}
        {liveNote && <Note>{liveNote}</Note>}
        {job && files.length === 0 && <Note>—</Note>}
        {pictures.length > 0 && <div className="fb-sub">{tr('f_figures', pictures.length)}</div>}
        {pictures.length > 0 && <div className="fb-pics">{pictures.map((f, i) => (
          <Picture key={f} jobId={jobId} name={f} no={i + 1} note={notes[f]} comments={fileComments(f)} onComment={comment} />
        ))}</div>}
        {others.length > 0 && <div className="fb-sub">{tr('f_other_files', others.length)}</div>}
        {others.map((f, i) => {
          const talk = fileComments(f)
          const open = talkOpen === f || rootOpen === f || talk.length > 0
          return (
            <div key={f} className="fb-file" data-focus={focusAttr('artifact', `${task.id}:${f}`, { label: f })}>
              {/* its place among the files, down the left of both its lines */}
              <span className="fb-file-no" aria-label={tr('file_no', i + 1)}>{i + 1}</span>
              <div className="fb-file-body">
              {/* the buttons first, in slots kept for all four (a file without ROOT keeps an empty one, so the
                  names line up); then the name on grey, filling the row and cut at its edge */}
              <div className="fb-file-row">
                <span className="fb-file-acts">
                  {ROOTFILE.test(f)
                    ? <button type="button" className="fb-ic-btn" aria-pressed={rootOpen === f} data-tip={tr('root_view')} aria-label={tr('root_view')}
                      onClick={() => setRootOpen(rootOpen === f ? '' : f)}><Icon name="chart-line" size={15} /></button>
                    : <span className="fb-ic-slot" aria-hidden="true" />}
                  <button type="button" className="fb-ic-btn" aria-pressed={talkOpen === f} data-tip={tr('fc_open')} aria-label={tr('fc_open')}
                    onClick={() => setTalkOpen(talkOpen === f ? '' : f)}><Icon name="chats" size={15} />{talk.length > 0 && <span className="fb-ic-n">{talk.length}</span>}</button>
                  <button type="button" className="fb-ic-btn" data-tip={tr('file_open')} aria-label={tr('file_open')} onClick={() => openFile(jobId, f)}><Icon name="link" size={15} /></button>
                  <button type="button" className="fb-ic-btn" data-tip={tr('file_download')} aria-label={tr('file_download')} onClick={() => openFile(jobId, f, true)}><Icon name="download" size={15} /></button>
                </span>
                <span className="fb-file-name mono" onMouseEnter={tipIfCut}><span className="fb-file-cut">{f}</span></span>
              </div>
              <FileNote text={notes[f]} />
              {rootOpen === f && <RootView jobId={jobId} name={f} />}
              {open && <FileComments file={f} comments={talk} onAdd={comment} />}
              </div>
            </div>
          )
        })}
        <div className="fb-sub">{tr('f_usedby')}</div>
        {kids.length ? kids.map((id) => <TaskRow key={id} id={id} name={name} stateOf={stateOf} label={tr('f_usedby')} />)
          : <Note label={tr('f_usedby')}>{tr('unused')}</Note>}
      </>
    ),
    briefing: (
      <>
        <Briefing task={task} onSave={actions.saveBriefing} />
        <div className="fb-sub">{tr('f_evals')}</div>
        {overall.length === 0 && <Note>{tr('eval_none')}</Note>}
        {overall.map((e) => (
          <Item key={e.id} kind="evaluation" id={e.id} label={`${(e.author || '').split('@')[0] || '?'} · ${e.by === 'agent' ? byLabel(e.agent || tr('by_agent'), e.requester) : tr('by_person')}`}
            value={e.verdict ? <><b className={`fb-verdict v-${e.verdict}`}>{tr(`v_${e.verdict}`)}</b> {e.text}</> : e.text} text more={<span className="fb-muted">{String(e.createdAt || '').replace('T', ' ').slice(0, 16)}</span>} />
        ))}
        <form className="fb-eval" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { actions.addEval(task.id, draft.trim(), verdict); setDraft(''); setVerdict('') } }}>
          <span className="fb-verdicts" role="radiogroup" aria-label={tr('eval_verdict')}>
            {['good', 'bad', 'unsure'].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={verdict === v} className={`fb-verdict v-${v}${verdict === v ? ' on' : ''}`}
                onClick={() => setVerdict(verdict === v ? '' : v)}>{tr(`v_${v}`)}</button>
            ))}
          </span>
          <AutoText value={draft} placeholder={tr('eval_placeholder')} aria-label={tr('eval_placeholder')}
            onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="rl-btn" disabled={!draft.trim()}>{tr('eval_save')}</button>
        </form>
      </>
    ),
  }

  return (
    <div className="fb-detail">
      <div className="fb-detail-head" data-nofocus>
        <span className={`fb-lamp s-${state}`} aria-hidden="true" />
        <span className="fb-detail-title">{r.title || name(task.id)}</span>
        {no && <span className="fb-detail-no" title={tr('job_no_hint')}>{tr('job_no', no)}</span>}
        {/* its own tag (#job/<6hex>, what a note writes as ::<6hex>) first, then the projects and people's tags */}
        {[...(r.tags || []).filter((t) => String(t).startsWith('job/')), ...(r.tags || []).filter((t) => !String(t).startsWith('job/'))]
          .map((t) => <span key={t} className={`fb-detail-tag${String(t).startsWith('job/') ? ' own' : ''}`}>#{t}</span>)}
        <Approval rec={r} id={task.id} />
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
