/**
 * jobboard — the declaration. One record is one job: what ran, on which runs and
 * server, with which parameter sets, after which earlier jobs, and where the
 * output went.
 *
 * The job's original record is the analysis server's job DB; this is the
 * portal's copy to read. A run is written as one (42), a range (1-5) or several
 * (1,3,7), and sorts by its first number.
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
// Stored in Korean (pull_stark writes these); shown in the reader's language.
const STATUS = [['대기', tr('jb_st_queued')], ['실행', tr('jb_st_running')], ['성공', tr('jb_st_done')], ['실패', tr('jb_st_failed')]]

/** A job jobrun made (it has jobrun's id): its fields are jobrun's. */
const fromJobrun = (r) => !!r?.jobId
// jobrun names a job's parents only through a `job` parameter (a jobrun id); otherwise its inputs are people's.
const parentsFromJobrun = (r) => Object.values(r?.paramValues || {}).some((v) => /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(String(v)))

export default {
  name: 'jobboard', title: tr('jb_title'), unit: tr('jb_unit'), key: 'jb',
  item: {
    key: 'jobs', noun: tr('jb_noun'), allLabel: tr('jb_tab_jobs'), tabId: 'jobs',
    label: (r) => r.title || tr('jb_noun'),
    order: { k: 'date', dir: -1 },
    tie: () => (a, b) => stamp(b).localeCompare(stamp(a)),
    findHint: tr('jb_find_hint'),
    // A job is jobrun's: no copy of one, and one from jobrun is not deleted here — the next
    // pull would bring it back.
    clone: false,
    lock: (r) => fromJobrun(r),
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
    // What jobrun writes (pull_stark, every 30 s) is greyed out on a job that came from it:
    // an edit there would quietly be written back over. What people write stays open.
    fields: [
      { k: 'title', label: tr('jb_f_title'), type: 'text', required: true, width: 420, disabled: fromJobrun, bulk: false, col: { w: 280, min: 120 }, tone: 'ink' },
      { k: 'date', label: tr('jb_f_date'), type: 'date', disabled: fromJobrun, bulk: false, col: { w: 96, min: 80 }, tone: 'dim' },
      { k: 'time', label: tr('jb_f_time'), type: 'time', disabled: fromJobrun, bulk: false, col: { w: 60, min: 50, drop: 900 }, tone: 'dim' },
      { k: 'status', label: tr('jb_f_status'), type: 'select', options: STATUS, disabled: fromJobrun, bulk: false, col: { w: 64, min: 50 } },
      { k: 'tool', label: tr('jb_f_tool'), type: 'class', pick: true, options: ['LILAK', 'NPTool', 'LISE++', 'FRESCO', 'Python'],
        col: { w: 80, min: 50, drop: 1000 }, tone: 'dim' },
      { k: 'recipe', label: tr('jb_f_recipe'), type: 'class', disabled: fromJobrun, bulk: false, col: { w: 130, min: 60 }, tone: 'dim' },
      { k: 'run', label: tr('jb_f_run'), type: 'text', mono: true, width: 160, hint: tr('jb_f_run_hint'),
        col: { w: 70, min: 44 }, sort: firstRun },
      { k: 'server', label: tr('jb_f_server'), type: 'class', disabled: fromJobrun, bulk: false, col: { w: 90, min: 50, drop: 1100 }, tone: 'dim' },
      { k: 'submitter', label: tr('jb_f_submitter'), type: 'text', edit: false,
        col: { w: 90, min: 50, drop: 1200 }, tone: 'dim', cell: (r) => String(r.submitter || '').split('@')[0] },
      { k: 'agent', label: tr('jb_f_agent'), type: 'select', options: [['사람', tr('jb_ag_person')], 'Claude', 'Codex', ['플랫폼 agent', tr('jb_ag_platform')]],
        col: { w: 70, min: 50, drop: 1300 }, tone: 'dim' },
      { k: 'jobId', label: tr('jb_f_job_id'), type: 'text', mono: true, width: 260, disabled: fromJobrun, bulk: false },
      // ponytail: read-only in this form only; the API can still write it. The
      // job DB holds the real label — enforce here if records start here.
      { k: 'label', label: tr('jb_f_label'), type: 'text', mono: true, width: 260, hint: tr('jb_f_label_hint'),
        disabled: (r) => !!r.createdAt },
      { k: 'params', label: tr('jb_f_params'), type: 'refs', to: { svc: 'parameters', item: 'sets', label: 'title' } },
      { k: 'inputs', label: tr('jb_f_inputs'), type: 'refs', to: 'self', disabled: parentsFromJobrun, bulk: false },
      { k: 'output', label: tr('jb_f_output'), type: 'text', mono: true, width: 420, disabled: fromJobrun, bulk: false },
      { k: 'tags', label: tr('jb_f_tags'), type: 'tags', col: { w: 130, min: 60, drop: 1400 }, tone: 'dim' },
      { k: 'note', label: tr('jb_f_note'), type: 'longtext', rows: 6 },
      // What the flow tab tells about a job beside what jobrun knows: why it ran
      // and what came of it — written by the person or agent who asked for it.
      { k: 'goal', label: tr('jb_f_goal'), type: 'longtext', rows: 3 },
      { k: 'why', label: tr('jb_f_why'), type: 'longtext', rows: 4 },
      { k: 'references', label: tr('jb_f_references'), type: 'longtext', rows: 3 },
      { k: 'report', label: tr('jb_f_report'), type: 'longtext', rows: 8 },
      { k: 'briefing', label: tr('jb_f_briefing'), type: 'longtext', rows: 6 },
    ],
  },
  classes: [],
  listing: { presets: [[tr('jb_preset_default'), '{date} {time} [{status}] {recipe} {run} {title}', '⏎']] },
}
