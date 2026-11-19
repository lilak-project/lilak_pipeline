/**
 * The report's evidence check (reference decision, 2026-11-18/19):
 * - a sentence with a number in it needs evidence: one or more [@citeKey] markers,
 *   each a reference the job links in its `evidence` (cite key of the record, a part's too);
 * - an agent's evidence may be used, but the report shows "agent proposed" beside it;
 * - the tally: of the sentences that need evidence, how many have none / rest on an
 *   agent's proposal / on checked / on approved evidence.
 * Pure: the screen (Detail.jsx) draws it, graph.check.mjs tests it.
 */
export const MARK = /\[@([^\]\s]+)\]/g
const JOB = /::[0-9a-f]{6}\b/g

/** The report cut into sentences: at . ! ? 。 followed by a space, and at line ends. */
export const sentences = (text) => String(text || '').split(/(?<=[.!?。])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

/** Whether a sentence states a number (markers and job tickets aside). */
export const needsEvidence = (s) => /\d/.test(s.replace(MARK, '').replace(JOB, ''))

/**
 * keys: Map citeKey → state ('agent' | 'person' | 'approved' | 'refuted' | 'corrected' | 'unverifiable').
 * Returns { rows: [{ text, needs, keys: [{ key, state }], missing }], counts: { need, none, agent, checked, approved, unknown } }.
 */
export function checkReport(text, keys) {
  const counts = { need: 0, none: 0, agent: 0, checked: 0, approved: 0, unknown: 0 }
  const rows = sentences(text).map((s) => {
    const marks = [...s.matchAll(MARK)].map((m) => ({ key: m[1], state: keys.get(m[1]) || 'unknown' }))
    const usable = marks.filter((m) => ['agent', 'person', 'approved'].includes(m.state))
    const needs = needsEvidence(s)
    counts.unknown += marks.filter((m) => m.state === 'unknown').length
    if (needs) {
      counts.need += 1
      if (!usable.length) counts.none += 1
      else if (usable.some((m) => m.state === 'agent')) counts.agent += 1      // leans on an agent's word somewhere
      else if (usable.every((m) => m.state === 'approved')) counts.approved += 1
      else counts.checked += 1
    }
    return { text: s, needs, keys: marks, missing: needs && !usable.length }
  })
  return { rows, counts }
}
