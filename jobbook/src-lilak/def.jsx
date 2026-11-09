/**
 * jobbook — the declaration. One record is one job: what ran, on which runs and
 * server, with which parameter sets, after which earlier jobs, and where the
 * output went.
 *
 * The job's original record is the analysis server's job DB; this is the
 * portal's copy to read. A run is written as logbook writes it — one (42), a
 * range (1-5) or several (1,3,7) — and sorts by its first number.
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { portalUser } from 'racklist'

const pad = (n) => String(n).padStart(2, '0')
const today = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (r) => `${r.date || ''} ${r.time || ''}`
const firstRun = (v) => {
  const m = String(v || '').match(/\d+/)
  return m ? Number(m[0]) : null
}
const STATUS = ['대기', '실행', '성공', '실패']

export default {
  name: 'jobbook', title: tr('jb_title'), unit: tr('jb_unit'), key: 'jb',
  item: {
    key: 'jobs', noun: tr('jb_noun'), allLabel: tr('jb_tab_jobs'), tabId: 'jobs',
    label: (r) => r.title || tr('jb_noun'),
    order: { k: 'date', dir: -1 },
    tie: () => (a, b) => stamp(b).localeCompare(stamp(a)),
    findHint: tr('jb_find_hint'),
    check: (r) => (String(r.title || '').trim() ? '' : tr('jb_need_title')),
    fill: (r) => {
      const now = new Date()
      return {
        ...r,
        title: String(r.title || '').trim(),
        date: r.date || today(now),
        time: r.time || `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        submitter: r.submitter || portalUser()?.email || '',
      }
    },
    fields: [
      { k: 'title', label: tr('jb_f_title'), type: 'text', required: true, width: 420, col: { w: 280, min: 120 }, tone: 'ink' },
      { k: 'date', label: tr('jb_f_date'), type: 'date', col: { w: 96, min: 80 }, tone: 'dim' },
      { k: 'time', label: tr('jb_f_time'), type: 'time', col: { w: 60, min: 50, drop: 900 }, tone: 'dim' },
      { k: 'status', label: tr('jb_f_status'), type: 'class', pick: true, options: () => STATUS, col: { w: 64, min: 50 } },
      { k: 'tool', label: tr('jb_f_tool'), type: 'class', pick: true, options: ['LILAK', 'NPTool', 'LISE++', 'FRESCO', 'Python'],
        col: { w: 80, min: 50, drop: 1000 }, tone: 'dim' },
      { k: 'recipe', label: tr('jb_f_recipe'), type: 'class', col: { w: 130, min: 60 }, tone: 'dim' },
      { k: 'run', label: tr('jb_f_run'), type: 'text', mono: true, width: 160, hint: tr('jb_f_run_hint'),
        col: { w: 70, min: 44 }, sort: firstRun },
      { k: 'server', label: tr('jb_f_server'), type: 'class', col: { w: 90, min: 50, drop: 1100 }, tone: 'dim' },
      { k: 'submitter', label: tr('jb_f_submitter'), type: 'text', edit: false,
        col: { w: 90, min: 50, drop: 1200 }, tone: 'dim', cell: (r) => String(r.submitter || '').split('@')[0] },
      { k: 'agent', label: tr('jb_f_agent'), type: 'class', pick: true, options: ['사람', 'Claude', 'Codex'],
        col: { w: 70, min: 50, drop: 1300 }, tone: 'dim' },
      { k: 'jobId', label: tr('jb_f_job_id'), type: 'text', mono: true, width: 260 },
      // ponytail: read-only in this form only; the API can still write it. The
      // job DB holds the real label — enforce here if records start here.
      { k: 'label', label: tr('jb_f_label'), type: 'text', mono: true, width: 260, hint: tr('jb_f_label_hint'),
        disabled: (r) => !!r.createdAt },
      { k: 'params', label: tr('jb_f_params'), type: 'refs', to: { svc: 'parameters', item: 'sets', label: 'title' } },
      { k: 'logs', label: tr('jb_f_logs'), type: 'refs', to: { svc: 'logbook', item: 'logs', label: 'title' } },
      { k: 'inputs', label: tr('jb_f_inputs'), type: 'refs', to: 'self' },
      { k: 'output', label: tr('jb_f_output'), type: 'text', mono: true, width: 420 },
      { k: 'tags', label: tr('jb_f_tags'), type: 'tags', col: { w: 130, min: 60, drop: 1400 }, tone: 'dim' },
      { k: 'note', label: tr('jb_f_note'), type: 'longtext', rows: 6 },
    ],
  },
  classes: [],
  listing: { presets: [['기본', '{date} {time} [{status}] {recipe} {run} {title}', '⏎']] },
}
