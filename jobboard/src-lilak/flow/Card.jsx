/**
 * A task's inner line, a folded-up node, and the list of branches a card does not draw.
 */
import { tr } from 'lilak-ui/i18n.jsx'
import { useContext } from 'react'
import { focusAttr } from './focus.js'
import { approvalOf, TaintContext } from './approval.js'

/** fold − / +, folded count, inputs not drawn, the name, the differing parameters, ⑂n, ⓘ */
export function TaskLine({ n, state, tag, name, focused, touch, actions, onInfo, popover, setPopover, dot = true }) {
  return (
    <>
      {n.foldable
        ? <button type="button" className="fb-ic" data-keep aria-pressed={n.folded} aria-label={tr(n.folded ? 'unfold' : 'fold')}
          title={tr(n.folded ? 'unfold' : 'fold')} onClick={() => actions.fold(n.id)}>{n.folded ? '+' : '−'}</button>
        : <span className="fb-ic-none" aria-hidden="true" />}
      {dot && <span className={`fb-lamp s-${state}`} aria-hidden="true" />}
      <span className="fb-name" title={n.task.record?.title || name}>{n.task.recipe}</span>
      {tag && <span className="fb-tag">{tag}</span>}
      <Approval rec={n.task.record} id={n.id} />
      {n.folded && n.hidden > 0 && <span className="fb-n" title={tr('hidden', n.hidden)}>{n.hidden}</span>}
      {n.extra > 0 && <span className="fb-n" title={tr('extra', n.extra)}>+{n.extra}</span>}
      {n.forks > 0 && (
        <button type="button" className={`fb-ic fb-forks${n.forksBad ? ' bad' : ''}`} data-keep aria-expanded={popover === n.id}
          title={tr('forks', n.forks)} onClick={() => setPopover(popover === n.id ? null : n.id)}>⑂{n.forks}</button>
      )}
      {touch && focused && <button type="button" className="fb-ic" data-keep aria-label={tr('info')} onClick={() => onInfo(n.id)}>ⓘ</button>}
    </>
  )
}

export function aggLabel(n) {
  if (n.type === 'group') return tr('group', n.count, n.recipe, n.runs ? `${n.runs[0]}–${n.runs[1]}` : '')
  return n.type === 'more' ? tr('more', n.count) : tr('chain', n.count)
}

/** A folded-up node's button props: one click unfolds it in place. */
export function aggProps(n, actions, className = '', style) {
  const label = aggLabel(n)
  const bad = n.type === 'group' && (n.states.failed || n.states.waiting)
  return { type: 'button', 'data-keep': true, 'data-focus': focusAttr(n.type, n.id, { label }), title: tr('unfold_auto'),
    className: `${className} fb-agg${bad ? ' bad' : ''}`, style, onClick: () => actions.expand(n.id) }
}

export function Branches({ list, style, stateOf, name, pins, me, actions }) {
  return (
    <div className="fb-pop" style={style} role="dialog" aria-label={tr('branches')}>
      <div className="fb-pop-plate">{tr('branches')}</div>
      {list.map((b) => {
        const mine = pins.mine.some((p) => p.end === b.end)
        const shared = pins.shared.find((p) => p.end === b.end)
        return (
          <div key={b.kid} className="fb-pop-row" data-focus={focusAttr('task', b.end)} data-keep>
            <span className={`fb-lamp s-${stateOf(b.end)}`} aria-hidden="true" />
            <span className="fb-name">{name(b.end)}</span>
            <span className="fb-dim">{tr(`state_${stateOf(b.end)}`)} · {tr('steps', b.size)}</span>
            <button type="button" onClick={() => actions.view(b.end)}>{tr('b_view')}</button>
            <button type="button" aria-pressed={mine} onClick={() => (mine ? actions.unpin(b.end) : actions.pin(b.end))}>{tr(mine ? 'b_unpin' : 'b_pin')}</button>
            <button type="button" aria-pressed={!!shared} disabled={!me}
              onClick={() => (shared ? actions.unshare(shared) : actions.share(b.end))}>{tr(shared ? 'b_unshare' : 'b_share')}</button>
          </div>
        )
      })}
    </div>
  )
}

/** ✓ a person approved or confirmed, ✓A an agent did (unconfirmed), ? an agent asked; dashed A: built on one; ↻ built on an agent approval a person cancelled. */
export function Approval({ rec, id }) {
  const { taint, review, live } = useContext(TaintContext)
  const a = approvalOf(live.get(id)?.record || rec)
  const mark = a.approved ? (a.confirmed
    ? <span className="fb-ok person" title={tr('ap_by_person')}>✓</span>
    : <span className="fb-ok agent" title={tr('ap_by_agent', a.by)}>✓A</span>)
    : a.requested ? <span className="fb-ok asked" title={tr('ap_requested')}>?</span> : null
  const inherited = !(a.approved && !a.confirmed) && taint.has(id)
  return (
    <>
      {mark}
      {inherited && <span className="fb-ok tainted" title={tr('ap_tainted')}>A</span>}
      {review.has(id) && <span className="fb-ok review" title={tr('ap_review')}>↻</span>}
    </>
  )
}
