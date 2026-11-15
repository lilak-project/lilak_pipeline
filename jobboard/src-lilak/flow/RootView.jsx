/**
 * A .root file from a job's output, drawn in place with JSROOT: its keys to choose from,
 * the first canvas (or histogram) drawn at once; zoom, values and the stats box as ROOT's own.
 * JSROOT is loaded only when a file is opened, so the board itself stays light.
 */
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import Select from 'lilak-ui/components/Select.jsx'
import { fileUrl } from './data.js'

const DRAWABLE = /^(TCanvas|TH[123]|TGraph|TMultiGraph|TProfile|TF[12]|THStack|TEfficiency|TTree)/

export default function RootView({ jobId, name }) {
  const [state, setState] = useState({ keys: null, error: '' })
  const [pick, setPick] = useState('')
  const file = useRef(null)
  const box = useRef(null)
  const lib = useRef(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const jsroot = await import('jsroot')
        lib.current = jsroot
        const u = await fileUrl(jobId, name)
        const blob = await (await fetch(u)).blob()
        URL.revokeObjectURL(u)
        const f = await jsroot.openFile(new File([blob], name))
        file.current = f
        const keys = (f.fKeys || []).filter((k) => DRAWABLE.test(k.fClassName))
          .map((k) => ({ name: `${k.fName};${k.fCycle}`, label: k.fName, cls: k.fClassName }))
        if (!alive) return
        setState({ keys, error: '' })
        const first = keys.find((k) => k.cls === 'TCanvas') || keys[0]
        if (first) setPick(first.name)
      } catch (e) {
        if (alive) setState({ keys: [], error: String(e?.message || e) })
      }
    })()
    return () => { alive = false }
  }, [jobId, name])

  useEffect(() => {
    if (!pick || !file.current || !box.current) return
    let alive = true
    ;(async () => {
      try {
        const obj = await file.current.readObject(pick)
        // JSROOT hides a canvas it measures too small: draw once the box is laid out, then fit it.
        await new Promise((r) => setTimeout(r, 60))
        if (!alive || !box.current) return
        lib.current.cleanup(box.current)
        await lib.current.draw(box.current, obj, '')
        lib.current.resize(box.current)
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: String(e?.message || e) }))
      }
    })()
    return () => { alive = false }
  }, [pick])

  useEffect(() => () => { if (box.current && lib.current) lib.current.cleanup(box.current) }, [])

  if (state.error) return <div className="fb-root-view fb-muted">{tr('root_failed', state.error)}</div>
  if (!state.keys) return <div className="fb-root-view fb-muted">{tr('live_loading')}</div>
  if (!state.keys.length) return <div className="fb-root-view fb-muted">{tr('root_empty')}</div>
  return (
    <div className="fb-root-view">
      {state.keys.length > 1 && (
        <Select className="rl-btn rl-pick" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={tr('root_pick')}>
          {state.keys.map((k) => <option key={k.name} value={k.name}>{k.label} ({k.cls})</option>)}
        </Select>
      )}
      <div ref={box} className="fb-root-draw" />
    </div>
  )
}
