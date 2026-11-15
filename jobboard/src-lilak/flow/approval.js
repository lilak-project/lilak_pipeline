/**
 * A job's approval as the board shows it, from its `approvals` list (backend
 * approval_api.py appends to it; nothing is removed). "Agent-approved" marks a job
 * whose standing approval came from an agent, and every job built on one.
 */
import { createContext } from 'react'

export const AGENT = '플랫폼 agent'

/** { approved, by, confirmed, requested, last } — as approval_api.state. */
export function approvalOf(rec) {
  const list = rec?.approvals || []
  let last = null
  let asked = null
  let confirm = null
  for (const a of list) {
    if (a.action === 'approve' || a.action === 'revoke') last = a
    else if (a.action === 'request') asked = a
    else if (a.action === 'confirm') confirm = a
  }
  const approved = last?.action === 'approve'
  const by = approved ? last.by : null
  return {
    approved, by, last,
    confirmed: approved && (by === '사람' || (!!confirm && confirm.at >= last.at)),
    requested: !approved && !!asked && (!last || asked.at > last.at),
  }
}

/** A job and every job it was built from. */
export function upstream(ix, id) {
  const seen = new Set([id])
  const stack = [id]
  while (stack.length) for (const p of ix.inputs.get(stack.pop()) || []) if (!seen.has(p)) { seen.add(p); stack.push(p) }
  return seen
}

/** Ids resting on an approval no person gave or confirmed ("agent 제시" until a person looks): its own, or any job above it. */
export function agentTainted(ix) {
  const own = new Set()
  for (const [id, t] of ix.byId) {
    const a = approvalOf(t.record)
    if (a.approved && !a.confirmed) own.add(id)
  }
  const out = new Set()
  for (const id of ix.byId.keys()) if ([...upstream(ix, id)].some((u) => own.has(u))) out.add(id)
  return out
}

/** A person's word on a job at or after `at`: an approval or a confirm. */
const lookedAt = (rec, at) => (rec?.approvals || []).some((a) => a.by === '사람' && (a.action === 'approve' || a.action === 'confirm') && a.at >= at)

/**
 * Ids to look at again: built on a job whose agent approval a person cancelled,
 * and not approved or confirmed by a person since that cancel.
 */
export function needsReview(ix) {
  const out = new Set()
  for (const [id, t] of ix.byId) {
    const undo = [...(t.record?.approvals || [])].reverse().find((a) => a.action === 'revoke' && a.undid)
    if (!undo) continue
    const stack = [...(ix.kids.get(id) || [])]
    const seen = new Set()
    while (stack.length) {
      const k = stack.pop()
      if (seen.has(k)) continue
      seen.add(k)
      if (!lookedAt(ix.byId.get(k)?.record, undo.at)) out.add(k)
      stack.push(...(ix.kids.get(k) || []))
    }
  }
  return out
}

/** { taint, review: Sets of ids, live: Map id → task as it is now } — the board itself may be frozen. */
export const TaintContext = createContext({ taint: new Set(), review: new Set(), live: new Map() })
