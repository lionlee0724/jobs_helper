// @vitest-environment jsdom
/**
 * DOM 回归：锁住 2026-07 实页探针证实的三类缺陷。
 *
 * 结构全部抄自探针报告（boss-selector-probe-*.json），不是臆造的样例：
 * - detail: div.detail-box.job-primary > ... > div.btn.btn-startchat-wrap > a.btn[ka=go_chat_*]
 * - list:   a.op-btn.op-btn-chat[ka=cpc_job_list_chat_*] 与 a.link-wechat-share[ka=job_detail_wechat_share]
 * - chat:   button.btn-v2.btn-sure-v2.btn-send 与 div.toolbar-btn（发简历/换电话/换微信）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SELECTORS,
  OPEN_CHAT_BTN_SELECTORS,
  RESUME_CONFIRM_SELECTORS,
  JOB_TITLE_SELECTORS,
  firstByOrderedSelectors,
  resolveClickTarget,
  isRoughlyVisible,
} from '../../extension/content/adapter/boss/selectors'
import {
  clickOpenChat,
  checkOpenChatProgress,
} from '../../extension/content/adapter/boss/detail'

// 注：jsdom 29 会拒绝带 `view` 的 MouseEvent/PointerEvent 构造（连其自身 realm 的
// window 也不接受），因此不在此处测事件派发链路；改为直接回归「点击目标
// 如何被决定」这一缺陷所在的纯判定。

/** jsdom 无布局：给需要"可见"的节点打上非零尺寸 */
function makeVisible(el: Element) {
  el.getBoundingClientRect = () =>
    ({ width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }) as DOMRect
}

function markAllVisible(root: ParentNode = document) {
  for (const el of Array.from(root.querySelectorAll('*'))) makeVisible(el)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('openChatBtn — 禁止命中微信分享（ka*="chat" 会匹配 weCHATshare）', () => {
  beforeEach(() => {
    // 注意 DOM 序：分享链接在前，沟通按钮在后
    document.body.innerHTML = `
      <div class="job-detail-operate">
        <div><a class="link-wechat-share" ka="job_detail_wechat_share">微信扫码分享</a></div>
      </div>
      <div class="job-detail-header">
        <div class="job-detail-op clearfix">
          <a class="op-btn op-btn-chat" ka="cpc_job_list_chat_d7cfa982">立即沟通</a>
        </div>
      </div>`
    markAllVisible()
  })

  it('旧的 a[ka*="chat"] 确实会误命中微信分享（缺陷存在性证明）', () => {
    const wrong = document.querySelector('a[ka*="chat"]')
    expect(wrong?.textContent).toBe('微信扫码分享')
  })

  it('新选择器集合不含 ka*="chat" 通配', () => {
    expect(OPEN_CHAT_BTN_SELECTORS.some((s) => s.includes('[ka*="chat"]'))).toBe(false)
  })

  it('按优先级取到的是「立即沟通」而非分享链接', () => {
    const el = firstByOrderedSelectors(
      document,
      OPEN_CHAT_BTN_SELECTORS,
      isRoughlyVisible,
    )
    expect(el?.textContent).toBe('立即沟通')
  })
})

describe('openChatBtn — 独立详情页应取 wrapper 内的 <a> 而非 wrapper 本身', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="detail-box job-primary">
        <div class="inner">
          <div><div class="btn btn-startchat-wrap"><a class="btn" ka="go_chat_done_490760040">立即沟通</a></div></div>
        </div>
      </div>`
    markAllVisible()
  })

  it('取到 <a> 元素', () => {
    const el = firstByOrderedSelectors(
      document,
      OPEN_CHAT_BTN_SELECTORS,
      isRoughlyVisible,
    )
    expect(el?.tagName).toBe('A')
    expect(el?.textContent).toBe('立即沟通')
  })
})

describe('clickOpenChat — 后台 tab 零尺寸按钮仍应可点', () => {
  beforeEach(() => {
    // 模拟后台详情 tab：节点在 DOM 里，但 getBoundingClientRect 全 0
    document.body.innerHTML = `
      <div class="detail-box job-primary">
        <div class="btn btn-startchat-wrap">
          <a class="btn" ka="go_chat_done_x" id="chat-btn">立即沟通</a>
        </div>
      </div>`
    // 故意不 markAllVisible：默认 jsdom rect 为 0 → isRoughlyVisible=false
  })

  it('候选不为 0，并能点击', () => {
    const r = clickOpenChat()
    expect(r.candidates).toBeGreaterThan(0)
    expect(r.ok).toBe(true)
    expect(r.clicked?.text).toMatch(/立即沟通/)
  })
})

describe('safeClick — 默认不得把点击重定向到职位卡容器', () => {
  beforeEach(() => {
    // 与详情页一致：立即沟通位于 .job-primary 容器内
    document.body.innerHTML = `
      <div class="detail-box job-primary" id="card">
        <div class="btn btn-startchat-wrap"><a class="btn" id="btn">立即沟通</a></div>
      </div>`
    markAllVisible()
  })

  it('默认：点击目标就是按钮自身', () => {
    const btn = document.getElementById('btn')!
    expect(resolveClickTarget(btn).id).toBe('btn')
  })

  it('该按钮确实存在卡片祖先（旧实现会被重定向）', () => {
    const btn = document.getElementById('btn')!
    expect(resolveClickTarget(btn, { resolveCard: true }).id).toBe('card')
  })
})

describe('resumeConfirm — 无弹框时不得命中聊天「发送」按钮', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="chat-im"><div><div id="chat-input" contenteditable="true"></div></div></div>
      <div class="chat-op">
        <button class="btn-v2 btn-sure-v2 btn-send disabled">发送</button>
      </div>`
    markAllVisible()
  })

  it('旧的裸 .btn-sure-v2 确实命中发送按钮（缺陷存在性证明）', () => {
    const wrong = document.querySelector('.btn-sure-v2')
    expect(wrong?.textContent).toBe('发送')
  })

  it('新集合不含裸 .btn-sure-v2，且无弹框时无命中', () => {
    expect(RESUME_CONFIRM_SELECTORS.includes('.btn-sure-v2')).toBe(false)
    const found = firstByOrderedSelectors(
      document,
      RESUME_CONFIRM_SELECTORS,
      isRoughlyVisible,
    )
    expect(found).toBeNull()
  })

  it('真有弹框时能命中确认按钮', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div class="dialog-container"><div class="btns">
         <span class="btn-v2 btn-sure-v2">确定</span>
       </div></div>`,
    )
    markAllVisible()
    const found = firstByOrderedSelectors(
      document,
      RESUME_CONFIRM_SELECTORS,
      isRoughlyVisible,
    )
    expect(found?.textContent).toBe('确定')
  })
})

describe('jobTitle — 不得取到含薪资的 wrapper', () => {
  beforeEach(() => {
    // 实页结构：div.job-title.clearfix > a.job-name + span.job-salary
    document.body.innerHTML = `
      <li class="job-card-box"><div class="job-info">
        <div class="job-title clearfix">
          <a class="job-name">精装修技术负责人</a><span class="job-salary">-K</span>
        </div>
      </div></li>`
    markAllVisible()
  })

  it('逗号列表按 DOM 序会取到 wrapper（缺陷存在性证明）', () => {
    const el = document.querySelector(SELECTORS.jobTitle)
    expect(el?.className).toContain('job-title')
    expect(el?.textContent?.replace(/\s+/g, '')).toBe('精装修技术负责人-K')
  })

  it('按优先级取到 a.job-name，标题不含薪资', () => {
    const el = firstByOrderedSelectors(document, JOB_TITLE_SELECTORS)
    expect(el?.tagName).toBe('A')
    expect(el?.textContent).toBe('精装修技术负责人')
  })
})

describe('sendResumeBtn — 不得因裸 .toolbar-btn 误点换电话/换微信', () => {
  beforeEach(() => {
    // DOM 序：发简历在最后，换电话/换微信在前
    document.body.innerHTML = `
      <div class="toolbar-btn-content">
        <div class="toolbar-btn tooltip">换电话</div>
        <div class="toolbar-btn tooltip">换微信</div>
        <div class="toolbar-btn tooltip">发简历</div>
      </div>`
    markAllVisible()
  })

  it('选择器集合已移除裸 .toolbar-btn', () => {
    expect(SELECTORS.sendResumeBtn.split(',')).not.toContain('.toolbar-btn')
  })

  it('旧的裸 .toolbar-btn 会先命中换电话（缺陷存在性证明）', () => {
    expect(document.querySelector('.toolbar-btn')?.textContent).toBe('换电话')
  })

  it('窄选择器在该结构下无命中，须由文案兑现兜底', () => {
    expect(document.querySelector(SELECTORS.sendResumeBtn)).toBeNull()
  })
})

describe('checkOpenChatProgress — 校验开聊多维判定', () => {
  it('当按钮文案变为「继续沟通」时，立即判为成功', () => {
    document.body.innerHTML = `
      <div class="job-detail-op">
        <a class="op-btn op-btn-chat btn-continue">继续沟通</a>
      </div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.via).toBe('button_state_changed')
      expect(res.detail).toMatch(/继续沟通/)
    }
  })

  it('当页面出现打招呼成功 Toast 时判为成功', () => {
    document.body.innerHTML = `
      <div class="boss-toast">已向Boss发送打招呼语</div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('success')
    if (res.status === 'success') {
      expect(res.via).toBe('toast_success')
    }
  })

  it('当页面出现今日打招呼已达上限时返回明确错误并终止', () => {
    document.body.innerHTML = `
      <div class="toast-text">今日打招呼已达上限，请明天再来</div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('failed')
    if (res.status === 'failed') {
      expect(res.error).toMatch(/今日打招呼已达 BOSS 平台上限/)
      expect(res.terminal).toBe(true)
    }
  })

  it('当页面出现打招呼确认弹窗时自动点击确认', () => {
    document.body.innerHTML = `
      <div class="dialog-container">
        <div class="dialog-title">与TA沟通</div>
        <div class="dialog-footer">
          <button class="btn-sure-v2">立即发送</button>
        </div>
      </div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('pending')
  })

  it('当页面存在普通安全中心页脚时不会误判为安全验证', () => {
    document.body.innerHTML = `
      <div class="job-detail-box">
        <a class="btn btn-startchat">立即沟通</a>
      </div>
      <div class="footer">
        <a href="#">网络安全与安全中心</a>
        <a href="#">请先登录查看更多</a>
      </div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('pending')
  })

  it('当页面出现真实可见的验证码时正确识别安全验证', () => {
    document.body.innerHTML = `
      <div class="geetest_panel geetest_holder">
        <div class="geetest_slider"></div>
      </div>`
    markAllVisible()
    const res = checkOpenChatProgress()
    expect(res.status).toBe('failed')
    if (res.status === 'failed') {
      expect(res.error).toMatch(/安全验证/)
      expect(res.terminal).toBe(true)
    }
  })
})
