import type { Policy, Profile, MessageAssistConfig, RunState } from '../../shared/types'
import type { ResponseMessage } from '../../shared/messages'

import { ensureHostPermissionForLlm, testLlmConnection } from '../../background/llm-client'
import {
  normalizeExcludeKeywords,
  normalizeExpectCities,
  normalizeMaxYearsGap,
  normalizeMinMatchScore,
  normalizeMinSalaryK,
  resolveMinScore,
  resolveMinKeywordHits,
  summarizeHardRulesForUi,
  DEFAULT_MIN_MATCH_SCORE,
} from '../../domain/match-decision'
import { applyDocumentTheme, type UiThemePreference } from '../../ui/shared/theme'
import { matchSidepanelShortcut, normalizeShortcutsEnabled } from '../../ui/shared/ui-shortcuts'
import { buildExportCsv, downloadTextFile, type ExportAllPayload } from '../../shared/csv-export'
import { drawSuitableRateChart } from '../../ui/shared/suitable-rate-chart?inline-sidepanel'
import { formatRunStatusText, formatStartConfirmText, enhanceListFailureNotice } from '../../domain/run-status-display'
import { requireMessageResponse, requireOkResponse } from '../../ui/shared/runtime-response'

const $ = (selector: string): any => document.getElementById(selector) || document.querySelector(selector);

let live: {
  run: RunState
  todayOpened: number
  todayReplies: number
  summary: any
  events: any[]
  profileSyncedAt: number | null
  profileMeta: string
  profileExtra: any
  profileDirty: boolean
  message: string
  messageKind: string
  messageAssistConfig: any
  anomaly: { kind: string; reason?: string; until: number; needsHuman?: boolean } | null
  notice: string | null
} = {
  run: { status: 'idle' },
  todayOpened: 0,
  todayReplies: 0,
  summary: null,
  events: [],
  profileSyncedAt: null,
  profileMeta: '',
  profileExtra: {},
  profileDirty: false,
  message: '',
  messageKind: '',
  messageAssistConfig: null,
  anomaly: null,
  notice: null,
}

let u = false // formDirty
let f = false // formDirty state
let h: NodeJS.Timeout | null = null

function i(e: string, kind: string = 'ok') {
  live.message = e
  live.messageKind = kind
  const el = $('msg-box')
  if (!el) return
  if (!live.message) {
    el.hidden = true
    el.textContent = ''
    el.className = 'status'
    return
  }
  el.hidden = false
  el.className = `status ${kind}`
  el.textContent = live.message
}

function x() {
  const e = $('msg-box')
  if (!e) return
  if (!live.message) {
    e.hidden = true
    e.textContent = ''
    e.className = 'status'
    return
  }
  e.hidden = false
  e.className = `status ${live.messageKind}`
  e.textContent = live.message
}

function R(r: RunState) {
  return formatRunStatusText({
    state: r,
    anomaly: live.anomaly,
    notice: enhanceListFailureNotice(live.notice),
  })
}

function I() {
  const e = document.activeElement
  if (!e || !(e instanceof HTMLElement) || !g.contains(e)) return false
  const t = e.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || e.isContentEditable
}

function O() {
  f = true
  g.innerHTML = `
    <h1>BOSS 求职副驾驶</h1>
    <p class="sub">本地扩展 · LLM 匹配 · 限速开聊 · IndexedDB 统计</p>

    <nav class="tabs">
      <button data-tab="run" class="tab active">运行</button>
      <button data-tab="msg" class="tab">消息</button>
      <button data-tab="policy" class="tab">策略</button>
      <button data-tab="setup" class="tab">设置</button>
    </nav>

    <div id="panel-run" class="tab-panel">
      <section>
        <h2>运行</h2>
        <div id="run-status" class="status">加载中…</div>
        <div class="btn-row">
          <button type="button" id="btn-start">开始</button>
          <button type="button" id="btn-stop" class="danger">停止</button>
          <button type="button" id="btn-refresh" class="secondary">刷新状态</button>
        </div>
        <div id="msg-box" class="status" style="margin-top:8px" hidden></div>
        <p class="warn">后台=浏览器进程内；完全退出 Chrome 会停止。工作标签被关会暂停。请自担平台风控风险。</p>
      </section>

      <section>
        <h2>今日统计</h2>
        <div class="stats">
          <div class="stat"><b id="stat-seen">0</b><span>浏览</span></div>
          <div class="stat"><b id="stat-suitable">0</b><span>合适</span></div>
          <div class="stat"><b id="stat-unsuitable">0</b><span>不合适</span></div>
          <div class="stat"><b id="stat-opened">0</b><span>开聊</span></div>
          <div class="stat"><b id="stat-replies">0</b><span>回复</span></div>
          <div class="stat"><b id="stat-resumes">0</b><span>发简历</span></div>
        </div>
        <p class="sub" style="margin-top:8px" id="stat-rate">近7日合适率：—</p>
        <div class="rate-chart-wrap">
          <canvas id="rate-chart" width="320" height="120" aria-label="近7日合适率"></canvas>
        </div>
        <div class="btn-row">
          <button type="button" id="btn-report">打开数据看板</button>
          <button type="button" id="btn-retry-open" class="secondary">重试开聊失败</button>
          <button type="button" id="btn-export" class="secondary">导出 JSON</button>
          <button type="button" id="btn-export-csv" class="secondary">导出 CSV</button>

        </div>
      </section>

      <section>
        <h2>最近事件</h2>
        <div class="events" id="events-list"><div>（暂无）</div></div>
      </section>
    </div>

    <div id="panel-msg" class="tab-panel" hidden>
      <section>
        <h2>消息助手</h2>
        <p class="sub">跟进主路径在此。职位线默认<strong>不</strong>自动回消息（可在策略打开「职位线内跟进」）。消息页右下角浮层可处理一轮/当前会话。</p>
        <div class="row">
          <label><span>自治级别</span>
            <select id="msgAutonomy">
              <option value="graded">分级（默认）</option>
              <option value="resume_only">仅发简历</option>
              <option value="full_auto">全自动（高风险）</option>
            </select>
          </label>
          <label><span>每轮条数</span>
            <input type="number" id="msgBatchSize" min="1" max="20" placeholder="默认 5" />
          </label>
        </div>
        <p class="warn" id="msg-full-auto-warn" hidden>全自动会代答薪资/面试/联系方式类意图，仅在你明确知情时使用。</p>
        <div class="btn-row">
          <button type="button" id="btn-save-msg" class="secondary">保存消息配置</button>
          <button type="button" id="btn-open-chat">打开消息页</button>
        </div>
        <div class="btn-row">
          <button type="button" id="btn-msg-import">导入现有会话</button>
          <button type="button" id="btn-msg-run">处理一轮</button>
          <button type="button" id="btn-msg-current">处理当前会话</button>
        </div>
        <div class="btn-row">
          <button type="button" id="btn-msg-run-all">处理到清空</button>
          <button type="button" id="btn-msg-stop-all" class="danger">停止清空循环</button>
          <button type="button" id="btn-msg-reset" class="secondary">重置错误会话</button>
        </div>
        <p class="sub" id="msg-assist-hint" style="margin-top:6px">进度与结果见下方与最近事件。</p>
        <div id="msg-progress" class="status" style="margin-top:8px">消息循环：空闲</div>
        <h2 style="margin-top:16px">待人工（Handoff）</h2>
        <p class="sub">薪资/面试/联系方式等会挂起在此。处理后点「已处理」。</p>
        <div class="btn-row">
          <button type="button" id="btn-handoff-refresh" class="secondary">刷新待人工</button>
        </div>
        <div class="events" id="handoff-list"><div>（暂无）</div></div>
      </section>
    </div>

    <div id="panel-policy" class="tab-panel" hidden>
      <section>
        <h2>策略</h2>
        <p class="sub">先配好基础与匹配即可开跑；高级项默认折叠。</p>

        <h3 class="policy-sec">基础</h3>
        <label class="switch">
          <input type="checkbox" id="enabled" />
          <span>允许自动执行（开始前仍须点「开始」）</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="followUpInJobRun" />
          <span>职位线内跟进（环 B，默认关）</span>
        </label>
        <div class="row">
          <label><span>风险档</span>
            <select id="riskProfile">
              <option value="conservative">保守档（推荐）</option>
              <option value="balanced">均衡档</option>
              <option value="aggressive">激进档（高风险）</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label><span>日开聊上限</span>
            <input type="number" id="dailyLimit" min="1" placeholder="留空用档位" />
          </label>
        </div>
        <div class="row">
          <label><span>本轮开聊上限</span>
            <input type="number" id="sessionMaxOpenChat" min="1" placeholder="建议 3；空=不限" />
          </label>
          <label><span>本轮回复上限</span>
            <input type="number" id="sessionMaxReplies" min="1" placeholder="建议 3；空=不限" />
          </label>
        </div>

        <h3 class="policy-sec">匹配与硬否</h3>
        <div class="row">
          <label><span>匹配模式</span>
            <select id="matchMode">
              <option value="balanced">均衡（推荐）</option>
              <option value="llm_only">仅 LLM</option>
              <option value="keywords_only">仅关键词（高级）</option>
            </select>
          </label>
          <label><span>开聊最低分</span>
            <input type="number" id="minMatchScore" min="0" max="100" placeholder="默认 50" />
          </label>
        </div>
        <div class="row">
          <label><span>期望城市（逗号，空=不限）</span>
            <input type="text" id="expectCities" placeholder="上海,杭州" />
          </label>
          <label><span>最低薪资 K/月（空=不限）</span>
            <input type="number" id="minSalaryK" min="1" max="999" placeholder="如 20" />
          </label>
        </div>
        <div class="row">
          <label><span>年限差距上限（年，空=不限）</span>
            <input type="number" id="maxYearsGap" min="0" max="40" placeholder="如 3" />
          </label>
          <label><span>排除词（逗号）</span>
            <input type="text" id="excludeKeywords" placeholder="外包,中介" />
          </label>
        </div>
        <p class="sub">硬否在 LLM 前生效；字段留空=不启用该条（证据不足不拒绝）。</p>

        <details id="policy-advanced" class="policy-advanced">
          <summary>高级（间隔 / 回复日上限 / 关键词阈值）</summary>
          <div class="row" style="margin-top:8px">
            <label><span>最小间隔（秒）</span>
              <input type="number" id="minIntervalSec" min="0" step="1" placeholder="留空用档位" />
            </label>
            <label><span>最大间隔（秒）</span>
              <input type="number" id="maxIntervalSec" min="0" step="1" placeholder="留空用档位" />
            </label>
          </div>
          <!-- 兼容隐藏 ms 字段供旧逻辑，由秒字段驱动 -->
          <input type="hidden" id="minInterval" />
          <input type="hidden" id="maxInterval" />
          <div class="row">
            <label><span>日回复上限</span>
              <input type="number" id="replyLimit" min="1" placeholder="可选" />
            </label>
            <label><span>关键词软阈值</span>
              <input type="number" id="matchMinKeywordHits" min="0" placeholder="默认 2" />
            </label>
          </div>
          <p class="sub">间隔留空则跟随风险档。自定义档时请填写间隔与日上限。</p>
        </details>

        <div class="btn-row" style="margin-top:12px">
          <button type="button" id="btn-save-policy" class="secondary">保存策略</button>
        </div>
      </section>
    </div>

    <div id="panel-setup" class="tab-panel" hidden>
      <section>
        <h2>LLM（OpenAI 兼容）</h2>
        <label><span>Base URL</span>
          <input type="text" id="baseUrl" placeholder="https://api.deepseek.com/v1" />
        </label>
        <label><span>API Key</span>
          <input type="password" id="apiKey" placeholder="sk-..." />
        </label>
        <label><span>Model</span>
          <input type="text" id="model" placeholder="deepseek-chat" />
        </label>
        <div class="btn-row">
          <button type="button" id="btn-save-llm" class="secondary">保存 LLM</button>
          <button type="button" id="btn-test-llm">测试 LLM</button>
          <button type="button" id="btn-probe" class="secondary">选择器自检</button>
        </div>
        <p class="sub" id="llm-test-hint">点「测试 LLM」会先申请网站访问权限，再直接请求接口。若仍 Failed to fetch：chrome://extensions → 本扩展→「所有网站」→ 重新加载。</p>
        <p class="sub">「选择器自检」：请先打开 BOSS 列表/详情/消息页，将下载 JSON 探针报告（改版排查用）。</p>
      </section>

      <section>
        <h2>简历画像</h2>
        <p class="sub">流程：打开 BOSS 在线简历 → 抓取全文 → LLM 归纳 → 你可二次修改后保存。需先配置 LLM。</p>
        <label><span>摘要（可编辑 · 匹配/聊天主用）</span>
          <textarea id="profileSummary" rows="8"></textarea>
        </label>
        <label><span>技能（逗号分隔）</span>
          <input type="text" id="profileSkills" />
        </label>
        <label><span>亮点（每行一条，可编辑）</span>
          <textarea id="profileHighlights" rows="4" placeholder="LLM 归纳后显示"></textarea>
        </label>
        <label><span>抓取原文预览（只读）</span>
          <textarea id="profileRaw" rows="5" readonly></textarea>
        </label>
        <div class="btn-row">
          <button type="button" id="btn-sync-profile">抓取并 LLM 归纳</button>
          <button type="button" id="btn-save-profile" class="secondary">保存画像</button>
          <button type="button" id="btn-reload-form" class="secondary">从存储重载表单</button>
        </div>
        <p class="sub" id="profile-synced">同步时间：未同步</p>
      </section>
    </div>
  `
  g.addEventListener("input", e => {
    const t = e.target as HTMLInputElement
    if (t.id && (t.id === 'baseUrl' || t.id === 'apiKey' || t.id === 'model' || t.id === 'enabled' || t.id === 'followUpInJobRun' || t.id === 'dailyLimit' || t.id === 'replyLimit' || t.id === 'minIntervalSec' || t.id === 'maxIntervalSec' || t.id === 'sessionMaxOpenChat' || t.id === 'sessionMaxReplies' || t.id === 'matchMode' || t.id === 'matchMinKeywordHits' || t.id === 'minMatchScore' || t.id === 'excludeKeywords' || t.id === 'expectCities' || t.id === 'minSalaryK' || t.id === 'maxYearsGap' || t.id === 'riskProfile' || t.id === 'msgAutonomy' || t.id === 'msgBatchSize' || t.id === 'profileSummary' || t.id === 'profileSkills' || t.id === 'profileHighlights')) u = true
    if (t.id === 'msgAutonomy') {
      const w = $('msg-full-auto-warn')
      if (w) w.hidden = t.value !== 'full_auto'
    }
  }, true)
  C()
}

function M(policy: Policy, llm: any, profile: Profile | null) {
  if (!policy) return
  // fill policy fields
  $('enabled')!.checked = !!policy.enabled
  const fu = $('followUpInJobRun')
  if (fu) fu.checked = !!policy.followUpInJobRun
  $('dailyLimit')!.value = policy.dailyOpenChatLimit != null ? String(policy.dailyOpenChatLimit) : ''
  $('replyLimit')!.value = policy.dailyReplyLimit != null ? String(policy.dailyReplyLimit) : ''
  const minMs = policy.minIntervalMs
  const maxMs = policy.maxIntervalMs
  $('minInterval')!.value = minMs != null ? String(minMs) : ''
  $('maxInterval')!.value = maxMs != null ? String(maxMs) : ''
  const minSecEl = $('minIntervalSec')
  const maxSecEl = $('maxIntervalSec')
  if (minSecEl) minSecEl.value = minMs != null && Number.isFinite(minMs) ? String(Math.round(minMs / 1000)) : ''
  if (maxSecEl) maxSecEl.value = maxMs != null && Number.isFinite(maxMs) ? String(Math.round(maxMs / 1000)) : ''
  $('sessionMaxOpenChat')!.value = policy.sessionMaxOpenChat != null ? String(policy.sessionMaxOpenChat) : ''
  $('sessionMaxReplies')!.value = policy.sessionMaxReplies != null ? String(policy.sessionMaxReplies) : ''
  const modeEl = $('matchMode')!
  modeEl.value = policy.matchMode || 'balanced'
  $('matchMinKeywordHits')!.value = policy.matchMinKeywordHits != null ? String(policy.matchMinKeywordHits) : '2'
  const scoreEl = $('minMatchScore')!
  scoreEl.value = policy.minMatchScore != null ? String(policy.minMatchScore) : String(DEFAULT_MIN_MATCH_SCORE)
  $('excludeKeywords')!.value = policy.excludeKeywords && policy.excludeKeywords.length ? policy.excludeKeywords.join(',') : ''
  $('expectCities')!.value = policy.expectCities && policy.expectCities.length ? policy.expectCities.join(',') : ''
  $('minSalaryK')!.value = policy.minSalaryK != null ? String(policy.minSalaryK) : ''
  $('maxYearsGap')!.value = policy.maxYearsGap != null ? String(policy.maxYearsGap) : ''
  const riskEl = $('riskProfile')!
  riskEl.value = policy.riskProfile || 'conservative'
  u = false

  // fill LLM fields
  if (llm) {
    $('baseUrl')!.value = llm.baseUrl || ''
    $('apiKey')!.value = llm.apiKey || ''
    $('model')!.value = llm.model || ''
  }

  // fill profile
  if (profile) {
    $('profileSummary')!.value = profile.summary || ''
    $('profileSkills')!.value = profile.skills ? profile.skills.join(',') : ''
    $('profileHighlights')!.value = profile.highlights ? profile.highlights.join('\n') : ''
    $('profileRaw')!.value = profile.rawText ? profile.rawText.slice(0, 8000) + (profile.rawText.length > 8000 ? '\n…(已截断)' : '') : ''
    live.profileSyncedAt = profile.syncedAt ?? null
    live.profileExtra = { rawText: profile.rawText, years: profile.years, education: profile.education, expectRoles: profile.expectRoles, highlights: profile.highlights, analyzedByLlm: profile.analyzedByLlm }
    const t = profile.analyzedByLlm ? 'LLM已归纳' : '未归纳'
    const n = profile.rawText ? profile.rawText.length : 0
    live.profileMeta = `${t} · 原文 ${n} 字${profile.years ? ' · ' + profile.years : ''}${profile.education ? ' · ' + profile.education : ''}`
    L()
  }
}

function S(profile: Profile | null) {
  if (!profile) return
  // same as above but only profile
  $('profileSummary')!.value = profile.summary || ''
  $('profileSkills')!.value = profile.skills ? profile.skills.join(',') : ''
  $('profileHighlights')!.value = profile.highlights ? profile.highlights.join('\n') : ''
  $('profileRaw')!.value = profile.rawText ? profile.rawText.slice(0, 8000) + (profile.rawText.length > 8000 ? '\n…(已截断)' : '') : ''
  live.profileSyncedAt = profile.syncedAt ?? null
  live.profileExtra = { rawText: profile.rawText, years: profile.years, education: profile.education, expectRoles: profile.expectRoles, highlights: profile.highlights, analyzedByLlm: profile.analyzedByLlm }
  const t = profile.analyzedByLlm ? 'LLM已归纳' : '未归纳'
  const n = profile.rawText ? profile.rawText.length : 0
  live.profileMeta = `${t} · 原文 ${n} 字${profile.years ? ' · ' + profile.years : ''}${profile.education ? ' · ' + profile.education : ''}`
  L()
}

function L() {
  const e = $('profile-synced')
  if (!e) return
  const t = live.profileSyncedAt ? new Date(live.profileSyncedAt).toLocaleString() : '未同步'
  e.textContent = `同步时间：${t}${live.profileMeta ? ' · ' + live.profileMeta : ''}`
}

function T() {
  const e = $('run-status')
  e!.className = `status ${live.run.status === 'running' ? 'ok' : ''}`
  e!.textContent = `${R(live.run)}\n\n今日开聊 ${live.todayOpened} · 回复 ${live.todayReplies}`
  const t = live.summary?.today
  if (t) {
    $('stat-seen')!.textContent = String(t.seen || 0)
    $('stat-suitable')!.textContent = String(t.matchedSuitable || 0)
    $('stat-unsuitable')!.textContent = String(t.matchedUnsuitable || 0)
    $('stat-opened')!.textContent = String(t.opened || 0)
    $('stat-replies')!.textContent = String(t.replies || 0)
    $('stat-resumes')!.textContent = String(t.resumesSent || 0)
  }
  const rateEl = $('stat-rate')
  rateEl!.textContent = `近7日合适率：${live.summary?.suitableRate != null ? `${(live.summary.suitableRate * 100).toFixed(0)}%` : '—'}`
  const chart = $('rate-chart') as HTMLCanvasElement | null
  if (chart && live.summary?.last7) {
    try {
      drawSuitableRateChart(chart, live.summary.last7)
    } catch {
      /* chart 失败不阻断状态刷新 */
    }
  }
  const l = $('events-list')
  l!.innerHTML = live.events.length ? live.events.map(c => {
    const p = A(c)
    return `<div title="${v(p)}">${new Date(c.ts).toLocaleTimeString()} · ${v(c.type)}${p ? ' · ' + v(p) : ''}</div>`
  }).join('') : '<div>（暂无）</div>'
  x()
  L()
}

function A(e: any) {
  const t = e.payload || {}
  const n = String(t.error ?? t.message ?? '')
  if (n) return n.slice(0, 160)
  if (e.type === 'job_seen') return `${String(t.title)} · desc=${t.descLen}`
  if (e.type === 'job_matched' && t.suitable != null) return `${t.suitable ? '合适' : '不合适'} ${String(t.reasons?.[0] || '')}`
  return ''
}

async function k() {
  const e = await send({ type: 'kv/get' })
  if (e.type !== 'kv/get') { i(e.type === 'error' ? e.error : '读取配置失败', 'err'); return }
  const policy = e.policy
  const llm = e.llm
  const profile = e.profile
  M(policy, llm, profile)
  fillMessageAssist(e.messageAssist)
  await refreshMsgProgress()
}

async function y(forceForm = false) {
  try {
    const [run, summary, events, policy] = await Promise.all([
      send({ type: 'run/status' }),
      send({ type: 'analytics/summary' }),
      send({ type: 'events/list', limit: 40 }),
      send({ type: 'kv/get' })
    ])
    if (run.type === 'run/status') {
      live.run = run.state
      live.todayOpened = run.todayOpened || 0
      live.todayReplies = run.todayReplies || 0
      live.anomaly = run.anomaly ?? null
      live.notice = run.notice ?? null
    }
    if (summary.type === 'analytics/summary') live.summary = summary.summary
    if (events.type === 'events/list') live.events = events.events
    if (policy.type === 'kv/get' && (forceForm || !u)) {
      const p = policy.policy
      const l = policy.llm
      const pr = policy.profile
      M(p, l, pr)
      fillMessageAssist(policy.messageAssist)
    }
    T()
    await refreshMsgProgress()
  } catch (n) {
    i(n instanceof Error ? n.message : String(n), 'err')
  }
}

function C() {
  $('btn-refresh')?.addEventListener('click', () => void y())
  $('btn-reload-form')?.addEventListener('click', async () => {
    await k()
    i('已从存储重载表单', 'ok')
  })
  $('btn-start')?.addEventListener('click', async () => {
    const btn = $('btn-start') as HTMLButtonElement | null
    if (btn) btn.disabled = true
    i('准备启动：保存配置并确认列表…')
    try {
      await w()
      await b()
      u = false
      const prev = await send({ type: 'run/preview' })
      if (prev.type === 'error') throw new Error(prev.error)
      if (prev.type !== 'run/preview') throw new Error('预览失败')
      if (!prev.ok) throw new Error(prev.error)
      const ok = window.confirm(
        formatStartConfirmText({ listLabel: prev.listLabel, listUrl: prev.listUrl }),
      )
      if (!ok) {
        i('已取消启动', 'ok')
        return
      }
      i('启动中…')
      const res = requireOkResponse(await send({ type: 'run/start' }))
      if (res.type !== 'ok') throw new Error('启动失败')
      i(`已启动 · ${prev.listLabel}`, 'ok')
      await y(true)
    } catch (e) {
      i(e instanceof Error ? e.message : String(e), 'err')
      await y(false).catch(() => undefined)
    } finally {
      if (btn) btn.disabled = false
    }
  })
  $('btn-stop')?.addEventListener('click', async () => {
    const btn = $('btn-stop') as HTMLButtonElement | null
    if (btn) btn.disabled = true
    i('停止中…')
    try {
      requireOkResponse(await send({ type: 'run/stop' }))
      i('已停止', 'ok')
      await y()
    } catch (e) {
      i(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      if (btn) btn.disabled = false
    }
  })
  $('btn-save-policy')?.addEventListener('click', async () => {
    try {
      const saved = await w()
      u = false
      const hard = summarizeHardRulesForUi(saved)
      const score = resolveMinScore(saved)
      i(`策略已保存 · 生效最低分 ${score} · ${hard}`, 'ok')
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-save-llm')?.addEventListener('click', async () => {
    try {
      await b()
      u = false
      i('LLM 已保存。建议再点「测试 LLM」', 'ok')
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-test-llm')?.addEventListener('click', async () => {
    const e = $('btn-test-llm')
    if (!e) return
    e.disabled = true
    i('正在申请网站访问权限，并在侧栏上下文直接请求 LLM…')
    try {
      const t = {
        baseUrl: $('baseUrl')!.value.trim(),
        apiKey: $('apiKey')!.value.trim(),
        model: $('model')!.value.trim()
      }
      if (!t.baseUrl || !t.apiKey || !t.model) throw new Error('请先填写 Base URL / API Key / Model')
      await b()
      const perm = await ensureHostPermissionForLlm(t.baseUrl, { requestIfMissing: true })
      if (!perm.granted) throw new Error([`未授予访问 ${perm.originPattern}`, `当前已授予：${perm.grantedOrigins.join(', ') || '（无）'}`].join('\n'))
      const l = await testLlmConnection(t)
      u = false
      i(`LLM 正常 · ${l.latencyMs} ms · 权限 ${l.originPattern} · 回复：${l.reply}`, 'ok')
    } catch (t) {
      i(t instanceof Error ? t.message : String(t), 'err')
    } finally {
      e.disabled = false
    }
  })
  $('btn-probe')?.addEventListener('click', async () => {
    const btn = $('btn-probe') as HTMLButtonElement | null
    if (btn) btn.disabled = true
    i('正在当前 BOSS 页运行选择器自检…')
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const tab = tabs[0]
      if (!tab?.id || !tab.url || !/zhipin\.com|bosszhipin\.com/i.test(tab.url)) {
        throw new Error('请先激活一个 BOSS 直聘标签页（列表/详情/消息）')
      }
      const res = await send({
        type: 'content/exec',
        tabId: tab.id,
        command: { op: 'probe_selectors' },
      })
      if (res.type === 'error') throw new Error(res.error)
      if (res.type !== 'content/exec') throw new Error('探针无响应')
      if (!res.result.ok) throw new Error(res.result.error || '探针失败')
      const data = res.result.data
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `boss-selector-probe-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      i('自检完成，已下载 JSON 报告', 'ok')
    } catch (e) {
      i(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      if (btn) btn.disabled = false
    }
  })
  $('btn-save-profile')?.addEventListener('click', async () => {
    try {
      await B()
      u = false
      i('画像已保存', 'ok')
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-sync-profile')?.addEventListener('click', async () => {
    const e = $('btn-sync-profile')
    if (!e) return
    e.disabled = true
    i('正在打开简历页、抓取全文并用 LLM 归纳…（约 10~60 秒）')
    try {
      await b()
      const c = await send({ type: 'profile/sync' })
      if (c.type === 'error') throw new Error(c.error)
      if (c.type === 'profile/sync') {
        S(c.profile)
        u = true
        i(`已抓取 ${c.profile.rawText?.length || 0} 字并用 LLM 归纳。`, 'ok')
      }
      await y()
    } catch (c) {
      i(c instanceof Error ? c.message : String(c), 'err')
    } finally {
      e.disabled = false
    }
  })
  $('btn-report')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('extension/ui/report/index.html') })
  })
  $('btn-retry-open')?.addEventListener('click', async () => {
    try {
      const ok = window.confirm(
        '将把「匹配合适但开聊失败」的职位重新入队，下次运行会再试开聊。继续？',
      )
      if (!ok) return
      const r = await send({ type: 'jobs/retryFailedOpen' })
      if (r.type === 'error') throw new Error(r.error)
      if (r.type !== 'jobs/retryFailedOpen') throw new Error('重试失败')
      i(
        r.requeued > 0
          ? `已重新入队 ${r.requeued} 条，请点「开始」继续开聊`
          : '没有可重试的开聊失败记录',
        r.requeued > 0 ? 'ok' : 'err',
      )
    } catch (e) {
      i(e instanceof Error ? e.message : String(e), 'err')
    }
  })
  $('btn-open-chat')?.addEventListener('click', async () => {
    try {
      const e = await send({ type: 'messageAssist/openChat' })
      if (e.type === 'error') throw new Error(e.error)
      i('已打开/聚焦消息页。', 'ok')
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-save-msg')?.addEventListener('click', async () => {
    try {
      await saveMessageAssist()
      u = false
      i('消息配置已保存', 'ok')
      await refreshMsgProgress()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-msg-import')?.addEventListener('click', async () => {
    i('正在从消息列表导入会话…（请保持消息页打开）')
    try {
      const e = await send({ type: 'threads/import' })
      if (e.type === 'error') throw new Error(e.error)
      if (e.type === 'threads/import') {
        i(`导入完成：新增 ${e.imported} · 更新 ${e.updated} · 跳过 ${e.skipped} · 扫描 ${e.scanned}`, 'ok')
      }
      await refreshMsgProgress()
      await y()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-msg-run')?.addEventListener('click', async () => {
    i('消息助手处理中…（请保持消息页已打开）')
    try {
      await saveMessageAssist().catch(() => undefined)
      const batch = Math.max(1, Math.min(20, parseInt($('msgBatchSize')?.value || '5') || 5))
      const e = await send({ type: 'messageAssist/run', limit: batch })
      if (e.type !== 'messageAssist/run') { i(e.type === 'error' ? e.error : '处理失败', 'err'); return }
      if (!e.ok) i(e.error || '处理失败', 'err')
      else {
        const t = (e.results || []).slice(0, 5).map(n => n.action).join(', ')
        i(`消息助手完成 ${e.processed} 条${t ? '：' + t : ''}`, 'ok')
      }
      await refreshMsgProgress()
      await y()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-msg-run-all')?.addEventListener('click', async () => {
    i('启动处理到清空…')
    try {
      await saveMessageAssist().catch(() => undefined)
      const e = await send({ type: 'messageAssist/runAll' })
      if (e.type === 'error') throw new Error(e.error)
      i('已启动「处理到清空」（alarm 续跑）', 'ok')
      await refreshMsgProgress()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-msg-stop-all')?.addEventListener('click', async () => {
    try {
      const e = await send({ type: 'messageAssist/stopAll' })
      if (e.type === 'error') throw new Error(e.error)
      i('已停止清空循环', 'ok')
      await refreshMsgProgress()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-handoff-refresh')?.addEventListener('click', async () => {
    await refreshHandoffList()
    i('待人工列表已刷新', 'ok')
  })
  $('btn-msg-reset')?.addEventListener('click', async () => {
    try {
      const e = await send({ type: 'messageAssist/resetErrors' })
      if (e.type === 'messageAssist/resetErrors') i(`已重置 ${e.count} 个错误会话`, 'ok')
      else i(e.type === 'error' ? e.error : '重置失败', 'err')
      await refreshMsgProgress()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-msg-current')?.addEventListener('click', async () => {
    i('消息助手处理当前会话…（请保持右侧会话已打开）')
    try {
      const e = await send({ type: 'messageAssist/runCurrent' })
      if (e.type !== 'messageAssist/runCurrent') { i(e.type === 'error' ? e.error : '处理失败', 'err'); return }
      if (!e.ok) i(e.error || '处理失败', 'err')
      else {
        const r = e.result
        const who = r ? [r.company, r.jobTitle].filter(Boolean).join('·') || r.threadId : ''
        i(`当前会话处理完成：${r?.action ?? ''} · ${who}`, 'ok')
      }
      await refreshMsgProgress()
      await y()
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })
  $('btn-export')?.addEventListener('click', async () => {
    try {
      const e = await send({ type: 'export/all' })
      if (e.type !== 'export/all') { i(e.type === 'error' ? e.error : '导出失败', 'err'); return }
      const t = new Blob([JSON.stringify(e.payload, null, 2)], { type: 'application/json' })
      const n = URL.createObjectURL(t)
      const l = document.createElement('a')
      l.href = n
      l.download = `boss-job-assistant-export-${Date.now()}.json`
      l.click()
      URL.revokeObjectURL(n)
      i('已导出 JSON 备份', 'ok')
    } catch (e) { i(e instanceof Error ? e.message : String(e), 'err') }
  })

  // tabs
  const tabs = document.querySelectorAll('.tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab') as 'run' | 'msg' | 'policy' | 'setup'
      applyTab(id)
    })
  })
}

async function saveMessageAssist(): Promise<MessageAssistConfig> {
  const autonomy = ($('msgAutonomy')?.value || 'graded') as MessageAssistConfig['autonomy']
  if (autonomy === 'full_auto') {
    const ok = window.confirm(
      '全自动会代答薪资/面试/联系方式等敏感意图，可能形成不利承诺。确定仍要保存为「全自动」？',
    )
    if (!ok) throw new Error('已取消保存全自动')
  }
  const batchRaw = parseInt($('msgBatchSize')?.value || '5')
  const batchSize = Number.isFinite(batchRaw) ? Math.max(1, Math.min(20, batchRaw)) : 5
  const config: MessageAssistConfig = {
    enabled: true,
    autonomy: autonomy || 'graded',
    batchSize,
  }
  const r = await send({ type: 'messageAssist/set', config })
  if (r.type === 'error') throw new Error(r.error)
  live.messageAssistConfig = config
  return config
}

function fillMessageAssist(cfg: MessageAssistConfig | null | undefined) {
  if (!cfg) return
  const a = $('msgAutonomy')
  if (a) a.value = cfg.autonomy || 'graded'
  const b = $('msgBatchSize')
  if (b) b.value = String(cfg.batchSize ?? 5)
  const w = $('msg-full-auto-warn')
  if (w) w.hidden = (cfg.autonomy || 'graded') !== 'full_auto'
  live.messageAssistConfig = cfg
}

async function refreshMsgProgress() {
  const el = $('msg-progress')
  if (!el) return
  try {
    const e = await send({ type: 'messageAssist/progress' })
    if (e.type !== 'messageAssist/progress') {
      el.textContent = '消息循环：状态未知'
      return
    }
    if (e.active) {
      el.textContent = `消息循环：运行中 · 已处理 ${e.processed} · 剩余 ${e.remaining}${e.lastAction ? ' · ' + e.lastAction : ''}`
      el.className = 'status ok'
    } else {
      el.textContent = `消息循环：空闲 · 剩余 ${e.remaining}${e.stoppedReason ? ' · ' + e.stoppedReason : ''}${e.lastError ? ' · err ' + e.lastError : ''}`
      el.className = 'status'
    }
  } catch {
    el.textContent = '消息循环：读取失败'
  }
}

async function refreshHandoffList() {
  const el = $('handoff-list')
  if (!el) return
  try {
    const e = await send({ type: 'handoff/list' })
    if (e.type !== 'handoff/list') {
      el.innerHTML = '<div>读取失败</div>'
      return
    }
    if (!e.items.length) {
      el.innerHTML = '<div>（暂无待人工）</div>'
      return
    }
    el.innerHTML = e.items
      .map((it) => {
        const who = [it.company, it.jobTitle].filter(Boolean).join(' · ') || it.id
        const reason = it.reason || '需人工'
        const t = it.lastActionAt ? new Date(it.lastActionAt).toLocaleString() : ''
        return `<div data-handoff-id="${v(it.id)}" style="display:flex;flex-direction:column;gap:4px;padding:6px 0;border-bottom:1px solid var(--border,#2a3548)">
          <div><b>${v(who)}</b></div>
          <div class="sub">${v(reason)}${t ? ' · ' + v(t) : ''}</div>
          <div class="btn-row">
            <button type="button" class="secondary" data-handoff-open="${v(it.id)}">打开并定位</button>
            <button type="button" data-handoff-done="${v(it.id)}">已处理</button>
          </div>
        </div>`
      })
      .join('')
    el.querySelectorAll('[data-handoff-done]').forEach((btn: Element) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).getAttribute('data-handoff-done')
        if (!id) return
        try {
          const r = await send({ type: 'handoff/resolve', threadId: id, next: 'done' })
          if (r.type === 'handoff/resolve' && r.ok) i('已标记处理完成', 'ok')
          else i('标记失败（可能已不在待办）', 'err')
          await refreshHandoffList()
        } catch (err) {
          i(err instanceof Error ? err.message : String(err), 'err')
        }
      })
    })
    el.querySelectorAll('[data-handoff-open]').forEach((btn: Element) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).getAttribute('data-handoff-open')
        if (!id) return
        try {
          i('正在打开消息页并定位会话…')
          const r = await send({ type: 'handoff/open', threadId: id })
          if (r.type !== 'handoff/open') throw new Error('打开失败')
          if (!r.ok) throw new Error(r.error || '打开失败')
          if (r.located) i('已打开并定位到会话', 'ok')
          else i('已打开消息页（信息不足，请手动点开会话）', 'ok')
        } catch (err) {
          i(err instanceof Error ? err.message : String(err), 'err')
        }
      })
    })
  } catch {
    el.innerHTML = '<div>读取失败</div>'
  }
}

async function w(): Promise<Policy> {
  // 高级区用秒输入 → 存 ms
  const minSecRaw = $('minIntervalSec')?.value?.trim() ?? ''
  const maxSecRaw = $('maxIntervalSec')?.value?.trim() ?? ''
  const minSec = minSecRaw === '' ? NaN : Number(minSecRaw)
  const maxSec = maxSecRaw === '' ? NaN : Number(maxSecRaw)
  const minIntervalMs = Number.isFinite(minSec) && minSec >= 0 ? Math.round(minSec * 1000) : undefined
  const maxIntervalMs = Number.isFinite(maxSec) && maxSec >= 0 ? Math.round(maxSec * 1000) : undefined
  if ($('minInterval')) $('minInterval').value = minIntervalMs != null ? String(minIntervalMs) : ''
  if ($('maxInterval')) $('maxInterval').value = maxIntervalMs != null ? String(maxIntervalMs) : ''

  const matchMode = ($('matchMode')!.value as any) || 'balanced'
  const riskProfile = ($('riskProfile')!.value as any) || 'conservative'
  if (matchMode === 'keywords_only') {
    const ok = window.confirm(
      '「仅关键词」可能放大误投（字面命中≠方向匹配）。确定保存？',
    )
    if (!ok) throw new Error('已取消保存仅关键词模式')
  }
  if (riskProfile === 'aggressive') {
    const ok = window.confirm(
      '激进档日上限更高、拟真较弱，封号风险显著上升。确定保存？',
    )
    if (!ok) throw new Error('已取消保存激进档')
  }

  const policy: Policy = {
    enabled: $('enabled')!.checked,
    followUpInJobRun: $('followUpInJobRun')?.checked === true ? true : undefined,
    dailyOpenChatLimit: parseInt($('dailyLimit')!.value) || undefined,
    dailyReplyLimit: parseInt($('replyLimit')!.value) || undefined,
    minIntervalMs,
    maxIntervalMs,
    sessionMaxOpenChat: parseInt($('sessionMaxOpenChat')!.value) || undefined,
    sessionMaxReplies: parseInt($('sessionMaxReplies')!.value) || undefined,
    matchMinKeywordHits: parseInt($('matchMinKeywordHits')!.value) || 2,
    matchMode,
    minMatchScore: normalizeMinMatchScore($('minMatchScore')!.value),
    excludeKeywords: normalizeExcludeKeywords($('excludeKeywords')!.value),
    expectCities: normalizeExpectCities($('expectCities')!.value),
    minSalaryK: normalizeMinSalaryK($('minSalaryK')!.value),
    maxYearsGap: normalizeMaxYearsGap($('maxYearsGap')!.value),
    riskProfile,
  }
  const r = await send({ type: 'kv/set', policy })
  if (r.type === 'error') throw new Error(r.error)
  return policy
}

async function b() {
  const llm = {
    baseUrl: $('baseUrl')!.value.trim(),
    apiKey: $('apiKey')!.value.trim(),
    model: $('model')!.value.trim()
  }
  const r = await send({ type: 'kv/set', llm })
  if (r.type === 'error') throw new Error(r.error)
}

async function B() {
  const e = $('profileSummary')!.value
  const t = $('profileSkills')!.value.split(/[,，]/).map((p: string) => p.trim()).filter(Boolean)
  const n = $('profileHighlights')!.value.split(/\n/).map((p: string) => p.trim()).filter(Boolean)
  const l = await send({ type: 'kv/get' })
  const a = l.type === 'kv/get' ? l.profile : null
  const o: Profile = {
    syncedAt: Date.now(),
    summary: e,
    skills: t,
    highlights: n.length ? n : live.profileExtra.highlights,
    rawText: live.profileExtra.rawText ?? (a?.rawText ?? ''),
    years: live.profileExtra.years ?? (a?.years ?? ''),
    education: live.profileExtra.education ?? (a?.education ?? ''),
    expectRoles: live.profileExtra.expectRoles ?? (a?.expectRoles ?? []),
    analyzedByLlm: live.profileExtra.analyzedByLlm ?? (a?.analyzedByLlm ?? false)
  }
  const c = await send({ type: 'kv/set', profile: o })
  if (c.type === 'error') throw new Error(c.error)
  live.profileSyncedAt = o.syncedAt
  live.profileExtra = { rawText: o.rawText, years: o.years, education: o.education, expectRoles: o.expectRoles, highlights: o.highlights, analyzedByLlm: o.analyzedByLlm }
  L()
}

function m(e: string) {
  const t = $(e)
  if (!t) return
  const v = t.value
  if (!v || v === '') return undefined
  const n = Number(v)
  if (Number.isFinite(n)) return n
  return undefined
}

function v(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function K() {
  try {
    O()
    applyDocumentTheme('dark')
    const tab = (sessionStorage['boss.sidepanel.tab'] || savedTab || 'run') as
      | 'run'
      | 'msg'
      | 'policy'
      | 'setup'
    applyTab(tab)
    await k()
    await y(false)
    h = setInterval(() => { if (!u) void y(); }, 5000)
    i('侧栏已加载', 'ok')
  } catch (e) {
    i(e instanceof Error ? e.message : String(e), 'err')
    if (g) g.innerHTML += `<p style="color:#f44;margin-top:12px">初始化失败：${e instanceof Error ? e.message : String(e)}</p>`
  }
}

document.addEventListener('keydown', e => {
  const action = matchSidepanelShortcut(e as any)
  if (action === 'tab-run') applyTab('run')
  else if (action === 'tab-msg') applyTab('msg')
  else if (action === 'tab-policy') applyTab('policy')
  else if (action === 'tab-setup') applyTab('setup')
  else if (action === 'refresh') y()
  else if (action === 'save-policy') {
    const btn = $('btn-save-policy')
    if (btn) btn.click()
  }
  else if (action === 'export-csv') {
    const btn = $('btn-export-csv') as HTMLButtonElement | null
    if (btn) btn.click()
    else {
      i('导出 CSV 功能未完整实现，请刷新页面', 'err')
    }
  }
})

function applyTab(id: 'run' | 'msg' | 'policy' | 'setup') {
  sessionStorage['boss.sidepanel.tab'] = id
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === id)
  })
  document.querySelectorAll('.tab-panel').forEach(p => {
    (p as HTMLElement).hidden = p.id !== `panel-${id}`
  })
  if (id === 'run') y(false)
  else if (id === 'msg') {
    send({ type: 'messageAssist/get' }).then(res => {
      if (res.type === 'messageAssist/get') fillMessageAssist(res.config)
    })
    void refreshMsgProgress()
    void refreshHandoffList()
  }
}

async function send<T extends ResponseMessage>(msg: any): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as T | undefined
  return requireMessageResponse(res) as T
}

const g = document.getElementById('app')!
const savedTab = sessionStorage['boss.sidepanel.tab'] || 'run'
K()
