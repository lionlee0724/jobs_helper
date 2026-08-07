# BOSS 本地求职 Chrome 扩展 — Design Spec

Date: `2026-07-20`  
Status: `approved`  
Approved-at: `2026-07-20` (user: 批准spec)  
Project root: `e:\coding\Jobs`

## 0. Aegis Visibility

中高复杂度新产品：跨页面自动化、MV3 后台生命周期、LLM 合同、聊天动作识别。  
先钉规格再实现，避免把「海投脚本」或「纯分析工具」做成错误 owner。

## 1. Task Intent

### Outcome

在本机 Chrome 中提供 **BOSS 直聘求职副驾驶扩展**：基于 BOSS 简历与职位 JD，用 LLM 判断是否合适，并在限速策略下自动开聊与跟进；用户切到其他标签或 Chrome 不在前台时，**只要 Chrome 进程仍在且扩展持有的 BOSS 工作标签仍存活，任务继续执行**。

### Success evidence

1. 可从 `chrome://extensions` 加载未打包扩展并配置 OpenAI 兼容 API。
2. 用户填写限速参数并启动后，在 **非 BOSS 前台标签** 下仍能继续处理职位队列。
3. 对 LLM 判定合适的职位：点击立即沟通，首条为 BOSS 默认招呼。
4. 对方消息若识别为「请发简历」：执行平台发简历动作（非纯文本假装）。
5. 其他对方消息：LLM 生成回复并发送。
6. 未配置日上限/间隔时无法启动自动执行；验证码/登录失效时进入暂停。

### Stop condition

v1 可加载、可配置、主状态机跑通（开聊 + 聊天跟进最小闭环）；页面适配器允许后续随改版迭代。

### Non-goals (v1)

- Electron / Puppeteer 桌面端、Python 批量脚本、油猴脚本
- 已读不回「刷存在感」策略（可后续加）
- 多招聘站点
- 本地硬过滤引擎替代 BOSS 列表筛选
- Chrome **完全退出** 后仍运行（操作系统级后台守护）
- 无用户配置的默认海投数字

## 2. Confirmed Requirements

| ID | Requirement |
|----|-------------|
| R1 | 形态：Chrome 扩展 MV3，纯扩展（无强制本机 Node 服务） |
| R2 | 模式：限速全自动（可配；默认关闭且未填参数不可跑） |
| R3 | 匹配：LLM 为主 |
| R4 | 画像：从 BOSS 简历页同步，扩展内可编辑/缓存 |
| R5 | 职位池：推荐 + 两个求职期望，共三个列表分类 |
| R6 | v1 不做独立本地硬过滤；依赖 BOSS 列表与平台筛选 |
| R7 | LLM：OpenAI 兼容（baseURL + key + model） |
| R8 | 开聊首条：BOSS 默认招呼 |
| R9 | **后台执行**：启动后不依赖 Chrome 前台窗口、不依赖当前激活标签为 BOSS |
| R10 | **聊天跟进**：识别「请发简历」→ 触发发简历动作；其他消息由 LLM 组织话术并发送 |
| R11 | 限速参数用户自填；默认不启用自动跑 |
| R12 | **轻量本地库**：可查询事件/职位结果，支持统计与简单分析（非仅 key-value 日志） |

## 3. Background Execution — Reality & Design

### 3.1 Chrome 硬边界（必须写进产品预期）

| 场景 | v1 行为 |
|------|---------|
| 用户在其他网站标签浏览 | 继续跑（工作标签在后台） |
| Chrome 窗口最小化 / 被其他应用挡住 | 继续跑 |
| 用户关闭扩展持有的 BOSS 工作标签 | 暂停并提示「工作标签被关闭」 |
| 用户完全退出 Chrome | **停止**（无法保证） |
| 系统休眠 | 暂停或延迟，唤醒后由 alarm 恢复尝试 |
| MV3 service worker 空闲被挂起 | 用 `chrome.alarms` + 持久任务状态唤醒续跑 |

**结论**：所谓「后台」= **浏览器进程内、不依赖前台焦点**；不是系统服务。产品文案与设置页需明确此点。

### 3.2 实现策略（canonical）

1. **Worker Tab（工作标签）**  
   - 扩展启动任务时确保至少 1 个 `*.zhipin.com` 标签作为 **owned worker tab**（可 `chrome.tabs.create` 或复用已有）。  
   - 编排器只对该 tab 发消息驱动 content script，**不要求它是 active tab**。  
   - 可选：独立开「推荐 / 期望1 / 期望2 / 消息」类 URL，避免单页状态互相踩踏（v1 可先单 tab 串行，多 tab 为增强）。

2. **Service Worker 编排器**  
   - 唯一调度 owner：读队列、限速、调 LLM、写 storage、决定下一步动作。  
   - content script **只执行** DOM 抽取/点击/发消息，不做策略决策。

3. **持久化任务状态**  
   - `chrome.storage.session` 或 `local` 保存：`runState`、`cursor`、当前 `jobId`、今日计数、暂停原因。  
   - SW 被杀后，由 `chrome.alarms` 周期性 tick 恢复状态机。

4. **Keep-alive（有节制）**  
   - `chrome.alarms` 为唯一可靠周期唤醒。  
   - 禁止依赖无限 `setInterval` 保活作为唯一手段。  
   - 不默认滥用 offscreen 音视频保活；若实测 alarm 间隔不够，再评估 offscreen 作为 **compat 增强**，并写清退休条件。

5. **用户切走标签**  
   - 所有自动化 UI 操作通过 `tabs.sendMessage(workerTabId, …)`，不使用「当前 activeTab 才注入」作为主路径。

```text
User starts run
  → SW ensures worker tab(s) on zhipin
  → SW writes runState=running
  → alarm tick / message loop:
       SW → content(adapter): extract | click | read chat
       SW → llm: match | reply
       SW → content: send resume action | send text
  → storage: jobs, counters, logs
```

## 4. Architecture

### 4.1 Module owners

```text
extension/
  manifest.json
  background/
    service-worker.ts     # 编排、alarm、tab 生命周期、LLM 网络
    run-state-machine.ts  # 状态机纯逻辑（可测）
  content/
    adapter/boss/         # DOM/页面适配（改版只改这里）
      list.ts             # 三列表
      detail.ts
      profile.ts          # 简历页
      chat.ts             # 消息列表、发简历控件、输入框
    bridge.ts             # 与 SW 的消息协议
  domain/
    profile.ts            # 画像模型
    job.ts
    match-llm.ts          # 匹配 prompt + 解析
    chat-llm.ts           # 回复话术 prompt + 解析
    intent.ts             # 对方意图：resume_request | other | reject | system
    policy.ts             # 限速门闩
  ui/
    sidepanel/ 或 options/ # 配置、启停、日志、今日统计
  data/
    kv.ts                 # chrome.storage：配置 + 运行态（小、热）
    db.ts                 # IndexedDB：职位/事件/日汇总（可查询）
    repos/                # jobs / events / daily_stats 读写 owner
    analytics.ts          # 聚合查询：按日/来源/合适率/动作类型
  shared/
    messages.ts           # SW ↔ content ↔ UI 协议
```

**依赖方向**：`ui` → `shared` + `data(analytics 读)`；`background` → `domain` + `data` + `shared`；`content/adapter` → `shared`（不依赖 LLM、不直写 DB）；`domain` 无 DOM、无存储。

### 4.2 双环状态机

**环 A — 职位获取与开聊**

```text
Idle
 → GuardPolicy（enabled + dailyLimit + interval 已配置）
 → EnsureWorkerTab
 → SyncProfile（缓存未过期可跳过）
 → SelectSourceTab（推荐 | 期望1 | 期望2）
 → NextJob → ExtractJD → LlmMatch
 → if suitable: RateLimitWait → OpenChat(default greeting) → EnqueueChatFollow(job)
 → else: MarkSkipped
 → DailyCap | Captcha | AuthLost → Paused
```

**环 B — 聊天跟进（与环 A 交错，由 SW 调度优先级）**

```text
PollActiveChats（限频）
 → ReadLatestPeerMessages
 → ClassifyIntent（规则优先识别「发简历」类；不确定再 LLM）
 → resume_request: PerformSendResumeAction → Log
 → reject/closed: MarkDone
 → other: LlmComposeReply → SendText → Log
 → 回到调度（可继续环 A）
```

**调度策略（v1）**

- 默认：`follow_up_batch` 与 `open_chat_batch` 交替或「有未回消息优先跟进」。  
- 同一时刻只对 **一个** worker 动作串行，避免并发点击。

### 4.3 意图识别

| 意图 | 判定 | 动作 |
|------|------|------|
| `resume_request` | 关键词/短规则优先（发简历、发一份简历、附件…）；必要时 LLM 二分类 | 调用 BOSS **发送简历** UI/流程，不靠纯文本「简历已发」糊弄 |
| `reject` | 不合适/已招满等 | 停止该会话跟进 |
| `other` | 默认 | LLM 话术回复 |
| `system` | 平台系统消息 | 忽略或仅记日志 |

发简历失败（无附件、按钮不可用）：该会话 **PausedLocal**，记错误，不死循环。

### 4.4 数据存储（轻量本地库）— 修订

> 原草案仅用 `chrome.storage` 塞配置/状态/日志，**不够支撑统计与分析**。  
> 现采用 **双层存储**：热配置走 KV；可查询事实表走 IndexedDB。

#### 4.4.1 为什么不能只靠 chrome.storage

| 能力 | `chrome.storage.local` | 需要的分析能力 |
|------|------------------------|----------------|
| 存配置/开关 | 合适 | — |
| 存运行态 | 合适 | — |
| 按日/公司/来源聚合 | 需自己扫大 JSON，慢且易超配额心智 | 需要索引与查询 |
| 事件时间线 | 数组追加易膨胀、难裁剪 | 需要表 + 索引 + 保留策略 |
| 配额 | ~10MB 量级心智（实现相关） | 职位全文+事件会顶满 |

#### 4.4.2 分层方案（v1 canonical）

```text
┌─────────────────────────────────────────────┐
│ chrome.storage.local / session              │  层 A：KV
│  - LlmConfig, Policy, UI prefs              │
│  - Profile 缓存（可较大但仍单文档）           │
│  - RunState（status/phase/workerTabId/cursor）│
│  - 今日计数热缓存（可与 DB 日汇总对账）        │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│ IndexedDB（库名建议：boss_job_assistant）    │  层 B：轻量 DB
│  object stores + indexes                    │
│  - jobs / events / daily_stats / chat_threads│
│  唯一写入口：background 经 data/repos         │
└─────────────────────────────────────────────┘
         ▲ 统计 UI / 导出 JSON
         │ 只读 analytics 查询
```

**技术选型**

| 选项 | 结论 |
|------|------|
| **IndexedDB + 薄封装（推荐）** | 扩展原生支持、无额外 native、可索引、可分页；用 `idb` 或 Dexie 降低样板代码 |
| 纯 chrome.storage 大数组 | **否决**作分析主存 |
| SQLite WASM | 分析更强，但包体与复杂度高 → **v2 候选**，非 v1 |
| 本机 Node + SQLite 文件 | 违背「纯扩展」；**非 v1** |
| 远程 DB | 隐私与复杂度；**非目标** |

**Owner 规则**

- **唯一写路径**：`background` → `data/repos/*` → IndexedDB / storage  
- content script **禁止**直接打开 IndexedDB 写业务表（避免多上下文竞态）  
- UI 通过消息 `db.query` / `analytics.summary` 读，或侧栏直接读 IDB（若同扩展源；优先消息以免双写）

#### 4.4.3 Schema（最小可分析）

```ts
// —— 层 A：KV（chrome.storage）——
Profile = {
  syncedAt: number
  summary: string
  skills: string[]
  rawText?: string
}

Policy = {
  enabled: boolean
  dailyOpenChatLimit?: number
  minIntervalMs?: number
  maxIntervalMs?: number
  dailyReplyLimit?: number
}

LlmConfig = { baseUrl: string; apiKey: string; model: string }

RunState =
  | { status: 'idle' }
  | { status: 'running'; phase: string; workerTabId: number; cursor: unknown }
  | { status: 'paused'; reason: string }

// —— 层 B：IndexedDB ——
// store: jobs  keyPath: id
JobRecord = {
  id: string                 // BOSS 职位稳定 id
  title: string
  company: string
  salary?: string
  city?: string
  desc: string               // 可截断存储，全文过长时 descHash + 截断
  source: 'recommend' | 'expect1' | 'expect2'
  firstSeenAt: number
  lastSeenAt: number
  match?: {
    suitable: boolean
    reasons: string[]
    confidence?: number
    model?: string
    matchedAt: number
  }
  outcome?: 'skipped' | 'opened' | 'failed' | 'unknown'
  openChatAt?: number
}

// store: events  keyPath: id (uuid)  index: [ts], [type+ts], [jobId+ts], [day]
EventRecord = {
  id: string
  ts: number
  day: string                // 'YYYY-MM-DD' 本地日，便于日聚合
  type:
    | 'run_start' | 'run_pause' | 'run_resume'
    | 'job_seen' | 'job_matched' | 'job_skipped'
    | 'chat_open' | 'chat_reply' | 'resume_sent'
    | 'error' | 'captcha' | 'auth_lost'
  jobId?: string
  threadId?: string
  payload?: Record<string, unknown>  // 短结构，禁止塞整页 HTML
}

// store: chat_threads  keyPath: id
ChatThread = {
  id: string                 // 会话稳定 id（从页面/链接推导）
  jobId?: string
  company?: string
  status: 'active' | 'waiting_peer' | 'done' | 'error'
  lastPeerAt?: number
  lastActionAt?: number
  resumeSentAt?: number
}

// store: daily_stats  keyPath: day
DailyStats = {
  day: string
  seen: number
  matchedSuitable: number
  matchedUnsuitable: number
  opened: number
  replies: number
  resumesSent: number
  errors: number
  bySource?: Partial<Record<'recommend'|'expect1'|'expect2', number>>
}
```

#### 4.4.4 写入路径（与状态机挂钩）

```text
LlmMatch 完成 → repos.jobs.upsert(match) + events.append(job_matched) + daily_stats.bump
OpenChat 成功 → jobs.outcome=opened + events(chat_open) + daily_stats.opened++
SendResume   → events(resume_sent) + thread.resumeSentAt + daily_stats.resumesSent++
任意 error   → events(error) ；验证码/登录 → 另打 captcha/auth_lost
```

**日汇总策略**：事件写入时 **增量更新** `daily_stats`（O(1) 读看板）；需要纠偏时可用 events 全量重算（维护工具，非常路径）。

#### 4.4.5 统计 / 分析（v1 看板最小集）

| 指标 | 来源 |
|------|------|
| 今日：浏览 / 合适 / 不合适 / 开聊 / 回复 / 发简历 / 错误 | `daily_stats` |
| 近 7/30 日趋势 | 扫 `daily_stats` 按 day |
| 按来源（推荐/期望1/期望2）开聊占比 | `daily_stats.bySource` 或 events |
| 合适率 | suitable / (suitable+unsuitable) |
| 最近事件流 | `events` 按 ts 倒序分页 |
| 单职位详情 | `jobs` + 关联 events |

**v1 不做**：复杂 BI、漏斗拖拽、远程同步看板。  
**导出**：一键导出 `jobs + events + daily_stats` 为 JSON（可选 CSV 仅 daily_stats）。

#### 4.4.6 保留与配额

| 数据 | 默认保留 |
|------|----------|
| events | 90 天或 2 万条（先到为准），滚动删除最旧 |
| jobs | 180 天；`outcome=opened` 可更久 |
| daily_stats | 365 天 |
| RunState / Policy | 永久（用户清扩展则无） |

描述字段过长：存截断 + hash，避免单条撑爆。

#### 4.4.7 与「轻量」的边界

- **轻量** = 扩展内 IndexedDB + 少量 repos/analytics 代码，无独立数据库进程。  
- **不是** 再挂一个 Postgres/Redis，也不是 v1 上 SQLite WASM。

### 4.5 LLM 配置

```ts
LlmConfig = {
  baseUrl: string
  apiKey: string
  model: string
  // 超时、温度等可选
}
```

匹配与回复使用不同 system prompt；密钥仅存 `chrome.storage.local`，不上传除用户配置的 API 端点以外的地址。

## 5. Permissions (manifest 预期)

- `storage`
- `alarms`
- `tabs` / `scripting`
- host permissions: `*://*.zhipin.com/*`（以实际域名为准）
- `sidePanel`（若采用侧栏；否则 `options_page`）

不申请与 BOSS 无关的宽泛 `<all_urls>`，除非后续证明必要。

## 6. UX 最小面

1. **设置**：API、限速数字、启停、工作标签状态  
2. **画像**：显示同步结果，支持手动再同步  
3. **运行日志**：开聊/跳过/发简历/回复/暂停原因（读 `events`）  
4. **统计页**：今日卡片 + 近 7 日趋势 + 合适率（读 `daily_stats` / `analytics`）  
5. **导出**：本地 JSON  
6. **风险提示**：后台=浏览器内；协议与封号风险自负；数据仅本机  

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| BOSS 风控/封号 | 默认不跑；用户自填限速；验证码即停 |
| 页面改版 | adapter 隔离 |
| SW 被挂起导致中断 | storage 状态 + alarms 续跑 |
| 用户关掉 worker tab | 检测 tab removed → paused |
| LLM 幻觉乱回复 | 短回复约束；拒绝类意图先规则 |
| 发简历误触发 | 高置信 resume_request 才动作；失败停该会话 |
| 「后台」预期过高 | 设置页与 Spec 写明 Chrome 退出即停 |
| storage 膨胀 / 无法分析 | 分析事实进 IndexedDB；events 滚动保留；禁止 content 双写 |
| SW 与 UI 并发写库 | 仅 background repos 写；UI 只读查询 |

## 8. Acceptance / Verification

1. 启动后切换到百度等标签，队列仍前进（日志时间戳连续）。  
2. Chrome 最小化后仍能产生新的开聊或跟进日志。  
3. 关闭 worker tab → 状态 paused + 可理解提示。  
4. Mock LLM `suitable=true` → 触发开聊路径（可在测试页或受控环境验证选择器）。  
5. 注入/模拟「请发一下简历」→ 走发简历动作分支而非普通文本。  
6. 未填 `dailyOpenChatLimit` → 无法 running。  
7. 跑通若干职位后：统计页能显示今日 seen/matched/opened；events 可分页；导出 JSON 含 jobs+events。  
8. 写入仅经 background repos（抽查无 content 直写 IDB 业务表）。  

## 9. Implementation Phases (planning hint)

1. 骨架：manifest MV3 + SW + **kv + IndexedDB schema/repos** + 侧栏配置 + GuardPolicy  
2. Worker tab 生命周期 + alarm 续跑 + 事件写入（heartbeat/run_*）  
3. 简历同步 + 三列表抽取 + LLM 匹配 + 开聊 + **jobs/events/daily_stats**  
4. 聊天读取 + 意图 + 发简历 + LLM 回复 + 对应事件  
5. 统计看板 + 导出 + 保留策略 + 暂停恢复打磨  

## 10. ADR Signals (later)

- 编排 owner 固定在 service worker，content 无策略  
- 后台语义采用 worker-tab + alarms，不引入常驻本机 daemon  
- 意图：规则优先、LLM 兜底  
- **分析数据主存：IndexedDB；配置/运行态：chrome.storage（双层）**  

## 11. Open items (non-blocking for v1 scaffold)

- 侧栏 vs 独立 options 页：实现期二选一，默认 side panel  
- 多 worker tab 并行：v1 串行，规格允许后续增强  
- 求职期望 1/2 的 DOM 映射：实现时对着实页标定  
- IndexedDB 封装：`idb` vs Dexie（实现期选一个，不双栈）— **库形态已定为 IndexedDB，非 SQLite**  
- SQLite WASM：明确 **非 v1**（仅当日后 IDB 不够再开题）  

---

## Appendix A — Decision log (conversation)

- 技术路线：Chrome MV3（非油猴）  
- 匹配：LLM first  
- 画像：BOSS 简历页  
- 职位：三列表  
- 限速：用户配置，默认关  
- 后台：不依赖前台与当前标签  
- 聊天：默认首条 + 识别发简历 + 其他 LLM 话术  
- 存储：**已确认** 双层 — chrome.storage（KV）+ **IndexedDB 轻量 DB**（jobs/events/daily_stats）；支持统计/分析；不装本机数据库  

## Appendix B — Baseline drafts

**TaskIntentDraft**：见 §1  
**ImpactStatementDraft**：新仓库从零建立扩展；无旧 owner 可复用  
**Architecture Integrity**：SW=编排唯一源；adapter=页面唯一源；domain=纯函数匹配/意图；**data=存储唯一写入口**