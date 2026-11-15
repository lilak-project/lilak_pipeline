/**
 * The flow board — jobboard's tab: the analysis flow around one task.
 *
 *   left click   focus (what the agent is told you are looking at); on a task it
 *                also re-centres the board on it: everything upstream, one path down.
 *   layout       the centred job's information above; the flow below, as tall as its
 *                cards need (at most 60 %). Nothing slides.
 *   right click  on a task: open its editor (the frame's). On an item with more: show
 *                more. Elsewhere the browser's menu stays.
 *   touch        tap = left click, long press = right click.
 *   keys         arrows move between cards, Space centres,
 *                Esc closes one layer.
 *
 * Centre and tab live in the URL, so the browser's Back undoes a move.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tr } from 'lilak-ui/i18n.jsx'
import { PORTAL_PROJECT, PORTAL_SERVICE } from 'racklist/portal.js'
import { loadProjects, forgetProjects, projectWears, tagWithin, tagNameOk, uniqueTags } from 'racklist/tags.js'
import './strings.js'
import { indexTasks, view as buildView, branches, differing, neighbour, flowsOf, withFlows, tagsFor, ownTag, spineThrough } from './graph.js'
import { modulesLayout } from './rackLayout.js'
import * as data from './data.js'
import Modules from './Modules.jsx'
import JobList, { jobNumbers } from './JobList.jsx'
import Detail, { TABS } from './Detail.jsx'
import Bar from './Bar.jsx'
import { BoardBar, BoardLabel, ProjectPicker } from './BoardBar.jsx'
import { FocusContext, nameOf } from './focus.js'
import { agentTainted, approvalOf, needsReview, upstream, TaintContext } from './approval.js'

// The flow drawing is folded away for now; the tab's left side is the project's job list. true brings the drawing back.
const FLOW = false

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

// A job opens on what came of it.
const FIRST_TAB = 'results'
function readUrl() {
  const q = new URLSearchParams(location.search)
  return { t: q.get('t') || '', tab: TABS.includes(q.get('tab')) ? q.get('tab') : FIRST_TAB }
}
function writeUrl(n, push) {
  const q = new URLSearchParams(location.search)
  for (const [k, v] of [['t', n.t], ['tab', n.tab === FIRST_TAB ? '' : n.tab]]) v ? q.set(k, v) : q.delete(k)
  const url = `${location.pathname}${q.toString() ? `?${q}` : ''}${location.hash}`
  history[push ? 'pushState' : 'replaceState'](null, '', url)
}

export default function App({ api }) {
  const [live, setLive] = useState(null)        // jobs as they are now
  const [frozen, setFrozen] = useState(null)    // the jobs the drawing is made of; moves only on a user action
  const [sync, setSync] = useState({ ok: true, at: null })
  const [own, setOwn] = useState({ evaluations: [], prefs: [], pins: [], me: '' })
  const [nav, setNav] = useState(readUrl)
  const [focus, setFocus] = useState({ kind: 'board' })
  const [folded, setFolded] = useState(data.localFolded)
  const [expanded, setExpanded] = useState(() => new Set())
  const [popover, setPopover] = useState(null)
  const [seen, setSeen] = useState(data.seenFailed)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [note, setNote] = useState(null)
  const [touch] = useState(coarse)
  const [projects, setProjects] = useState(null) // project_manager's; null until they have come
  const [projectId, setProjectId] = useState(data.boardProject) // whose board this is: a project's id, or flow:<id>
  const [picking, setPicking] = useState(false)
  const [wide, setWide] = useState(false)
  const [root, setRoot] = useState(null) // the job the board is drawn from; choosing a card already on it leaves it
  const [foot, setFoot] = useState(null) // the frame's bottom line, where the bar is drawn
  useEffect(() => setFoot(document.querySelector('.rl-foot')), [])
  const mainRef = useRef(null)
  const lpRef = useRef({ timer: null, fired: false, x: 0, y: 0 })

  useEffect(() => {
    let alive = true
    const pull = () => data.loadTasks()
      .then((tasks) => { if (!alive) return; setLive(tasks); setFrozen((f) => f || tasks); setSync({ ok: true, at: new Date() }) })
      .catch(() => { if (alive) setSync((s) => ({ ...s, ok: false })) })
    pull()
    const t = setInterval(pull, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  useEffect(() => { loadProjects().then(setProjects) }, [])
  const refreshOwn = useCallback(() => data.loadOwn().then(setOwn).catch(() => {}), [])
  useEffect(() => { refreshOwn() }, [refreshOwn])
  useEffect(() => {
    const back = () => setNav(readUrl())
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const r = el.getBoundingClientRect() // now, not when the observer first reports (late in a background tab)
    setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const flash = useCallback((text) => { setNote(text); setTimeout(() => setNote((n) => (n === text ? null : n)), 5000) }, [])

  // This board's jobs: a project's flows, or one flow. A remembered project draws nothing until the list has come, so every job never flashes by.
  const flows = useMemo(() => flowsOf(live || []), [live])
  // Every job is a project's: no project chosen (or one since deleted) is the first project's board.
  const isFlow = projectId.startsWith('flow:')
  const flowPick = isFlow ? flows.find((f) => `flow:${f.id}` === projectId) || null : null
  const project = projects?.find((p) => p.id === projectId) || (flowPick ? null : projects?.[0]) || null
  const onBoard = useCallback((list) => {
    if (!list) return list
    if (flowPick) return list.filter((t) => flowPick.ids.has(t.id))
    return project ? withFlows(list, (t) => projectWears(project, t.record?.tags)) : []
  }, [flowPick, project])
  const boardLive = useMemo(() => onBoard(live), [onBoard, live])
  const boardFrozen = useMemo(() => onBoard(frozen), [onBoard, frozen])
  const ix = useMemo(() => indexTasks(boardFrozen || []), [boardFrozen])
  // Over every job as it is now (the board itself may be frozen), so an approval shows at once.
  const liveIx = useMemo(() => indexTasks(live || []), [live])
  const taint = useMemo(() => agentTainted(liveIx), [liveIx])
  const review = useMemo(() => needsReview(liveIx), [liveIx])
  const liveById = useMemo(() => new Map((boardLive || []).map((t) => [t.id, t])), [boardLive])
  const taintCtx = useMemo(() => ({ taint, review, live: liveById }), [taint, review, liveById])
  const stateOf = useCallback((id) => liveById.get(id)?.state ?? ix.byId.get(id)?.state, [liveById, ix])
  const mine = useMemo(() => own.prefs.find((p) => p.id === own.me) || null, [own])
  const pins = useMemo(() => ({ mine: mine?.pins || [], shared: own.pins.filter((p) => !p.removed) }), [mine, own.pins])
  const byTime = useMemo(() => [...ix.byId.values()].sort((a, b) => (b.at || '').localeCompare(a.at || '')), [ix])
  const anchor = ix.byId.has(nav.t) ? nav.t : (mine?.rep && ix.byId.has(mine.rep) ? mine.rep : byTime[0]?.id)
  // Every approval no person gave or confirmed, at the job open and above it: confirmed at once from the end result.
  const toConfirm = useMemo(() => (anchor && liveIx.byId.has(anchor) ? [...upstream(liveIx, anchor)] : [])
    .filter((id) => { const a = approvalOf(liveIx.byId.get(id)?.record); return a.approved && !a.confirmed }), [liveIx, anchor])

  // A card: a nameplate, four lines (the goal has two) and its border (h); rows `gap` apart, cards in a row `side` apart. A finger gets more.
  const dims = touch ? { w: 240, h: 158, gap: 32, side: 16, plate: 36, line: 30 } : { w: 224, h: 116, gap: 28, side: 16, plate: 26, line: 22 }
  // Left to right: as many cards in a column as the tab is tall, as many columns back as the tab is wide.
  // Narrow, the board is one card wide and scrolls; wide, it takes the tab and folds nothing.
  const maxUp = size.w ? Math.max(2, Math.floor(size.w / (dims.w + dims.gap)) - 1) : Infinity
  // Wide and the project list never meet: the list needs the right side, so opening it
  // narrows the board and widening closes it — the state is always what is drawn.
  const wideNow = wide
  // How far the wide board is zoomed out (1 = cards at full size); narrow is always full size.
  const [zoom, setZoom] = useState(1)
  const maxRows = size.h ? Math.max(2, Math.floor((size.h - 60) / (dims.h + dims.side))) : 6
  const v = useMemo(() => {
    if (!anchor) return null
    const opts = { pins, folded, expanded, maxRows, maxUp, full: wideNow }
    const held = root && ix.byId.has(root) ? buildView(ix, root, opts) : null
    return held && held.nodes.some((n) => n.id === anchor) ? held : buildView(ix, anchor, opts)
  }, [ix, anchor, root, pins, folded, expanded, maxRows, maxUp, wideNow])
  // The dark line runs through the card looked at, not the job the board happens to be drawn from.
  const dark = useMemo(() => (v ? new Set(spineThrough(v, ix, anchor).edges.filter((e) => e.spine).map((e) => `${e.from}>${e.to}`)) : null), [v, ix, anchor])
  const drawnFrom = v?.forward[0]
  useEffect(() => setRoot(drawnFrom), [drawnFrom])
  const L = useMemo(() => (v ? modulesLayout(v, dims, dark) : null), [v, dark, touch]) // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => (v ? differing(v.nodes) : new Map()), [v])
  const name = useCallback((id) => nameOf(ix.byId.get(id), tags.get(id)), [ix, tags])

  const go = useCallback((next, push) => {
    setNav((cur) => {
      // Another job opens on its results, whatever tab the last one was on.
      const n = { ...cur, ...(next.t && next.t !== cur.t && !('tab' in next) ? { tab: FIRST_TAB } : {}), ...next }
      writeUrl(n, push)
      return n
    })
  }, [])
  const center = useCallback((id) => {
    if (!id || id === anchor) return
    setPopover(null)
    if (!document.querySelector(`[data-card="${CSS.escape(id)}"]`)) { // off the board: redraw it around that job
      setExpanded(new Set())
      if (live) setFrozen(live)
    }
    go({ t: id }, true)
  }, [anchor, live, go])
  // The information is always open; a right click on a task opens its editor instead.
  const openDetail = center

  // What a local agent reads back as "this".
  const focusPayload = useMemo(() => { if (!anchor) return anchor; const own = buildView(ix, anchor, { pins }); return {
    v: 1, project: PORTAL_PROJECT, at: new Date().toISOString(), anchor,
    focus: { ...focus, ...(focus.kind === 'task' ? { label: name(focus.id) } : {}) },
    view: { mode: 'board', tab: nav.tab, next: own.forward.slice(1), upstream_count: own.shown.size - own.forward.length },
  } }, [anchor, focus, nav.tab, ix, pins, name])
  useEffect(() => { if (focusPayload) data.sendFocus(focusPayload) }, [focusPayload])

  // ── pointer: one listener each at the root ────────────────────────────────
  const detailFor = (target) => {
    const d = target.closest('[data-detail]')
    if (d) {
      const f = JSON.parse(d.closest('[data-focus]')?.dataset.focus || '{"kind":"board"}')
      setFocus(f)
      if (d.dataset.detail === 'task') (api?.openItem ? api.openItem(f.id) : openDetail(f.id)) // its editor, beside the board
      else d.dispatchEvent(new CustomEvent('fb-detail'))
      return true
    }
    return false
  }
  const onClickCapture = (e) => {
    if (lpRef.current.fired) { lpRef.current.fired = false; e.preventDefault(); e.stopPropagation(); return }
    if (popover && !e.target.closest('.fb-pop, .fb-forks')) setPopover(null)
    if (e.target.closest('[data-nofocus]')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().trim()) return
    const el = e.target.closest('[data-focus]')
    if (!el) { if (!e.target.closest('button, a, input, textarea, select, label')) setFocus({ kind: 'board' }); return }
    const f = JSON.parse(el.dataset.focus)
    setFocus(f)
    if (f.kind === 'task' && !e.target.closest('[data-keep]')) { setPicking(false); center(f.id) }
  }
  const onContextMenu = (e) => {
    const lp = lpRef.current
    if (lp.timer) { clearTimeout(lp.timer); lp.timer = null; lp.fired = true } // Android's own long press got here first
    else if (lp.fired) { e.preventDefault(); return }
    if (e.shiftKey || e.target.closest('input, textarea, select, a[href]')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.containsNode(e.target, true)) return
    if (detailFor(e.target)) e.preventDefault()
  }
  const onPointerDown = (e) => {
    const lp = lpRef.current
    lp.fired = false
    if (e.pointerType === 'mouse') return
    lp.x = e.clientX; lp.y = e.clientY
    const target = e.target
    clearTimeout(lp.timer)
    // iOS Safari never sends contextmenu for a long press, so time it here.
    lp.timer = setTimeout(() => { lp.timer = null; if (detailFor(target)) lp.fired = true }, 500)
  }
  const onPointerMove = (e) => {
    const lp = lpRef.current
    if (lp.timer && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) { clearTimeout(lp.timer); lp.timer = null }
  }
  const onPointerEnd = () => { const lp = lpRef.current; if (lp.timer) { clearTimeout(lp.timer); lp.timer = null } }

  // ── keys ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.keyCode === 229) return
      const el = document.activeElement
      const typing = el && (el.matches('input, textarea, select') || el.isContentEditable)
      if (e.key === 'Escape') {
        if (typing) return // a field closes itself
        e.preventDefault()
        if (popover) setPopover(null)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      const card = el?.closest?.('[data-card]')
      if (card && e.key === ' ') {
        e.preventDefault()
        setFocus({ kind: 'task', id: card.dataset.card })
        setPicking(false)
        center(card.dataset.card)
        return
      }
      if (card && e.key.startsWith('Arrow') && L) {
        e.preventDefault()
        const to = neighbour(L.pos, card.dataset.card, e.key.slice(5).toLowerCase())
        if (to) document.querySelector(`[data-card="${CSS.escape(to)}"]`)?.focus()
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // ── what people decide here ────────────────────────────────────────────────
  const savePrefs = async (patch) => {
    if (!own.me) return flash(tr('need_login'))
    try { await data.putRecord('prefs', { id: own.me, ...patch }, !!mine); await refreshOwn() } catch { flash(tr('save_failed')) }
  }
  const now = () => new Date().toISOString()
  const actions = {
    reload: () => data.loadTasks().then(setLive).catch(() => {}),
    toggleFav: (id) => savePrefs({ favorites: (mine?.favorites || []).includes(id) ? mine.favorites.filter((x) => x !== id) : [...(mine?.favorites || []), id] }),
    setRep: (id) => savePrefs({ rep: mine?.rep === id ? '' : id }),
    pin: (end) => savePrefs({ pins: [...(mine?.pins || []).filter((p) => p.end !== end), { end, at: now() }] }),
    unpin: (end) => savePrefs({ pins: (mine?.pins || []).filter((p) => p.end !== end) }),
    share: async (end) => {
      try { await data.putRecord('pins', { end, by: own.me, at: now() }, false); await refreshOwn() } catch { flash(tr('save_failed')) }
    },
    unshare: async (pin) => { try { await data.removePin(pin.id); await refreshOwn() } catch { flash(tr('save_failed')) } },
    // file: a comment on one picture or file of the job's output; none = on the job as a whole.
    addEval: async (task, text, verdict, file) => {
      try { await data.putRecord('evaluations', { task, text, author: own.me, by: 'person', ...(verdict ? { verdict } : {}), ...(file ? { file } : {}) }, false); await refreshOwn() } catch { flash(tr('save_failed')) }
    },
    // The next step's proposal, by a person here: who wrote it rides along (an agent's comes through update_job).
    saveBriefing: async (task, text) => {
      try {
        await data.putRecord('jobs', { id: task, briefing: text, briefingBy: own.name || String(own.me).split('@')[0] || tr('by_person'), briefingAt: now() }, true)
        await actions.reload()
        return true
      } catch { flash(tr('save_failed')); return false }
    },
    view: (end) => { setFocus({ kind: 'task', id: end }); center(end) },
    fold: (id) => setFolded((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); data.saveFolded(n); return n }),
    expand: (id) => setExpanded((x) => new Set([...x, id])),
  }

  // ── the bottom line: the most urgent thing, and buttons for the rest ─────────
  const all = boardLive || []
  const latestOf = (list) => [...list].sort((a, b) => (b.at || '').localeCompare(a.at || ''))[0]?.id
  const waiting = all.filter((t) => t.state === 'waiting')
  const failedNew = all.filter((t) => t.state === 'failed' && !seen.has(t.id))
  const running = all.filter((t) => t.state === 'running' || t.state === 'queued')
  const lines = []
  if (note) lines.push({ kind: 'note', text: note }) // first: it lasts five seconds and answers what was just done
  if (!sync.ok) lines.push({ kind: 'sync', text: tr('st_sync') })
  if (waiting.length) lines.push({ kind: 'waiting', text: tr('st_waiting', waiting.length), go: latestOf(waiting) })
  if (failedNew.length) lines.push({ kind: 'failed', text: tr('st_failed', failedNew.length), go: latestOf(failedNew) })
  if (running.length) lines.push({ kind: 'running', text: tr('st_running', running.length), go: latestOf(running) })
  const focusText = focus.kind === 'board' ? tr('focus_board') : (focus.kind === 'task' ? name(focus.id) : focus.label || focus.id)
  lines.push({ kind: 'focus', text: tr('st_focus', focusText, sync.at ? sync.at.toTimeString().slice(0, 5) : '–') })
  const chip = (line) => {
    if (line.kind === 'failed') {
      const n = new Set([...seen, ...failedNew.map((t) => t.id)])
      setSeen(n); data.saveSeenFailed(n)
    }
    setFocus({ kind: 'task', id: line.go })
    center(line.go)
  }

  const shown = v?.shown || new Set()
  const fresh = boardLive && frozen ? boardLive.filter((t) => !ix.byId.has(t.id)).length : 0
  // The board's own row, under the frame's title bar: only while it has something to say.
  const top = (data.DEMO || fresh > 0) && (
    <div className="fb-top" data-nofocus>
      <span className="fb-push" />
      {data.DEMO && <span className="fb-demo">{tr('demo')}</span>}
      {fresh > 0 && <button type="button" className="fb-barbtn" onClick={() => setFrozen(live)}>{tr('new_jobs', fresh)}</button>}
    </div>
  )

  // Too tall for the tab: the board keeps room for its scrollbar.
  const fits = !!L && L.height + 28 + 26 <= size.h // padding, and the line above the board
  const viewProps = { v, L, dims, anchor, stateOf, tags, touch, actions, onInfo: openDetail, popover, setPopover,
    branchesOf: (id) => branches(ix, id, shown), pins, me: own.me, name }
  const chooseProject = (id) => {
    setProjectId(id)
    data.saveBoardProject(id)
    setFocus({ kind: 'board' })
    setPopover(null)
    setExpanded(new Set())
    if (live) setFrozen(live)
    go({ t: '' }, true)
  }
  // A job from the project board: its information, on a board that has it (its flow's, if this one does not).
  const openJob = (id) => {
    if (!ix.byId.has(id)) {
      const f = flows.find((x) => x.ids.has(id))
      if (f) { setProjectId(`flow:${f.id}`); data.saveBoardProject(`flow:${f.id}`) }
      setExpanded(new Set())
      if (live) setFrozen(live)
    }
    setPicking(false)
    setPopover(null)
    setFocus({ kind: 'task', id })
    go({ t: id }, true)
  }
  const createProject = async (raw, underId = '') => {
    const name = raw.trim()
    if (!name) return false
    // One word, as project_manager requires, and fit to be its tag.
    if (/[\s#+.,;:!?()[\]{}'"]/.test(name) || !tagNameOk(name)) { flash(tr('project_bad')); return false }
    if ((projects || []).some((p) => p.name.toLowerCase() === name.toLowerCase())) { flash(tr('project_exists')); return false }
    try {
      // A sub-project wears its parent's tag path and its own name: AToM-X/ihm. The name alone stays
      // its name (a project_manager folder is named after it), so names stay unique across levels.
      const parent = underId && (projects || []).find((p) => p.id === underId)
      await data.createProject(name, parent ? `${ownTag(parent)}/${name}` : name)
      forgetProjects()
      setProjects(await loadProjects())
      return true
    } catch { flash(tr('save_failed')); return false }
  }
  // A flow is on a project when its jobs wear the project's tag: tag them all, or take the tag off them all.
  const setFlowProject = async (flow, p, on) => {
    try {
      await Promise.all(flow.tasks.map((t) => {
        const tags = t.record?.tags || []
        const next = on ? uniqueTags([...tags, ...tagsFor(p, projects)]) : tags.filter((x) => !p.tags.some((k) => tagWithin(x, k)))
        return next.length === tags.length ? null : data.putRecord('jobs', { id: t.id, tags: next }, true)
      }))
      const tasks = await data.loadTasks()
      setLive(tasks)
      setFrozen(tasks)
    } catch { flash(tr('save_failed')) }
  }
  const empty = live === null && sync.ok ? tr('loading') : !sync.ok ? tr('st_sync') : project ? tr('board_empty') : tr('no_tasks')
  const body = (
    <div className={`fb-split${wideNow ? ' wide' : ''}`}>
      {/* narrow: one card wide (the flow scrolls past it), with the padding and the border; wide: the whole tab */}
      {!FLOW && <JobList projects={projects} project={project} tasks={live} anchor={anchor} stateOf={stateOf}
        onChoose={chooseProject} managing={picking} onManage={() => setPicking(!picking)}
        onOpen={(id) => { if (live && !ix.byId.has(id)) setFrozen(live); setPicking(false); setFocus({ kind: 'task', id }); go({ t: id }, true) }} />}
      {FLOW && <section className="fb-chart" style={{ width: wideNow ? '100%' : dims.w + 28 + (fits ? 2 : 18) }}>
        <BoardBar label={<BoardLabel project={project} flow={flowPick} />} picking={picking} onPick={() => { setWide(false); setPicking(true) }}
          wide={wide} onWide={() => { setPicking(false); setWide(!wide) }} zoom={zoom} onZoom={setZoom} />
        {L ? <Modules {...viewProps} zoom={wideNow ? zoom : 1} onZoom={wideNow ? setZoom : null} /> : <div className="fb-empty">{empty}</div>}
      </section>}
      {(!wideNow || !FLOW) && (
        <section className="fb-info">
          {picking ? <ProjectPicker projects={projects} current={flowPick ? projectId : project?.id || ''} tasks={live || []} flows={flows} onChoose={chooseProject} onCreate={createProject} onAssign={setFlowProject} onOpen={openJob} />
            : anchor && <Detail task={liveById.get(anchor) || ix.byId.get(anchor)} ix={ix} tab={nav.tab} setTab={(tab) => go({ tab }, false)}
              name={name} stateOf={stateOf} evaluations={own.evaluations.filter((x) => x.task === anchor)} mine={mine} actions={actions} no={jobNumbers(project, live).get(anchor)} tainted={taint.has(anchor)} review={review.has(anchor)} toConfirm={toConfirm} />}
        </section>
      )}
    </div>
  )

  return (
    <FocusContext.Provider value={focus}><TaintContext.Provider value={taintCtx}>
      <div className="fb-root" style={PORTAL_SERVICE.color ? { '--jb-main': PORTAL_SERVICE.color } : undefined} onClickCapture={onClickCapture} onContextMenu={onContextMenu}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        {top}
        <main className="fb-main" ref={mainRef}>{body}</main>
        {foot && createPortal(<Bar lines={lines} onChip={chip} />, foot)}
      </div>
    </TaintContext.Provider></FocusContext.Provider>
  )
}
