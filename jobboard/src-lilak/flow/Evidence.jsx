/**
 * What a job stands on, as links to reference_manager records: each one is
 * { svc, proj, id, place, why, by, at } on the job's `evidence` list.
 *
 * - The reference is a record id, never a cite key (a key changes with its tags).
 * - The place is spelled the way reference_manager spells it (its own `place()`,
 *   'Fig.3' and '그림 3' → 'Figure 3'), so the same place cited twice is seen as
 *   the same — what a later "make it a part?" will count.
 * - The old free-text `references` stays as it was, shown above as a memo.
 *
 * The references read are the job's share set's (jobboard → job-references).
 */
import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import Select from 'lilak-ui/components/Select.jsx'
import { remoteDocOf, linkProject } from 'racklist/portal.js'
import { place, slug } from '../../../../lilak_rack/reference_manager/src-lilak/paper.js'

const SVC = 'reference_manager'
// Besides the set's own reference project, the main reference list people keep (manage set's `papers`):
// a project sits in one set only, so it cannot join jobboard's; it is read here instead, and skipped
// when this account may not read it. A link keeps its own proj, so it holds wherever the projects sit.
// ponytail: one named project; read the main project from the portal if it ever moves.
const ALSO = ['papers']
const keyOf = (e) => `${e.svc}/${e.proj}/${e.id}/${e.place || ''}`
const refKey = (proj, id) => `${proj}/${id}`

/** One reference as a person reads it: its cite key, else its title. */
const nameOf = (r) => r ? (r.citeKey || r.title || r.id) : ''

const refId = (v) => (v && typeof v === 'object' ? v.id : v) || ''
const placeKey = (e) => `${e.svc}/${e.proj}/${e.id}/${e.place || ''}`

/** How many links, over every job, point at this place of this source (evidence_api.count_place). */
const countAt = (jobs, e) => jobs.reduce((n, t) => n + (t.record?.evidence || [])
  .filter((x) => x && placeKey(x) === placeKey(e)).length, 0)

// Each link has two axes (reference decision 2026-11-18): how far it has been checked, and what it rests on.
// A person moves the state up; an agent's link starts at 'agent' and only a person lifts it (the MCP tool cannot).
export const STATES = ['agent', 'person', 'approved', 'refuted', 'corrected', 'unverifiable']
const NEXT = {   // what a person may do from each state
  agent: ['person', 'refuted', 'unverifiable'],
  person: ['approved', 'refuted', 'unverifiable'],
  approved: ['corrected', 'refuted', 'unverifiable'],
}
export const STRENGTHS = ['measurement', 'literature', 'evaluated', 'calculation', 'assumption', 'default']
/** A link's state: as stored, else what its author implies (an agent's: proposed; a person's: checked). */
export const stateOf = (e) => e.state || (/agent/.test(String(e.by || '')) ? 'agent' : 'person')

export default function Evidence({ task, onSave, jobs = [], log = [], onPromote, onDecline }) {
  const list = Array.isArray(task.record?.evidence) ? task.record.evidence : []
  const proj = linkProject(SVC)
  const [refs, setRefs] = useState(null)       // the reference records, by `proj/id`, each with its proj
  const [pick, setPick] = useState('')         // what is typed in the reference box
  const [at, setAt] = useState('')             // the place, as typed
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [round, setRound] = useState(0)        // bumped after a part is made, to read the references again

  useEffect(() => {
    let alive = true
    const projs = [...new Set([proj, ...ALSO].filter(Boolean))]
    Promise.all(projs.map((p) => remoteDocOf(SVC, p).then((doc) => (doc?.references || []).map((r) => ({ ...r, proj: p })))
      .catch(() => [])))   // a project this account may not read is simply left out
      .then((lists) => { if (alive) setRefs(new Map(lists.flat().map((r) => [refKey(r.proj, r.id), r]))) })
    return () => { alive = false }
  }, [proj, round])

  // The box takes "citeKey — title"; the record is found by the key typed (or the whole line).
  const options = refs ? [...refs.values()] : []
  const lineOf = (r) => `${nameOf(r)} — ${r.title || ''} [${r.proj}]`
  const chosen = options.find((r) => pick && (pick === lineOf(r) || pick === nameOf(r)))
  const add = async (e) => {
    e.preventDefault()
    if (!chosen || busy) return
    setBusy(true)
    const item = { svc: SVC, proj: chosen.proj, id: chosen.id, place: place(at), why: why.trim(), state: 'person' }
    if (!list.some((x) => keyOf(x) === keyOf(item))) {
      if (await onSave(task.id, [...list, item])) { setPick(''); setAt(''); setWhy('') }
    }
    setBusy(false)
  }
  const drop = (i) => onSave(task.id, list.filter((_, j) => j !== i))
  // A step up or aside, kept with who and when (App stamps them); a corrected link stays, and its new one is added beside it.
  const setState = (i, state) => onSave(task.id, list.map((x, j) => (j === i
    ? { ...x, state, states: [...(x.states || []), { state, from: stateOf(x) }] } : x)))
  const setStrength = (i, strength) => onSave(task.id, list.map((x, j) => (j === i ? { ...x, strength } : x)))

  // A place cited again (the 2nd time, then 4th, 8th after each "not now"; never after three) asks to
  // become a part of its source; a place that already has its part asks to point at it instead.
  const askOf = (e) => {
    if (!e.place || e.svc !== SVC) return null
    const r = refs?.get(refKey(e.proj, e.id))
    if (!r || r.type === 'part') return null
    const part = options.find((x) => x.proj === e.proj && x.type === 'part' && refId(x.parent) === e.id && x.locator === e.place)
    const n = countAt(jobs, e)
    const seen = log.find((x) => x.id === `ev:${placeKey(e)}`)
    if (part) return { part, n }
    if (n < 2 || seen?.stop || n < (seen?.nextAsk || 2)) return null
    return { n }
  }
  const promote = async (e) => {
    const parent = refs?.get(refKey(e.proj, e.id))
    setBusy(true)
    const out = await onPromote({ svc: e.svc, proj: e.proj, id: e.id, place: e.place, title: e.place,
      citeKey: `${parent?.citeKey || e.id}/${slug(e.place)}` })
    if (out) setRound((x) => x + 1)
    setBusy(false)
  }
  const decline = async (e) => { setBusy(true); await onDecline({ svc: e.svc, proj: e.proj, id: e.id, place: e.place }); setBusy(false) }
  const open = (e) => window.postMessage({ rackOpen: { svc: e.svc, proj: e.proj, id: e.id, label: nameOf(refs?.get(refKey(e.proj, e.id))) } },
    window.location.origin)

  return (
    <div className="fb-ev">
      {list.length === 0 && <div className="fb-ev-none fb-muted">{tr('ev_none')}</div>}
      {list.map((e, i) => {
        const r = e.svc === SVC ? refs?.get(refKey(e.proj, e.id)) : null
        return (
          <div key={keyOf(e)}>
          <div className="fb-ev-row">
            <button type="button" className="fb-ev-ref" onClick={() => open(e)} data-tip={r?.title || tr('ev_missing')}>
              {r ? nameOf(r) : <span className="fb-muted">{refs ? tr('ev_missing') : '…'}</span>}
            </button>
            <span className="fb-ev-proj">{e.proj}</span>
            {e.place && <span className="fb-ev-place">{e.place}</span>}
            <span className="fb-ev-why">{e.why || <span className="fb-muted">{tr('ev_no_why')}</span>}</span>
            <span className="fb-muted fb-ev-by">{[e.by, String(e.at || '').slice(0, 10)].filter(Boolean).join(' · ')}</span>
            <button type="button" className="fb-ic-btn" data-tip={tr('ev_drop')} aria-label={tr('ev_drop')} onClick={() => drop(i)}>×</button>
            {e.placeWas && <span className="fb-muted fb-ev-was" data-tip={tr('ev_was_hint')}>{tr('ev_was', e.placeWas)}</span>}
          </div>
          <div className="fb-ev-axes">
            <span className={`fb-ev-state s-${stateOf(e)}`}>{tr(`evs_${stateOf(e)}`)}</span>
            {(NEXT[stateOf(e)] || []).map((s) => (
              <button key={s} type="button" className="rl-btn" onClick={() => setState(i, s)}>{tr(`evs_do_${s}`)}</button>
            ))}
            <span className="fb-push" />
            <Select className="rl-btn rl-pick" value={e.strength || ''} aria-label={tr('ev_strength')} onChange={(ev) => setStrength(i, ev.target.value)}>
              <option value="">{tr('ev_strength')}</option>
              {STRENGTHS.map((s) => <option key={s} value={s}>{tr(`evw_${s}`)}</option>)}
            </Select>
          </div>
          {(() => {
            const ask = askOf(e)
            if (!ask) return null
            return (
              <div className="fb-ev-ask">
                <span>{ask.part ? tr('ev_ask_part', ask.part.citeKey || ask.part.locator) : tr('ev_ask_new', ask.n)}</span>
                <button type="button" className="rl-btn" disabled={busy} onClick={() => promote(e)}>{tr(ask.part ? 'ev_use_part' : 'ev_make_part')}</button>
                {!ask.part && <button type="button" className="rl-btn" disabled={busy} onClick={() => decline(e)}>{tr('ev_not_now')}</button>}
              </div>
            )
          })()}
          </div>
        )
      })}
      <form className="fb-ev-add" onSubmit={add}>
        <input list="fb-ev-refs" value={pick} onChange={(e) => setPick(e.target.value)} placeholder={tr('ev_pick')} aria-label={tr('ev_pick')}
          className={pick && !chosen ? 'bad' : undefined} />
        <datalist id="fb-ev-refs">
          {options.map((r) => <option key={refKey(r.proj, r.id)} value={lineOf(r)} />)}
        </datalist>
        <input value={at} onChange={(e) => setAt(e.target.value)} placeholder={tr('ev_place')} aria-label={tr('ev_place')}
          data-tip={at && place(at) !== at.trim() ? place(at) : undefined} className="fb-ev-at" />
        <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={tr('ev_why')} aria-label={tr('ev_why')} className="fb-ev-whyin" />
        <button type="submit" className="rl-btn" disabled={!chosen || busy}>{tr('ev_add')}</button>
      </form>
    </div>
  )
}
