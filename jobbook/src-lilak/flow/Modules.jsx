/**
 * A card per task. Each card is a small RACK module: a nameplate (recipe, ⑂, state),
 * then a line each for who submitted it and when; the parameters, a cell each; the goal. Cards sit on
 * a grid — a row per step of the history, oldest on top — and links run between
 * them, bending only in the gaps; a link that skips rows passes through a slot
 * no card is in. Choosing a card moves nothing: only a new root scrolls the board.
 */
import { useContext, useLayoutEffect, useRef } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { FocusContext, focusAttr } from './focus.js'
import { isJobParam } from './graph.js'
import { TaskLine, aggProps, aggLabel, Branches } from './Card.jsx'

const PAD = 14

export default function Modules({ v, L, dims, anchor, stateOf, tags, touch, actions, onInfo, popover, setPopover, branchesOf, pins, me, name }) {
  const scroller = useRef(null)
  const focus = useContext(FocusContext)
  // A new root is a new board: show its selected card.
  useLayoutEffect(() => {
    const box = scroller.current
    const a = box?.querySelector(`[data-card="${CSS.escape(anchor)}"]`)
    if (!a) return
    const b = box.getBoundingClientRect()
    const r = a.getBoundingClientRect()
    box.scrollTo({ left: box.scrollLeft + r.left - b.left - box.clientWidth / 2 + r.width / 2, top: box.scrollTop + r.top - b.top - box.clientHeight / 2 + r.height / 2 })
  }, [v.forward[0]]) // eslint-disable-line react-hooks/exhaustive-deps
  const rover = focus.kind === 'task' && L.pos[focus.id] ? focus.id : anchor
  const top = (id) => PAD + L.pos[id].y
  const at = (t) => [t?.record?.date?.slice(5), t?.record?.time].filter(Boolean).join(' ')
  return (
    <div className="fb-scroll" ref={scroller}>
      <div className="fb-canvas" style={{ width: L.width + 2 * PAD, height: L.height + 2 * PAD }}>
        <svg className="fb-links" width={L.width} height={L.height} style={{ left: PAD, top: PAD }} aria-hidden="true">
          {L.segs.map((g, i) => <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className={g.spine ? 'spine' : ''} />)}
          {L.segs.filter((g) => g.arrow).map((g) => <polygon key={`${g.x2}:${g.y2}`} points={`${g.x2 - 5},${g.y2 - 8} ${g.x2 + 5},${g.y2 - 8} ${g.x2},${g.y2}`} />)}
        </svg>
        {v.nodes.map((n) => {
          const box = { left: PAD + L.pos[n.id].x, top: top(n.id), width: dims.w, height: dims.h }
          if (n.type !== 'task') {
            const label = aggLabel(n)
            return (
              <button key={n.id} {...aggProps(n, actions, 'fb-card', box)}>
                <span className="fb-card-plate" style={{ height: dims.plate }}>{label}</span>
                <span className="fb-card-line">
                  {n.states ? Object.entries(n.states).map(([k, c]) => `${tr(`state_${k}`)} ${c}`).join(' · ') : tr('unfold_auto')}
                </span>
              </button>
            )
          }
          const state = stateOf(n.id)
          // every parameter but the one naming the parent job (the link shows that)
          const params = Object.entries(n.task.params || {}).filter(([, val]) => !isJobParam(n.task, val)).map(([k, val]) => `${k}=${val}`)
          const goal = String(n.task.record?.goal || '').trim()
          const focused = focus.kind === 'task' && focus.id === n.id
          const kind = n.id === anchor ? ' anchor' : n.role === 'forward' ? ' after' : ''
          return (
            <div key={n.id} data-card={n.id} role="button" tabIndex={n.id === rover ? 0 : -1}
              aria-label={`${name(n.id)}, ${tr(`state_${state}`)}`}
              className={`fb-card s-${state}${kind}${focused ? ' focused' : ''}`} style={box}
              data-focus={focusAttr('task', n.id)} data-detail="task">
              <span className="fb-card-plate" style={{ height: dims.plate }}>
                <TaskLine n={n} state={state} tag="" dot={false} name={name(n.id)} focused={focused} touch={touch}
                  actions={actions} onInfo={onInfo} popover={popover} setPopover={setPopover} />
                <span className={`fb-state s-${state}`}>{tr(`state_${state}`)}</span>
              </span>
              <span className="fb-card-line" style={{ height: dims.line }}>
                {n.task.record?.submitter && <span className="fb-who rl-auth" title={tr('f_who')}>{n.task.record.submitter}</span>}
                <span className="fb-dim fb-mono">{at(n.task)}</span>
              </span>
              {params.length
                ? <span className="fb-card-line params" style={{ height: dims.line }}>{params.map((p) => <span key={p} className="fb-param" title={p}>{p}</span>)}</span>
                : <span className="fb-card-line text none" style={{ lineHeight: `${dims.line}px` }}>—</span>}
              <span className={`fb-card-line text goal${goal ? '' : ' none'}`} style={{ lineHeight: `${dims.line}px`, height: 2 * dims.line }} title={goal || undefined}>
                {goal || tr('unwritten')}
              </span>
            </div>
          )
        })}
        {popover && L.pos[popover] && (
          <Branches style={{ left: PAD + L.pos[popover].x, top: top(popover) + dims.h + 4 }}
            list={branchesOf(popover)} stateOf={stateOf} name={name} pins={pins} me={me} actions={actions} />
        )}
      </div>
    </div>
  )
}
