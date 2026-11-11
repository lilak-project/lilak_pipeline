/**
 * Drawn into the frame's own bottom line (App portals it there), in place of its hint.
 * Shut: the most urgent status, with buttons for what needs a look. Esc (nothing else
 * open) marks it; Enter or a click opens the message field. Open: the whole line is the
 * message field (find and the bin step aside), and the conversation lies over the board
 * just above it — nothing moves. What you point at rides with the message unless you
 * drop it; ⤢ shows all of the conversation.
 */
import { useEffect, useRef, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

export default function Bar({ lines, onChip, bar, setBar, btnRef, messages, onSend, focusText, focusPath }) {
  const [draft, setDraft] = useState('')
  const [withFocus, setWithFocus] = useState(true)
  const field = useRef(null)
  const list = useRef(null)
  const top = lines[0]
  const chips = lines.filter((l) => l.go && l !== top)

  useEffect(() => { if (bar.open) { setWithFocus(true); requestAnimationFrame(() => field.current?.focus()) } }, [bar.open])
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight }, [messages, bar.level, bar.open])

  const close = () => setBar((b) => ({ ...b, open: false, level: 'partial' }))
  const key = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return // finishing a Hangul syllable
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      if (bar.level === 'full') setBar((b) => ({ ...b, level: 'partial' }))
      else close()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (draft.trim()) { onSend(draft.trim(), withFocus); setDraft('') }
    }
  }

  if (!bar.open) {
    return (
      <div className={`fb-foot${bar.armed ? ' armed' : ''}`} data-nofocus>
        <button type="button" ref={btnRef} className={`fb-bar-msg k-${top.kind}`} aria-live="polite"
          onBlur={() => setBar((b) => ({ ...b, armed: false }))}
          onClick={() => setBar((b) => ({ ...b, open: true, armed: false }))} title={tr('bar_hint')}>
          {bar.armed ? tr('bar_armed') : top.text}
        </button>
        {chips.map((l) => (
          <button key={l.kind} type="button" className={`fb-chip k-${l.kind}`} onClick={() => onChip(l)}>{l.text} →</button>
        ))}
      </div>
    )
  }

  const shown = bar.level === 'full' ? messages : messages.slice(-4)
  return (
    <div className="fb-foot open" data-nofocus>
      <div className={`fb-chat ${bar.level}`} ref={list} aria-live="polite">
        {shown.length === 0 && <div className="fb-muted">{tr('chat_empty')}</div>}
        {shown.map((m) => <div key={m.id} className={`fb-msg ${m.role}`}>{m.text}</div>)}
      </div>
      <div className="fb-compose">
        {withFocus
          ? <button type="button" className="fb-focus-chip" title={tr('drop_focus')} onClick={() => setWithFocus(false)}>@ {focusPath} ✕</button>
          : <button type="button" className="fb-focus-chip off" onClick={() => setWithFocus(true)}>@ {focusText}?</button>}
        <textarea ref={field} rows={1} value={draft} placeholder={tr('bar_placeholder')} aria-label={tr('bar_placeholder')}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={key} />
        <button type="button" className="fb-chip" onClick={() => setBar((b) => ({ ...b, level: b.level === 'full' ? 'partial' : 'full' }))}
          aria-label={tr(bar.level === 'full' ? 'chat_collapse' : 'chat_expand')}>{bar.level === 'full' ? '⤡' : '⤢'}</button>
        <button type="button" className="fb-chip" onClick={close} aria-label={tr('chat_close')}>✕</button>
      </div>
    </div>
  )
}
