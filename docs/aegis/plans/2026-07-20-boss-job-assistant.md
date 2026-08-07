# Implementation Plan: BOSS 本地求职 Chrome 扩展 v1

Date: `2026-07-20`  
Status: `executed-v0.1`  
Spec: `docs/aegis/specs/2026-07-20-boss-job-assistant-design.md` (`approved`)  
Code: `extension/` · build: `npm run build` → `dist/`

## Aegis Visibility

跨模块新产品（SW 编排 / content 适配 / IndexedDB / LLM / 双环状态机），必须按 owner 分批落地，避免 content 写策略或 storage 兼作分析库。

## Plan Basis

- 已批准 Design Spec 全文（R1–R12、后台 Worker Tab、双环状态机、双层存储、聊天发简历）
- 空仓库：`e:\coding\Jobs` 仅有 `docs/aegis/*`

## BaselineUsageDraft

- Required baseline refs: Design Spec `2026-07-20-boss-job-assistant-design.md`
- Delivered context refs: 对话决策日志（附录 A）
- Acknowledged before plan refs: Spec §3 后台边界、§4.4 存储、§8 验收
- Cited in plan refs: 同上
- Missing refs: BOSS 实页 DOM 选择器（实现期对着实页标定）
- Decision: **continue**

## Requirement Ready Check

- Decision: **ready**
- Open blockers: 无阻塞；DOM 映射为实现期标定

## TDD Route

```text
TDD Route:
- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression + 可测纯函数单元测试（domain/policy/intent）
- Reason: 用户/项目未要求 strict TDD；domain 纯逻辑用轻量测试即可
- Verification: vitest（domain）+ 手工加载扩展验收清单
```

## Change Necessity

- User-visible need: 可加载扩展完成限速自动开聊与跟进 + 本地统计
- No-change / non-code option: 无（空仓库）
- Why code change is necessary: 新产品实现
- Minimum change boundary: `extension/` 包 + 构建配置；文档已在 `docs/aegis`
- Decision: **code-change**

## Existence Check

- Proposed new surface: 整个扩展应用 + data 层
- Existing owner: 无
- Why insufficient: N/A
- Creation proof: 已批准 Spec
- Entropy: 新项目可接受；模块按 Spec 切分避免单文件巨石
- Decision: **add-with-proof**

## Architecture Integrity Lens

- Invariant: SW 唯一编排；content 无策略；data 唯一写入口；domain 无 DOM
- Canonical owners: 见下方 File Map
- Overlap risk: 若 content 直接调 LLM → 禁止
- Higher-level simplification: 无本机 daemon
- Verdict: **aligned with approved spec**

## Plan Pressure Test

- Pressure result: **proceed**

## Execution Readiness View

- Intent Lock: 限速全自动 + LLM 匹配 + 默认招呼开聊 + 发简历动作 + LLM 跟进 + 后台 worker tab + IndexedDB 统计
- Scope Fence: 仅 zhipin；无 Electron/油猴/SQLite/已读不回海刷
- Baseline Lock: approved Spec
- Owner / Contract: SW / adapter / domain / data / ui
- Compatibility Boundary: 无旧数据迁移
- Retirement Boundary: 无旧路径
- Task Batches: P0→P5（见 Tasks）
- Test Obligations: domain 单测 + 手工验收 §Spec.8
- Review Gates: 每 Phase 可加载验证后再进下一 Phase
- Drift / Rewind: DOM 选不中 → 只改 adapter；策略变更 → 改 Spec 再改 domain
- Evidence Required: 扩展可加载；Guard 生效；IDB 有事件；统计可读
- Advisory Boundary: 本计划非完成权威

## Plan-Time Complexity Check

- Artifact class: greenfield multi-module extension
- Recommendation: **add owner files by layer**；禁止单文件堆全部逻辑
- Budget: within-budget if phases respected

---

## File Map

```text
e:\coding\Jobs\
  package.json                 # scripts: build, dev, test
  tsconfig.json
  vite.config.ts               # 或 @crxjs/vite-plugin 多入口
  README.md                    # 加载方式、风险说明
  extension/                   # 源码根（构建输出 dist/）
    manifest.json              # MV3
    background/
      service-worker.ts        # 入口：消息、alarms、tab 生命周期
      scheduler.ts             # 双环调度串行队列
      run-state-machine.ts     # 纯状态迁移（可测）
      llm-client.ts            # OpenAI 兼容 fetch
    content/
      bridge.ts
      adapter/boss/
        list.ts
        detail.ts
        profile.ts
        chat.ts
        selectors.ts           # 选择器集中，改版只动这里
      main.ts                  # content 入口
    domain/
      profile.ts
      job.ts
      policy.ts                # GuardPolicy
      match-llm.ts
      chat-llm.ts
      intent.ts                # resume_request 规则优先
    data/
      kv.ts                    # chrome.storage 封装
      db.ts                    # IndexedDB open/migrate（Dexie 或 idb，二选一：推荐 Dexie）
      repos/
        jobs.ts
        events.ts
        daily-stats.ts
        chat-threads.ts
      analytics.ts
      retention.ts
    ui/
      sidepanel/
        index.html
        main.ts
        app.ts                 # 配置 / 启停 / 日志 / 统计 / 导出
      styles.css
    shared/
      messages.ts              # 消息协议类型
      types.ts
  tests/
    domain/policy.test.ts
    domain/intent.test.ts
    domain/run-state-machine.test.ts
```

**依赖方向（强制）**

```text
ui → shared, messages
background → domain, data, shared, llm-client
content → shared, adapter only（不 import data 写库、不 import llm）
domain → 无 chrome.* / 无 DOM
data → shared types only；仅 background 调用写 API
```

**实现期锁定**

- IndexedDB 封装：**Dexie**（单选，不引入 idb 第二栈）
- UI：**Side Panel**
- 串行：单 worker tab v1

---

## Compatibility Boundary

- 无历史数据
- 清除扩展 = 清空 storage + IDB（可接受）
- schema version 字段：`db.ts` 内 `version(1)`，后续只增不改坏

## Retirement

- N/A（无旧系统）
- 明确不实现：SQLite WASM、本机 Node、油猴兼容层

## Risks（执行时）

| Risk | Plan response |
|------|----------------|
| BOSS DOM 未知 | Phase 3/4 用 selectors.ts + 实页标定任务，失败不扩散到 domain |
| SW 休眠 | alarms + RunState 持久化优先于 setInterval |
| 风控 | 默认 enabled=false；Guard 强制数字 |
| LLM 不稳定 | 超时/重试有限；失败记 event 不崩调度 |

---

## Tasks

> 每任务目标：可独立提交；路径均为仓库相对路径。  
> 验证命令在 Windows PowerShell 下执行。

### Phase 0 — 工程骨架

#### Task 0.1 初始化 npm + TypeScript + 构建

- **Files**: `package.json`, `tsconfig.json`, `vite.config.ts`（或等价 CRX 构建）, `.gitignore`
- **Do**:
  - 创建扩展构建链，输出 `dist/` 可被 Chrome「加载已解压的扩展程序」加载
  - dev 依赖：typescript, vite, `@crxjs/vite-plugin` 或手动 multi-entry, vitest, dexie
  - scripts: `"dev"`, `"build"`, `"test"`
- **Verify**: `npm install` && `npm run build` 成功；`dist/manifest.json` 存在

#### Task 0.2 Manifest MV3 + 空壳入口

- **Files**: `extension/manifest.json`, `extension/background/service-worker.ts`, `extension/content/main.ts`, `extension/ui/sidepanel/index.html`
- **Do**:
  - permissions: `storage`, `alarms`, `tabs`, `scripting`, `sidePanel`
  - host: `*://*.zhipin.com/*`（及实际需要的 boss 域）
  - background service_worker；content_scripts 匹配 zhipin；side_panel 默认路径
- **Verify**: Chrome 加载 `dist`，无错误；侧栏可打开

#### Task 0.3 共享消息协议

- **Files**: `extension/shared/types.ts`, `extension/shared/messages.ts`
- **Do**: 定义 `Msg` 联合类型：`run/start|stop|status`, `kv/get|set`, `db/query`, `analytics/summary`, `content/exec` 等最小集合
- **Verify**: `npm run build` 通过

---

### Phase 1 — 双层存储 + Guard

#### Task 1.1 KV 层

- **Files**: `extension/data/kv.ts`
- **Do**: 读写 `LlmConfig`, `Policy`, `Profile`, `RunState`；默认 `Policy.enabled=false`
- **Verify**: 侧栏临时按钮写入后 refresh 仍在（可先用 console）

#### Task 1.2 IndexedDB schema + repos

- **Files**: `extension/data/db.ts`, `repos/jobs.ts`, `events.ts`, `daily-stats.ts`, `chat-threads.ts`
- **Do**: Dexie schema 对齐 Spec §4.4.3；仅导出 async API
- **Verify**: 在 SW 中 `events.append` 一条，DevTools → Application → IndexedDB 可见

#### Task 1.3 analytics + retention 骨架

- **Files**: `extension/data/analytics.ts`, `retention.ts`
- **Do**: `summaryToday()`, `lastNDays(7)`；`pruneIfNeeded()` 按 Spec 保留策略（可先 stub 上限检查）
- **Verify**: 写入假数据后 summary 数字正确

#### Task 1.4 policy Guard（纯函数）

- **Files**: `extension/domain/policy.ts`, `tests/domain/policy.test.ts`
- **Do**: `canStart(policy) → { ok, reason }`：enabled、dailyLimit、interval 必填
- **Verify**: `npm test` 覆盖：缺字段 fail；齐全 pass

#### Task 1.5 侧栏：配置 + 启停门闩

- **Files**: `extension/ui/sidepanel/*`
- **Do**: 表单：baseUrl/apiKey/model、dailyLimit、min/max interval、enabled；Start/Stop；展示 Guard 失败原因
- **Verify**: 未填 limit 点 Start → 明确错误，RunState 仍 idle

---

### Phase 2 — 后台 Worker Tab + Alarm 续跑

#### Task 2.1 Ensure worker tab

- **Files**: `extension/background/service-worker.ts`（或 `tabs.ts`）
- **Do**: start 时查找/创建 zhipin 标签，记录 `workerTabId` 到 RunState；`tabs.onRemoved` → paused + event
- **Verify**: Start 后切到其他站点，worker tab 仍在后台；关掉 worker tab → 侧栏显示 paused

#### Task 2.2 Alarm tick + RunState 恢复

- **Files**: `background/scheduler.ts`, `run-state-machine.ts`
- **Do**: `chrome.alarms` 周期 tick；SW 重启后读 RunState 继续；串行锁（inFlight）
- **Verify**: 强制终止 SW（chrome://serviceworker-internals 或重载扩展）后，若 status=running，能 resume 或安全 paused 并打 event

#### Task 2.3 心跳事件

- **Do**: tick 时写低频 `run` 相关 event 或仅更新 lastTickAt（避免刷屏：最多 1/min）
- **Verify**: events 可查

---

### Phase 3 — 环 A：简历 + 列表 + 匹配 + 开聊

#### Task 3.1 selectors + profile adapter

- **Files**: `content/adapter/boss/selectors.ts`, `profile.ts`
- **Do**: 打开简历页抽取文本 → 回传 SW → kv 存 Profile（可编辑字段侧栏展示）
- **Verify**: 手动「同步简历」后侧栏有摘要（选择器需实页调整）

#### Task 3.2 list + detail adapter

- **Files**: `list.ts`, `detail.ts`
- **Do**: 三来源切换（recommend/expect1/expect2）列出可见 job 卡片；点开详情抽 JD；返回 `Job` 结构
- **Verify**: content exec 返回至少 1 条 job 字段非空

#### Task 3.3 LLM client + match-llm

- **Files**: `background/llm-client.ts`, `domain/match-llm.ts`
- **Do**: OpenAI 兼容 chat completions；解析 `{ suitable, reasons, confidence }`；失败可解析时记 error event
- **Verify**: 配置真实或 mock baseUrl；单元测解析函数；联调一条 JD

#### Task 3.4 环 A 状态机接线

- **Files**: `run-state-machine.ts`, `scheduler.ts`, repos
- **Do**: NextJob → match → 写 jobs/events/daily_stats → suitable 则 rate limit → 点击立即沟通（默认招呼）→ outcome=opened
- **Verify**: Spec §8.4–8.6 相关项；日计数增加

#### Task 3.5 去重

- **Do**: 已处理 jobId 跳过（jobs 表或 processed 索引）
- **Verify**: 同一 job 不重复开聊

---

### Phase 4 — 环 B：聊天跟进

#### Task 4.1 chat adapter

- **Files**: `content/adapter/boss/chat.ts`
- **Do**: 读会话列表/最新对方消息；发送文本；触发「发简历」平台动作（按钮/菜单，实页标定）
- **Verify**: 手工 content exec 能读到消息文本

#### Task 4.2 intent 规则

- **Files**: `domain/intent.ts`, `tests/domain/intent.test.ts`
- **Do**: 关键词识别 `resume_request` / `reject`；其余 `other`；可选 LLM 二分类接口预留但不强制
- **Verify**: `npm test` 用例：请发简历、不合适、普通问句

#### Task 4.3 chat-llm + 发送

- **Files**: `domain/chat-llm.ts`, scheduler 环 B
- **Do**: other → LLM 短回复 → SendText；resume_request → PerformSendResume；失败 PausedLocal 该 thread
- **Verify**: Spec §8.5；events 含 `resume_sent` / `chat_reply`

#### Task 4.4 调度优先级

- **Do**: 有待跟进会话时优先环 B，否则环 A；全局串行
- **Verify**: 日志顺序合理，无并发双点击

---

### Phase 5 — 统计 / 导出 / 打磨

#### Task 5.1 统计 UI

- **Files**: sidepanel
- **Do**: 今日卡片 + 近 7 日 + 合适率 + 事件流分页
- **Verify**: Spec §8.7

#### Task 5.2 导出 JSON

- **Do**: 导出 jobs+events+daily_stats 下载
- **Verify**: 文件可解析

#### Task 5.3 retention 落地

- **Do**: 启动或日首次 tick 执行 prune
- **Verify**: 超限数据被删（可用测试写入超限模拟）

#### Task 5.4 README + 风险文案

- **Files**: `README.md`, 侧栏提示
- **Do**: 加载步骤、后台边界（Chrome 退出即停）、协议风险、配置说明
- **Verify**: 新人可按 README 加载

---

## Phase 完成定义（DoD）

| Phase | DoD |
|-------|-----|
| 0 | dist 可加载，侧栏开 |
| 1 | Guard + IDB 读写 + 配置持久化 |
| 2 | 非前台标签下 tick 仍工作；关 worker → paused |
| 3 | 匹配+开聊闭环 + DB 有 jobs/events |
| 4 | 发简历分支 + LLM 回复 |
| 5 | 看板+导出+README；对照 Spec §8 清单勾选 |

## Suggested commit cadence

- 每完成一个 Task 或同 Phase 内紧密相关 2–3 task 提交一次
- 提交信息前缀：`feat(ext):`, `feat(data):`, `feat(domain):`, `docs:`

## Execution choice（交给用户）

计划写完后可选：

1. **Inline**：本会话按 Phase 0→1… 直接实现  
2. **分会话**：每 Phase 新开，严格对照本 plan  

推荐：**Inline 从 Phase 0 开始**，每 Phase 结束暂停确认 DOM 标定是否需你配合打开 BOSS 页面。

---

## Self-review

- [x] Spec R1–R12 均有对应 Phase/Task  
- [x] 无 SQLite/Electron 任务  
- [x] 存储双层明确  
- [x] 后台边界与验证写入  
- [x] DOM 未知隔离在 adapter  
- [x] TDD Route 已记录为 skipped  
- [x] 无占位 TBD 任务（DOM 选择器标为实页标定，非规格空洞）