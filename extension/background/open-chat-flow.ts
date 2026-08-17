/**
 * 环 A：职位列表匹配 + 临时详情 tab 开聊。
 */
import { type Job, type JobSource, type Profile } from '../shared/types'
import {
  canOpenMoreToday,
  canOpenMoreThisSession,
} from '../domain/policy'
import {
  canOpenMoreThisHour,
  nextIntervalMs,
  humanTiming,
} from '../domain/risk'
import { isProfileReady } from '../domain/profile'
import { normalizeJob } from '../domain/job'
import { buildMatchMessages, parseMatchResult } from '../domain/match-llm'
import {
  decideJobMatch,
  decisionToMatchResult,
  resolveMatchMode,
  resolveMinScore,
} from '../domain/match-decision'
import {
  MATCH_LLM_EXTRA_RETRIES,
  openChatRetryDelayMs,
} from '../domain/match-display'
import { chatCompletion } from './llm-client'
import * as kv from '../data/kv'
import { appendEvent } from '../data/repos/events'
import * as jobsRepo from '../data/repos/jobs'
import * as threadsRepo from '../data/repos/chat-threads'
import { getDaily } from '../data/repos/daily-stats'
import { detectSourceFromUrl } from '../shared/boss-urls'
import {
  BatchOutcome,
  MATCH_LLM_FAIL_CIRCUIT,
  bumpMatchLlmFailure,
  bumpSessionHardRejected,
  bumpSessionOpened,
  clearMatchLlmFailures,
  consecutiveMatchLlmFailures,
  getSessionCounters,
  isStillRunning,
  setPhase,
  sleep,
  sleepWhileRunning,
  stopRun,
} from './run-context'
import {
  clearAnomalyOnSuccess,
  detectAndPauseIfAuthLost,
  isContentBridgeDead,
} from './run-guards'
import {
  ensureOnListPage,
  execOnWorker,
  isRecommendish,
  resolveListUrl,
  sendToTabOnce,
  verifyListCategoryOrRestore,
  waitContentReady,
  waitTabComplete,
} from './tab-runtime'
import { syncProfileViaTab } from './profile-sync'

/** 环 A：取 1 个职位匹配并可能开聊 */
export async function runOpenChatBatch(
  workerTabId: number,
  gen: number,
): Promise<BatchOutcome> {
  if (!(await isStillRunning(gen))) return 'none'

  const policy = await kv.getPolicy()

  const daily = await getDaily()
  const cap = canOpenMoreToday(policy, daily.opened)
  if (!cap.ok) {
    await stopRun(cap.reason)
    return 'none'
  }

  const hourCap = canOpenMoreThisHour(policy, await kv.getHourlyOpened())
  if (!hourCap.ok) {
    await stopRun(`${hourCap.reason}（下一小时可继续）`)
    return 'none'
  }

  const { sessionOpened } = await getSessionCounters()
  const sessCap = canOpenMoreThisSession(policy, sessionOpened)
  if (!sessCap.ok) {
    await stopRun(sessCap.reason)
    return 'none'
  }

  let profile = await kv.getProfile()
  if (!isProfileReady(profile)) {
    await setPhase('sync_profile', gen)
    if (!(await isStillRunning(gen))) return 'none'
    profile = await syncProfileViaTab(workerTabId)
    if (!(await isStillRunning(gen))) return 'none'
    if (!isProfileReady(profile)) {
      await stopRun('简历未就绪：请打开 BOSS 简历页后点「同步简历」，或在侧栏粘贴摘要')
      return 'none'
    }
  }

  const state = await kv.getRunState()
  if (state.status !== 'running' || !(await isStillRunning(gen))) return 'none'

  // 锁定当前分类列表（启动时写入 cursor.listUrl）
  const listUrl = await resolveListUrl(workerTabId)
  const sourceForJob: JobSource = detectSourceFromUrl(listUrl)

  await setPhase('select_source', gen)
  const listLabel = state.cursor.listLabel
  // 已在列表页则绝不导航；离开列表才回锁定 URL，并点回分类标签
  const navOk = await ensureOnListPage(workerTabId, listUrl, gen, listLabel)
  if (!(await isStillRunning(gen))) return 'none'
  if (!navOk) {
    await appendEvent({
      type: 'error',
      payload: {
        error: '无法打开职位列表页 / content script 未就绪',
        op: 'goto_source',
        listUrl,
        listLabel,
      },
    })
    return 'soft_fail'
  }

  // 硬门闩：非推荐锁定时，list 前必须确认顶栏不在「推荐」
  if (listLabel && !isRecommendish(listLabel) && listLabel !== '当前职位列表') {
    const gate = await verifyListCategoryOrRestore(workerTabId, listLabel, gen)
    if (!gate.ok) {
      await appendEvent({
        type: 'error',
        payload: {
          op: 'list_category_gate',
          error: gate.error,
          label: listLabel,
          got: gate.got,
        },
      })
      // 不抓推荐列表，避免误投
      return 'soft_fail'
    }
  }

  await setPhase('next_job', gen)
  const listed = await execOnWorker(
    { op: 'list_jobs', source: sourceForJob },
    workerTabId,
    { gen, recoverUrl: listUrl },
  )
  if (!(await isStillRunning(gen))) return 'none'
  if (!listed.ok) {
    await appendEvent({ type: 'error', payload: { error: listed.error, op: 'list_jobs' } })
    return isContentBridgeDead(listed.error) ? 'soft_fail' : 'none'
  }

  const cards = (listed.data as Array<
    Partial<Job> & {
      id: string
      href?: string
      title?: string
      company?: string
      salary?: string
      city?: string
    }
  >) || []
  if (!cards.length) {
    await appendEvent({
      type: 'error',
      payload: {
        error: `列表为空（${state.cursor.listLabel || sourceForJob} · ${listUrl}）。请确认已登录且当前分类页有职位卡片。`,
        op: 'list_jobs',
      },
    })
    return 'none'
  }

  // 本 tick 内去重：同一 id / 同一标题公司只处理一次
  const seenIds = new Set<string>()
  const seenFps = new Set<string>()

  for (const card of cards) {
    if (!(await isStillRunning(gen))) return 'none'

    if (!card.id) continue
    if (seenIds.has(card.id)) continue
    seenIds.add(card.id)

    const fp = jobsRepo.jobFingerprint(card.title, card.company)
    if (fp !== 'fp:|' && seenFps.has(fp)) continue
    if (fp !== 'fp:|') seenFps.add(fp)

    // 已处理：opened / skipped / failed / 已有 match
    if (await jobsRepo.isHandled(card.id)) continue
    if (await jobsRepo.isHandledByFingerprint(card.title, card.company)) continue

    await setPhase('extract_jd', gen)
    if (!(await isStillRunning(gen))) return 'none'

    // 同 tab：extract → match → open_chat（列表 worker 不动）
    const processed = await processCardInEphemeralTab({
      card,
      gen,
      profile: profile!,
      policy,
      sourceForJob,
      listLabel: state.cursor.listLabel,
    })
    if (!(await isStillRunning(gen))) return 'none'

    // 开聊后确保列表仍在锁定分类
    await ensureOnListPage(workerTabId, listUrl, gen, listLabel)

    if (processed.kind === 'opened') return 'progress'
    if (processed.kind === 'paused') return 'none'
    // continue / soft errors → 下一张
  }

  return 'none'
}

type ProcessCardOutcome =
  | { kind: 'opened' }
  | { kind: 'continue' }
  | { kind: 'paused' }

/**
 * 同一临时详情 tab：extract → match →（若 suitable）open_chat → close。
 * 弱 JD（list-only）→ markSkipped，绝不 open_chat（R4/R5）。
 */
export async function processCardInEphemeralTab(opts: {
  card: {
    id: string
    href?: string
    title?: string
    company?: string
    salary?: string
    city?: string
  }
  gen: number
  profile: Profile
  policy: Awaited<ReturnType<typeof kv.getPolicy>>
  sourceForJob: JobSource
  listLabel?: string
}): Promise<ProcessCardOutcome> {
  const { card, gen, profile, policy, sourceForJob, listLabel } = opts

  const weakFromCard = () => {
    const weakDesc = [card.title, card.company, card.salary, card.city]
      .filter(Boolean)
      .join(' · ')
    if (weakDesc.length < 8) {
      return {
        ok: false as const,
        weak: false as const,
        error: '无详情链接且列表字段不足',
      }
    }
    return {
      ok: true as const,
      weak: true as const,
      via: 'list_weak' as const,
      data: {
        desc: `（详情未打开，仅列表信息）${weakDesc}`,
        title: card.title,
        company: card.company,
        salary: card.salary,
        city: card.city,
      },
    }
  }

  const href = card.href
  const hasRealHref =
    Boolean(href) && /job_detail\//i.test(href!) && !/javascript:/i.test(href!)

  // R4：弱 JD 永不 open_chat — 无真实详情时直接 skip
  if (!hasRealHref) {
    const weak = weakFromCard()
    await jobsRepo.upsertJobSeen(
      normalizeJob({
        id: card.id,
        title: card.title || '未知',
        company: card.company || '未知',
        salary: card.salary,
        city: card.city,
        desc: weak.ok
          ? weak.data.desc
          : `（无法打开详情）${[card.title, card.company].filter(Boolean).join(' · ')}`,
        source: sourceForJob,
      }),
    )
    await jobsRepo.markSkipped(card.id, '弱 JD（无详情），跳过开聊')
    await appendEvent({
      type: 'job_skipped',
      jobId: card.id,
      payload: { reason: 'weak_jd_no_detail', listLabel },
    })
    return { kind: 'continue' }
  }

  let detailTabId: number | undefined
  try {
    const tab = await chrome.tabs.create({ url: href!, active: false })
    detailTabId = tab.id
    if (detailTabId == null) {
      await jobsRepo.markSkipped(card.id, '无法创建详情标签')
      return { kind: 'continue' }
    }

    await waitTabComplete(detailTabId, 20_000)
    await sleep(900)
    if (!(await isStillRunning(gen))) return { kind: 'continue' }

    // 详情 tab 也检测 auth
    if (await detectAndPauseIfAuthLost(detailTabId, gen)) {
      return { kind: 'paused' }
    }

    let ready = await waitContentReady(detailTabId, 12_000, gen)
    if (!ready) {
      await sleep(1200)
      ready = await waitContentReady(detailTabId, 8_000, gen)
      if (!ready) {
        await jobsRepo.upsertJobSeen(
          normalizeJob({
            id: card.id,
            title: card.title || '未知',
            company: card.company || '未知',
            salary: card.salary,
            city: card.city,
            desc: `（详情 content 未就绪）${[card.title, card.company].filter(Boolean).join(' · ')}`,
            source: sourceForJob,
          }),
        )
        await jobsRepo.markSkipped(card.id, '详情页 content script 未就绪')
        return { kind: 'continue' }
      }
    }

    let detail = await sendToTabOnce(detailTabId, { op: 'extract_job_detail' })
    for (let i = 0; i < 4 && !detail.ok; i++) {
      if (!(await isStillRunning(gen))) return { kind: 'continue' }
      await sleep(700)
      detail = await sendToTabOnce(detailTabId, { op: 'extract_job_detail' })
    }
    if (!detail.ok && isContentBridgeDead(detail.error)) {
      await chrome.tabs.reload(detailTabId)
      await waitTabComplete(detailTabId, 15_000)
      await waitContentReady(detailTabId, 10_000, gen)
      detail = await sendToTabOnce(detailTabId, { op: 'extract_job_detail' })
    }

    // 抽取失败 / 描述过短 → 弱 JD，skip 不开聊
    const extractErr = detail.ok ? undefined : detail.error
    const d = detail.ok
      ? (detail.data as {
          desc: string
          title?: string
          company?: string
          salary?: string
          city?: string
        })
      : null
    if (!detail.ok || !d?.desc || d.desc.length < 30) {
      const weak = weakFromCard()
      const jobWeak = normalizeJob({
        id: card.id,
        title: (d?.title || card.title) || '未知',
        company: (d?.company || card.company) || '未知',
        salary: d?.salary || card.salary,
        city: d?.city || card.city,
        desc: weak.ok
          ? weak.data.desc
          : `（详情抽取失败）${[card.title, card.company].filter(Boolean).join(' · ')}`,
        source: sourceForJob,
      })
      await jobsRepo.upsertJobSeen(jobWeak)
      await appendEvent({
        type: 'job_seen',
        jobId: jobWeak.id,
        payload: {
          source: sourceForJob,
          title: jobWeak.title,
          descLen: jobWeak.desc.length,
          via: 'list_weak',
          listLabel,
          extractError: extractErr,
        },
      })
      await jobsRepo.markSkipped(
        card.id,
        extractErr || '弱 JD（详情不足），跳过开聊',
      )
      await appendEvent({
        type: 'job_skipped',
        jobId: card.id,
        payload: { reason: 'weak_jd', error: extractErr },
      })
      return { kind: 'continue' }
    }

    const job = normalizeJob({
      id: card.id,
      title: d.title || card.title || '未知',
      company: d.company || card.company || '未知',
      salary: d.salary || card.salary,
      city: d.city || card.city,
      desc: d.desc,
      source: sourceForJob,
    })

    await jobsRepo.upsertJobSeen(job)
    await appendEvent({
      type: 'job_seen',
      jobId: job.id,
      payload: {
        source: sourceForJob,
        title: job.title,
        descLen: job.desc.length,
        via: 'detail_tab',
        listLabel,
      },
    })

    if (!(await isStillRunning(gen))) return { kind: 'continue' }
    await setPhase('llm_match', gen)
    const llm = await kv.getLlmConfig()
    const mode = resolveMatchMode(policy)
    try {
      // keywords_only：省 LLM；其余模式先 LLM（可恢复错误重试 2 次；耗尽 → via=llm_error，无假分）
      let llmMatch: Awaited<ReturnType<typeof parseMatchResult>> | null = null
      let llmError: string | undefined
      if (mode !== 'keywords_only') {
        try {
          const raw = await chatCompletion(llm, buildMatchMessages(profile, job), {
            // 初试 + MATCH_LLM_EXTRA_RETRIES 次重试；退避约 1s / 2s
            retries: MATCH_LLM_EXTRA_RETRIES,
            retryBackoffMs: 1000,
          })
          if (!(await isStillRunning(gen))) return { kind: 'continue' }
          llmMatch = parseMatchResult(raw)
        } catch (e) {
          llmError = e instanceof Error ? e.message : String(e)
        }
      }

      const decision = decideJobMatch({
        profile,
        job,
        policy,
        llm: llmMatch,
        llmError,
        hardRules: {
          expectCities: policy.expectCities,
          minSalaryK: policy.minSalaryK,
          excludeKeywords: policy.excludeKeywords,
          maxYearsGap: policy.maxYearsGap,
        },
      })
      const match = decisionToMatchResult(decision)
      await jobsRepo.saveMatch(job.id, match, llm.model)
      const minScore = resolveMinScore(policy)

      // 熔断计数：仅 via=llm_error +1；其它匹配结论（含硬否/真低分/合适）清零
      let failCount = consecutiveMatchLlmFailures
      if (decision.via === 'llm_error') {
        failCount = bumpMatchLlmFailure()
      } else {
        clearMatchLlmFailures()
        failCount = 0
      }

      await appendEvent({
        type: 'job_matched',
        jobId: job.id,
        payload: {
          suitable: match.suitable,
          reasons: match.reasons,
          title: job.title,
          via: decision.via,
          // llm_error 不写假综合分
          ...(decision.score != null ? { score: decision.score } : {}),
          minScore,
          tier: decision.tier,
          keywordHitCount: decision.keywordHitCount,
          keywordHits: decision.keywordHits,
          llmScore: decision.llmScore,
          llmTier: decision.llmTier,
          hardRules: decision.hardRules,
          blockers: decision.blockers,
          matchMode: mode,
          consecutiveMatchLlmFailures: failCount,
        },
      })

      if (!match.suitable) {
        // 可解释跳过：llm_error / hard_reject / 低分 / 其它
        if (decision.via === 'hard_reject') {
          await bumpSessionHardRejected(gen)
        }
        const head = match.reasons[0] || ''
        const reasonSummary =
          decision.via === 'llm_error'
            ? `LLM失败${head ? '：' + head.replace(/^LLM 失败[：:]?\s*/, '') : ''}`.slice(0, 120)
            : decision.via === 'hard_reject'
              ? `硬否${head ? '：' + head : decision.hardRules?.length ? '：' + decision.hardRules.join(',') : ''}`.slice(
                  0,
                  120,
                )
              : decision.score != null && decision.score < minScore
                ? `低分：综合分 ${decision.score} < 最低分 ${minScore}${head ? ' · ' + head : ''}`.slice(0, 120)
                : `不合适${head ? '：' + head : `（via=${decision.via}）`}`.slice(0, 120)
        await appendEvent({
          type: 'job_skipped',
          jobId: job.id,
          payload: {
            via: decision.via,
            ...(decision.score != null ? { score: decision.score } : {}),
            minScore,
            tier: decision.tier,
            reasons: match.reasons,
            hardRules: decision.hardRules,
            keywordHitCount: decision.keywordHitCount,
            reasonSummary,
          },
        })

        if (failCount >= MATCH_LLM_FAIL_CIRCUIT) {
          await stopRun(
            `匹配 LLM 连续失败 ${failCount} 次，已暂停本轮。请侧栏「测试 LLM」确认连通后再开始。`,
          )
          return { kind: 'paused' }
        }
        return { kind: 'continue' }
      }

      // session + daily 双门闩
      await setPhase('rate_limit_wait', gen)
      const last = await kv.getLastOpenChatAt()
      const interval = nextIntervalMs(policy)
      const wait = Math.max(0, last + interval - Date.now())
      if (wait > 0) {
        const ok = await sleepWhileRunning(Math.min(wait, 60_000), gen)
        if (!ok) return { kind: 'continue' }
      }

      if (!(await isStillRunning(gen))) return { kind: 'continue' }
      const cap2 = canOpenMoreToday(policy, (await getDaily()).opened)
      if (!cap2.ok) {
        await stopRun(cap2.reason)
        return { kind: 'paused' }
      }
      const { sessionOpened } = await getSessionCounters()
      const sess2 = canOpenMoreThisSession(policy, sessionOpened)
      if (!sess2.ok) {
        await stopRun(sess2.reason)
        return { kind: 'paused' }
      }
      const hour2 = canOpenMoreThisHour(policy, await kv.getHourlyOpened())
      if (!hour2.ok) {
        await stopRun(`${hour2.reason}（下一小时可继续）`)
        return { kind: 'paused' }
      }

      // R5：同 tab open_chat — 最多 3 次（含退避），仍失败才 markFailed
      await setPhase('open_chat', gen)
      const timing = humanTiming(policy)
      const maxOpenAttempts = 3
      let chat: { ok: true; data?: unknown } | { ok: false; error: string } = {
        ok: false,
        error: '未尝试',
      }
      for (let attempt = 0; attempt < maxOpenAttempts; attempt++) {
        if (!(await isStillRunning(gen))) return { kind: 'continue' }
        if (attempt > 0) {
          const delay = openChatRetryDelayMs(attempt)
          const okWait = await sleepWhileRunning(delay, gen)
          if (!okWait) return { kind: 'continue' }
        }
        chat = await sendToTabOnce(detailTabId, { op: 'open_chat', timing })
        if (chat.ok) break
      }
      if (!chat.ok) {
        const err = chat.error || 'open_chat 失败'
        await jobsRepo.markFailed(job.id, err)
        await appendEvent({
          type: 'error',
          jobId: job.id,
          payload: {
            error: err,
            op: 'open_chat',
            attempts: maxOpenAttempts,
            matchScore: match.score,
            suitable: true,
          },
        })
        return { kind: 'continue' }
      }
      await sleep(800)

      await jobsRepo.markOpened(job.id)
      await kv.setLastOpenChatAt(Date.now())
      await kv.bumpHourlyOpened()
      await bumpSessionOpened(gen)
      // 成功完成一次开聊 → 重置连续异常计数
      await clearAnomalyOnSuccess()
      await appendEvent({
        type: 'chat_open',
        jobId: job.id,
        payload: { title: job.title },
      })
      await threadsRepo.upsertThread({
        id: `job:${job.id}`,
        jobId: job.id,
        company: job.company,
        jobTitle: job.title,
        status: 'active',
        lastActionAt: Date.now(),
      })
      return { kind: 'opened' }
    } catch (e) {
      if (!(await isStillRunning(gen))) return { kind: 'continue' }
      const msg = e instanceof Error ? e.message : String(e)
      await appendEvent({
        type: 'error',
        jobId: job.id,
        payload: { error: msg, op: 'llm_match' },
      })
      await jobsRepo.markSkipped(job.id, `匹配失败：${msg}`.slice(0, 120))
      return { kind: 'continue' }
    }
  } catch (e) {
    await appendEvent({
      type: 'error',
      jobId: card.id,
      payload: {
        error: e instanceof Error ? e.message : String(e),
        op: 'processCardInEphemeralTab',
      },
    })
    return { kind: 'continue' }
  } finally {
    if (detailTabId != null) {
      try {
        await chrome.tabs.remove(detailTabId)
      } catch {
        /* 用户可能已手动关 */
      }
    }
  }
}
