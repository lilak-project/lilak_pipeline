import { createContext, useContext } from 'react'

/** What is focused now, for anything that wants to mark itself. */
export const FocusContext = createContext({ kind: 'board' })
export const useFocused = (kind, id) => {
  const f = useContext(FocusContext)
  return f.kind === kind && String(f.id) === String(id)
}
/** `data-focus` for an element: what a left click tells the agent. */
export const focusAttr = (kind, id, extra = {}) => JSON.stringify({ kind, id, ...extra })

export const nameOf = (task, tag) => (task ? `${task.recipe}${tag ? ` ${tag}` : ''}` : '')
