/**
 * The places of sources that were cited more than once, from `evidence_log` (evidence_api.py):
 * the ones a person said "not now" to (declines, when it will ask again, or never) with
 * "make it a part now", and every promotion made (what, when, who, how many links moved).
 * It also shows the place rule at work: one place written two ways would stand as two lines here.
 */
import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { remoteDocOf } from 'racklist/portal.js'
import { slug } from '../../../../lilak_rack/reference_manager/src-lilak/paper.js'

const placeKey = (e) => `${e.svc}/${e.proj}/${e.id}/${e.place || ''}`
const countAt = (jobs, x) => jobs.reduce((n, t) => n + (t.record?.evidence || [])
  .filter((e) => e && placeKey(e) === `${x.svc}/${x.proj}/${x.ref}/${x.place}`).length, 0)
const day = (at) => String(at || '').replace('T', ' ').slice(0, 16)

export default function EvidenceLog({ log = [], jobs = [], onPromote }) {
  const [keys, setKeys] = useState({})   // `${proj}/${id}` → cite key, for the sources named here
  const [busy, setBusy] = useState('')
  const projs = [...new Set(log.map((x) => x.proj))].join(',')
  useEffect(() => {
    let alive = true
    Promise.all(projs.split(',').filter(Boolean).map((p) => remoteDocOf('reference_manager', p)
      .then((d) => (d?.references || []).map((r) => [`${p}/${r.id}`, r.citeKey || r.title || r.id])).catch(() => [])))
      .then((all) => alive && setKeys(Object.fromEntries(all.flat())))
    return () => { alive = false }
  }, [projs])

  const declined = log.filter((x) => x.declines > 0)
  const promoted = log.flatMap((x) => (x.promoted || []).map((p) => ({ ...p, x }))).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const name = (x) => keys[`${x.proj}/${x.ref}`] || x.ref
  const now = async (x) => {
    setBusy(x.id)
    await onPromote({ svc: x.svc, proj: x.proj, id: x.ref, place: x.place, title: x.place, citeKey: `${name(x)}/${slug(x.place)}` })
    setBusy('')
  }

  return (
    <div className="fb-evlog">
      <div className="fb-sub">{tr('evl_declined')}</div>
      {declined.length === 0 && <div className="fb-ev-none fb-muted">{tr('evl_none_declined')}</div>}
      {declined.length > 0 && (
        <table className="fb-evlog-t">
          <thead><tr>
            <th>{tr('evl_source')}</th><th>{tr('evl_place')}</th><th>{tr('evl_count')}</th><th>{tr('evl_declines')}</th>
            <th>{tr('evl_last')}</th><th>{tr('evl_next')}</th><th />
          </tr></thead>
          <tbody>{declined.map((x) => (
            <tr key={x.id}>
              <td className="mono">{name(x)} <span className="fb-muted">{x.proj}</span></td>
              <td>{x.place}</td>
              <td className="num">{countAt(jobs, x)}</td>
              <td className="num">{x.declines}</td>
              <td className="fb-muted">{day(x.lastDeclined?.at)} {x.lastDeclined?.by || ''}</td>
              <td>{x.stop ? tr('evl_never') : x.nextAsk}</td>
              <td><button type="button" className="rl-btn" disabled={!!busy} onClick={() => now(x)}>{tr('evl_now')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="fb-sub">{tr('evl_promoted')}</div>
      {promoted.length === 0 && <div className="fb-ev-none fb-muted">{tr('evl_none_promoted')}</div>}
      {promoted.map((p, i) => (
        <div key={`${p.x.id}-${i}`} className="fb-ev-row">
          <span className="mono">{name(p.x)}</span><span className="fb-ev-place">{p.x.place}</span>
          <span>→ <span className="mono">{p.part}</span>{p.created ? '' : ` ${tr('evl_existing')}`}</span>
          <span className="fb-muted">{tr('evl_moved', p.moved, p.count)}</span>
          <span className="fb-push" /><span className="fb-muted">{day(p.at)} · {p.by}</span>
        </div>
      ))}
    </div>
  )
}
