import type { ContentCommand, ContentResult } from '../shared/messages'
import {
  listJobsFromDom,
  openJob,
  urlForSource,
  detectSourceFromUrl,
  selectListTabByLabel,
  readActiveListTabLabel,
  listCategoryTabs,
} from './adapter/boss/list'
import {
  extractJobDetail,
  clickOpenChat,
  isRealJobDetailHref,
  checkOpenChatProgress,
} from './adapter/boss/detail'
import { scrapeResumePage, profilePageUrl } from './adapter/boss/profile'
import { probeSelectors } from './adapter/boss/probe'
import { simulateReading, waitIn } from './humanize'
import {
  readPeerMessages,
  sendText,
  sendResume,
  chatPageUrl,
  listChatSessions,
  openChatSession,
  readActiveChatContext,
  detectAuthState,
} from './adapter/boss/chat'

export async function execCommand(cmd: ContentCommand): Promise<ContentResult> {
  try {
    switch (cmd.op) {
      case 'ping':
        return { ok: true, data: { href: location.href, title: document.title } }

      case 'detect_page': {
        const listTab = readActiveListTabLabel() || null
        const listTabs = listCategoryTabs()
        return {
          ok: true,
          data: {
            href: location.href,
            source: detectSourceFromUrl(),
            listTab,
            listTabs,
            auth: detectAuthState(),
          },
        }
      }

      case 'select_list_tab': {
        const r = selectListTabByLabel(cmd.label)
        if (!r.ok) return { ok: false, error: r.error || '切换分类失败' }
        await sleep(1200)
        return { ok: true, data: { matched: r.matched } }
      }

      case 'sync_profile': {
        const scrape = scrapeResumePage()
        if (!scrape.rawText || scrape.charCount < 80) {
          return {
            ok: false,
            error: `简历文本过短（${scrape.charCount} 字）。请确认已打开在线简历页并登录，或手动滚动加载完整内容后重试。`,
          }
        }
        return {
          ok: true,
          data: {
            syncedAt: Date.now(),
            summary: '',
            skills: [] as string[],
            rawText: scrape.rawText,
            analyzedByLlm: false,
            _meta: { href: scrape.href, charCount: scrape.charCount },
          },
        }
      }

      case 'goto_source': {
        const url = urlForSource(cmd.source)
        if (!location.href.startsWith(url.split('?')[0])) {
          location.href = url
          return { ok: true, data: { navigating: true, url } }
        }
        return { ok: true, data: { navigating: false, url } }
      }

      case 'goto_chat': {
        if (!location.href.includes('/chat')) {
          location.href = chatPageUrl()
          return { ok: true, data: { navigating: true } }
        }
        return { ok: true, data: { navigating: false } }
      }

      case 'goto_job_detail': {
        // 禁止伪造 /job_detail/{id}.html；只有列表卡片上的真实链接才跳
        const url = isRealJobDetailHref(cmd.href) ? cmd.href! : null
        if (!url) {
          return {
            ok: false,
            error: `无真实详情链接，拒绝跳转伪造 URL（jobId=${cmd.jobId}）`,
          }
        }
        if (location.href.includes(cmd.jobId) && /job_detail\//i.test(location.href)) {
          return { ok: true, data: { navigating: false, url } }
        }
        location.href = url
        return { ok: true, data: { navigating: true, url } }
      }

      case 'list_jobs': {
        const cards = listJobsFromDom(cmd.source)
        return { ok: true, data: cards }
      }

      case 'open_job': {
        const r = openJob(cmd.jobId, cmd.href)
        if (!r.ok) return { ok: false, error: r.error || `未找到职位 ${cmd.jobId}` }
        if (r.navigating) {
          // 整页跳转：由 SW 等待后再 extract
          return { ok: true, data: { navigating: true } }
        }
        // 右侧抽屉渲染
        await sleep(1800)
        return { ok: true, data: { navigating: false } }
      }

      case 'extract_job_detail': {
        let detail = extractJobDetail()
        if (detail.deadPage) {
          return {
            ok: false,
            error: `当前是无效/404/验证页，放弃抽取（href=${location.href.slice(0, 100)}）`,
          }
        }
        for (let i = 0; i < 6 && (!detail.desc || detail.desc.length < 40); i++) {
          await sleep(600)
          detail = extractJobDetail()
          if (detail.deadPage) {
            return {
              ok: false,
              error: `当前是无效/404/验证页，放弃抽取（href=${location.href.slice(0, 100)}）`,
            }
          }
        }
        if (!detail.desc || detail.desc.length < 30) {
          const d = detail.debug
          return {
            ok: false,
            error: `职位描述过短（len=${detail.desc?.length ?? 0}, root=${d?.rootFound}, class=${d?.rootClass || '-'}, href=${d?.href || location.href.slice(0, 80)}）`,
          }
        }
        return { ok: true, data: detail }
      }

      case 'open_chat': {
        // 已在聊天页：匹配后详情 tab 偶发被站内重定向到 /web/geek/chat
        // （已沟通过 / 站内路由）。此时没有「立即沟通」，应按已开聊成功。
        // URL 已是 geek/chat 即视为会话面；UI 选择器随改版可能滞后，不再强依赖。
        if (/\/web\/geek\/chat/i.test(location.href)) {
          return {
            ok: true,
            data: {
              via: 'already_on_chat',
              href: location.href.slice(0, 160),
            },
          }
        }

        // 先「读」再点：打开职位即刻点开聊是明显的机器行为
        await simulateReading(cmd.timing)
        await waitIn(cmd.timing?.preClickMs)
        let r = clickOpenChat()
        if (!r.ok) {
          await sleep(900)
          r = clickOpenChat()
        }
        // 后台 tab 布局延迟：再等一轮
        if (!r.ok && r.candidates === 0) {
          await sleep(1200)
          r = clickOpenChat()
        }
        if (!r.ok) {
          return {
            ok: false,
            error: `开聊点击失败：${r.error}（候选=${r.candidates}，href=${location.href.slice(0, 120)}）`,
          }
        }

        // 校验真的进了会话：综合检测 URL 导航、聊天 UI、状态变更（继续沟通）、Toast 提示及平台限制
        const deadline = Date.now() + 6500
        let reclicked = false
        while (Date.now() < deadline) {
          await sleep(250)
          const check = checkOpenChatProgress()
          if (check.status === 'success') {
            return {
              ok: true,
              data: {
                via: check.via,
                detail: check.detail,
                clicked: r.clicked,
              },
            }
          }
          if (check.status === 'failed') {
            return {
              ok: false,
              error: check.error,
            }
          }
          // 若 2s 后仍处于 pending，可能是首击被页面框架初始化阻断，进行二次安全点击
          if (!reclicked && Date.now() > deadline - 4500) {
            reclicked = true
            clickOpenChat()
          }
        }

        // 超时前做最后一次检查
        const lastCheck = checkOpenChatProgress()
        if (lastCheck.status === 'success') {
          return {
            ok: true,
            data: {
              via: lastCheck.via,
              detail: lastCheck.detail,
              clicked: r.clicked,
            },
          }
        }
        if (lastCheck.status === 'failed') {
          return { ok: false, error: lastCheck.error }
        }

        return {
          ok: false,
          error: `已点击「${r.clicked?.text || '立即沟通'}」(${r.clicked?.tag}.${r.clicked?.cls})，但未能检测到聊天界面、状态变更或成功提示（fail-closed）。`,
        }
      }

      case 'list_chat_sessions': {
        const sessions = listChatSessions()
        return { ok: true, data: sessions }
      }

      case 'open_chat_session': {
        const r = openChatSession(cmd.match)
        if (!r.ok) return { ok: false, error: r.error }
        await sleep(1000)
        return { ok: true, data: { score: r.score, key: r.key } }
      }

      case 'read_peer_messages': {
        const msgs = readPeerMessages(cmd.limit ?? 10)
        return { ok: true, data: msgs }
      }

      case 'read_active_chat_context': {
        const ctx = readActiveChatContext()
        return { ok: true, data: ctx }
      }

      case 'send_text': {
        const r = await sendText(cmd.text, cmd.timing)
        if (!r.ok) return { ok: false, error: r.error || '发送失败' }
        return { ok: true, data: { verified: r.verified } }
      }

      case 'probe_selectors': {
        return { ok: true, data: probeSelectors() }
      }

      case 'send_resume': {
        const r = await sendResume()
        if (!r.ok) return { ok: false, error: r.error || '发简历失败' }
        return { ok: true }
      }

      default:
        return { ok: false, error: `未知命令` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export { profilePageUrl }
