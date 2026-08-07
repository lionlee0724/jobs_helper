import type { ChatThread, DailyStats, JobRecord } from '../../shared/types'
import type { ResponseMessage } from '../../shared/messages'
import { matchLabel, matchReasonSummary, outcomeLabel } from '../../domain/match-display'
import {
  computeOpenChatKpis,
  formatRatePct,
} from '../../domain/board-kpis'
import { isOpenChatRetryCandidate } from '../../domain/open-chat-retry'
import { buildExportCsv, downloadTextFile, type ExportAllPayload } from '../../shared/csv-export'
import { drawSuitableRateChart } from '../shared/suitable-rate-chart?inline-report'

type ExportPayload = {
  exportedAt?: number
  jobs?: JobRecord[]
  events?: unknown[]
  daily_stats?: DailyStats[]
  threads?: ChatThread[]
}

type Live = {
  jobs: JobRecord[]
  threads: ChatThread[]
  daily: DailyStats[]
  today: DailyStats | null
  suitableRate: number | null
}

const live: Live = {
  jobs: [],
  threads: [],
  daily: [],
  today: null,
  suitableRate: null,
}

async function send<T extends ResponseMessage>(msg: object): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>
}

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement
}

function fmtTime(ts?: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

function threadStatus(s: ChatThread['status']): { text: string; cls: string } {
  switch (s) {
    case 'active':
      return { text: '跟进中', cls: 'ok' }
    case 'waiting_peer':
      return { text: '等对方', cls: 'warn' }
    case 'done':
      return { text: '结束', cls: 'muted' }
    case 'error':
      return { text: '错误', cls: 'bad' }
    case 'handoff':
      return { text: '待人工', cls: 'warn' }
    default:
      return { text: s, cls: 'muted' }
  }
}

function threadExtra(t: ChatThread): string {
  const bits: string[] = []
  if (t.lastError) bits.push(t.lastError)
  if (t.locateFails) bits.push(`定位失败${t.locateFails}次`)
  return bits.join(' · ')
}

function setErr(msg: string) {
  const box = $('err')
  if (!msg) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.textContent = msg
}

function paintKpi() {
  const t = live.today
  ;($('k-seen') as HTMLElement).textContent = String(t?.seen ?? 0)
  ;($('k-suitable') as HTMLElement).textContent = String(t?.matchedSuitable ?? 0)
  ;($('k-unsuitable') as HTMLElement).textContent = String(t?.matchedUnsuitable ?? 0)
  ;($('k-opened') as HTMLElement).textContent = String(t?.opened ?? 0)
  ;($('k-replies') as HTMLElement).textContent = String(t?.replies ?? 0)
  ;($('k-resumes') as HTMLElement).textContent = String(t?.resumesSent ?? 0)
  ;($('k-errors') as HTMLElement).textContent = String(t?.errors ?? 0)
  ;($('k-rate') as HTMLElement).textContent =
    live.suitableRate == null ? '—' : `${(live.suitableRate * 100).toFixed(0)}%`
  const kpis = computeOpenChatKpis(live.jobs)
  const okEl = document.getElementById('k-open-ok')
  const failEl = document.getElementById('k-open-fail')
  if (okEl) okEl.textContent = formatRatePct(kpis.openSuccessRate)
  if (failEl) failEl.textContent = formatRatePct(kpis.openFailRate)
}

function paintTrend() {
  const body = $('trend-body')
  const rows = [...live.daily].sort((a, b) => (a.day < b.day ? 1 : -1))
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">暂无日汇总</td></tr>'
    return
  }
  body.innerHTML = rows
    .map(
      (d) => `<tr>
      <td>${escapeHtml(d.day)}</td>
      <td>${d.seen}</td>
      <td>${d.matchedSuitable}</td>
      <td>${d.matchedUnsuitable}</td>
      <td>${d.opened}</td>
      <td>${d.replies}</td>
      <td>${d.resumesSent}</td>
      <td>${d.errors}</td>
    </tr>`,
    )
    .join('')
}

function paintRateChart() {
  const canvas = document.getElementById('rate-chart') as HTMLCanvasElement | null
  if (!canvas) return
  // 近 7 日：优先 summary.last7 量级；live.daily 可能含更长历史，取最近 7 天
  const last7 = [...live.daily]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 7)
  drawSuitableRateChart(canvas, last7, { emptyText: '暂无近7日匹配样本' })
}

function filteredJobs(): JobRecord[] {
  const outcome = (document.getElementById('filter-outcome') as HTMLSelectElement).value
  const q = (
    (document.getElementById('filter-q') as HTMLInputElement).value || ''
  )
    .trim()
    .toLowerCase()

  return live.jobs
    .filter((j) => {
      if (outcome === 'opened') return j.outcome === 'opened'
      if (outcome === 'skipped') return j.outcome === 'skipped'
      if (outcome === 'failed') return j.outcome === 'failed'
      if (outcome === 'open_failed') return isOpenChatRetryCandidate(j)
      if (outcome === 'pending') return !j.outcome && !j.match
      if (outcome === 'suitable') return j.match?.suitable === true
      if (outcome === 'unsuitable') return j.match?.suitable === false
      return true
    })
    .filter((j) => {
      if (!q) return true
      const blob = [
        j.title,
        j.company,
        j.salary,
        j.city,
        j.outcome,
        j.match?.via,
        j.match?.score != null ? String(j.match.score) : '',
        matchReasonSummary(j),
        ...(j.match?.reasons || []),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
}

function paintJobs() {
  const list = filteredJobs()
  const body = $('jobs-body')
  $('jobs-hint').textContent = `共 ${live.jobs.length} 条职位记录 · 当前筛选 ${list.length} 条`
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">暂无记录（跑一轮任务后会出现）</td></tr>'
    return
  }
  body.innerHTML = list
    .map((j) => {
      const m = matchLabel(j)
      const o = outcomeLabel(j)
      const reasons = matchReasonSummary(j)
      const full = (j.match?.reasons || []).join('；') || reasons
      return `<tr>
        <td>${escapeHtml(fmtTime(j.openChatAt || j.match?.matchedAt || j.lastSeenAt))}</td>
        <td>${escapeHtml(j.title)}</td>
        <td>${escapeHtml(j.company)}</td>
        <td>${escapeHtml(j.salary || '—')}</td>
        <td><span class="tag ${m.cls}">${m.text}</span></td>
        <td><span class="tag ${o.cls}">${o.text}</span></td>
        <td class="reasons" title="${escapeHtml(full)}">${escapeHtml(reasons)}</td>
      </tr>`
    })
    .join('')
}

function paintThreads() {
  const body = $('threads-body')
  const rows = [...live.threads].sort(
    (a, b) => (b.lastActionAt || 0) - (a.lastActionAt || 0),
  )
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">暂无会话</td></tr>'
    return
  }
  body.innerHTML = rows
    .map((t) => {
      const st = threadStatus(t.status)
      const title = [t.company, t.jobTitle].filter(Boolean).join(' · ') || t.id
      const extra = threadExtra(t) || '—'
      return `<tr>
        <td>${escapeHtml(title)}</td>
        <td><span class="tag ${st.cls}">${st.text}</span></td>
        <td>${escapeHtml(fmtTime(t.lastActionAt))}</td>
        <td>${t.resumeSentAt ? escapeHtml(fmtTime(t.resumeSentAt)) : '—'}</td>
        <td class="reasons" title="${escapeHtml(extra)}">${escapeHtml(extra)}</td>
      </tr>`
    })
    .join('')
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paintAll() {
  paintKpi()
  paintRateChart()
  paintTrend()
  paintJobs()
  paintThreads()
}

async function load() {
  setErr('')
  try {
    const [summary, exp] = await Promise.all([
      send<ResponseMessage>({ type: 'analytics/summary' }),
      send<ResponseMessage>({ type: 'export/all' }),
    ])

    if (summary.type === 'analytics/summary') {
      live.today = summary.summary.today
      live.daily = summary.summary.last7
      live.suitableRate = summary.summary.suitableRate
    } else if (summary.type === 'error') {
      throw new Error(summary.error)
    }

    if (exp.type === 'export/all') {
      const p = exp.payload as ExportPayload
      live.jobs = p.jobs || []
      live.threads = p.threads || []
      if (p.daily_stats?.length) {
        // 用完整日汇总覆盖近 7 日展示（按 day 去重合并）
        const map = new Map<string, DailyStats>()
        for (const d of [...live.daily, ...p.daily_stats]) map.set(d.day, d)
        live.daily = [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 14)
      }
    } else if (exp.type === 'error') {
      throw new Error(exp.error)
    }

    paintAll()
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e))
  }
}

async function exportJson() {
  try {
    const r = await send<ResponseMessage>({ type: 'export/all' })
    if (r.type !== 'export/all') {
      setErr(r.type === 'error' ? r.error : '导出失败')
      return
    }
    const blob = new Blob([JSON.stringify(r.payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `boss-job-assistant-export-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e))
  }
}

async function exportCsv() {
  try {
    const r = await send<ResponseMessage>({ type: 'export/all' })
    if (r.type !== 'export/all') {
      setErr(r.type === 'error' ? r.error : 'CSV 导出失败')
      return
    }
    const csv = buildExportCsv(r.payload as ExportAllPayload)
    downloadTextFile(`boss-job-assistant-export-${Date.now()}.csv`, csv)
  } catch (e) {
    setErr(e instanceof Error ? e.message : String(e))
  }
}

document.getElementById('btn-refresh')?.addEventListener('click', () => {
  void load()
})
document.getElementById('btn-export')?.addEventListener('click', () => {
  void exportJson()
})
document.getElementById('btn-export-csv')?.addEventListener('click', () => {
  void exportCsv()
})
document.getElementById('filter-outcome')?.addEventListener('change', () => paintJobs())
document.getElementById('filter-q')?.addEventListener('input', () => paintJobs())

void load()
