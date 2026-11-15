/**
 * Drawn into the frame's own bottom line (App portals it there), in place of its hint:
 * the most urgent status, with buttons for what needs a look.
 */
export default function Bar({ lines, onChip }) {
  const top = lines[0]
  const chips = lines.filter((l) => l.go && l !== top)
  return (
    <div className="fb-foot" data-nofocus>
      <span className={`fb-bar-msg k-${top.kind}`} aria-live="polite">{top.text}</span>
      {chips.map((l) => (
        <button key={l.kind} type="button" className={`fb-chip k-${l.kind}`} onClick={() => onChip(l)}>{l.text} →</button>
      ))}
    </div>
  )
}
