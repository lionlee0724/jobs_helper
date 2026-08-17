# 下一步功能规划 — 2026-08-14

Date: `2026-08-14`  
Status: `draft`（供评审；落地前经 Trellis 任务立项）  
Inputs: `code-audit-2026-08-14.md`（全量审计）· `functional-layer-review-2026-08-07.md`（backlog）· `2026-08-08-stage-patch-next-slice.md`（Spec 债务）· P0–P3 路线图（已完成）

## 0. 一句话现状

**代码库分层健康，但当前工作树不可构建、不可运行**：未提交的 `service-worker.ts` 重写把事件接线全部掏空（P0），同时 `tsc` 编译失败、依赖声明漂移。任何功能规划都必须先跨过这道"抢救"门槛，否则后续一切迭代都建立在不可运行的基线上。

## 1. 优先级总览

| 编号 | 主题 | 周期 | 类型 | 前置 |
|------|------|------|------|------|
| R0 | **抢救与工程门禁**（恢复构建/运行、依赖修复、质量门禁） | 立即（1-2 天） | 工程阻断 | 无 |
| R1 | **审计修正包**（P1 项集中修复 + 测试补漏） | 本周 | 工程 | R0 |
| R2 | **功能增强第一波**（反馈闭环、意图增强、看板补全） | 2-4 周 | 功能 | R1 |
| R3 | **债务收口与方向**（多源职位池、权限收窄、长期稳定性） | 季度 | 战略 | R2 |

---

## 2. R0 — 抢救与工程门禁（立即）

> 目的：把仓库恢复到「能构建、能加载、能运行」的可信基线。不做功能，只止痛。

| # | 条目 | 说明 | 验收 |
|---|------|------|------|
| R0-1 | **恢复 SW 接线** | 二选一：`git checkout HEAD -- extension/background/service-worker.ts` 回滚，或在新 barrel 上补齐全部事件监听（`runtime.onMessage` 全路由、`alarms.onAlarm` 双 dispatch、`tabs.onRemoved`、`onInstalled/onStartup`+`ensureAlarms`、`sidePanel`/`action.onClicked`）并消除 `onAlarm` 导出歧义（对 `export *` 改名或显式 re-export） | `npm run build` 绿；扩展加载无报错；侧栏可打开 |
| R0-2 | **依赖声明对齐** | `vitest` 回归 devDependencies；`prettier` 补声明；`eslint` 安装（`npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin` 与 lockfile 同步）；确认 ESLint 9 下 `.eslintrc.js` 需要 `ESLINT_USE_FLAT_CONFIG=false` 或迁移 flat config | 全新 `npm install` 后 `npm test`、`npm run lint`、`npm run build` 全绿 |
| R0-3 | **版本对齐** | `package.json`（0.2.0）与 `manifest.config.ts`（0.1.15）二选一对齐；README 版本说明同步（README 称 package.json 与 manifest 对齐，现状不符） | 两处版本一致 |
| R0-4 | **工程门禁** | 新增 `scripts/check`（build + test + lint 串联）或 CI（GitHub Actions）；把「`npm run build` 必须绿」作为每次提交的门禁；README v0.2.0 文案只有真实落地后才可保留 | 门禁脚本在坏状态时失败 |
| R0-5 | **真实冒烟** | 本地加载 `dist`，走一遍：配置 LLM → 保存策略 → 开始 → 停止 → 导入会话 → 处理一批 → 导出 | 主路径可用；修正 README「v0.2.0 改进历史」与实际一致 |

## 3. R1 — 审计修正包（本周）

> 目的：清理审计确认的问题，堵住隐私/健壮性/一致性漏洞。每项都是独立可提交的小切片。

### 3.1 正确性与健壮性（P1）

| # | 条目 | 位置 | 说明/修复方向 |
|---|------|------|--------------|
| R1-1 | **导出脱敏**：`export/all` 的 `kv` 含 `LlmConfig.apiKey` | `service-worker.ts`（提交版 export/all）、`csv-export.ts` | 导出 payload 里 `llm` 字段脱敏（`apiKey: '***'` 或从导出中剔除）；测试锁死 |
| R1-2 | **聊天回复 LLM 重试补上** | `follow-up-flow.ts:362` 的 `chatCompletion` | 传 `retries`（如 1-2）+ 退避；`profile-sync.ts:42` 同理可选；`MATCH_LLM_EXTRA_RETRIES` 已生效（open-chat-flow:455） |
| R1-3 | **异常可见性**：`pruneIfNeeded().catch(()=>undefined)` 静默吞错 | `scheduler.ts:223`、`startRun` 分类锁定 catch | 至少 `appendEvent({type:'error'})` 记录，日运行 Tab 能读到 |
| R1-4 | **`run-state-machine.ts` 处置** | `domain/run-state-machine.ts` | 按功能层评审 W5：删除或真接入（当前生产死代码且与 scheduler 双叙事）；连同 `JobSource` 三源叙事收敛（保持 `JOB_SOURCES=['current']`） |
| R1-5 | **DB 迁移脚手架** | `data/db.ts` | `version(2)` 预留 + 升级回调（`upgrade`），避免「加字段=丢老数据」 |
| R1-6 | **事件保留与日汇总对账** | `retention.ts` + `daily-stats.ts` | `pruneIfNeeded` 删除超过保留期的 events 后，被删事件所属日期的 `daily_stats` 不回退（对账偏差）；补 `recomputeDay` 维护工具（非常路径，按 spec 4.4.4） |
| R1-7 | **risk 周末锁移除** | `domain/risk.ts` conservative 预设 | 已立项 `08-08-remove-weekend-delivery-lock`（PRD 完备），安排执行：删 `activeWeekdays:[1..5]`、补周五夜/周日测试、README 时段文案（已执行并入 2026-08-14 变更记录，见下） |
| 2026-08-14 | **活跃时段限制整体移除** | `domain/risk.ts` + `scheduler.ts` / `open-chat-flow.ts` / `message-assist-loop.ts` 四处强制点 | 用户要求随时可测（深夜/任意时段均可投递与回消息）：删除 `isWithinActiveWindow` / `msUntilActiveWindow` 及全部强制点（startRun 闸门、preview 检查、open-chat 窗口等待、消息循环 start/pump 门禁）、预设字段与对应测试；README 时段列改为「不限时段」 |

### 3.2 领域边界与测试补漏（对照审计逐条）

| 断言 | 审计结论 | 行动 |
|------|----------|------|
| 关键词单通道封顶 60 | **已实现**（`keywordScore` `ratio*60`，三模式共用；balanced 混合路径同样生效） | 仅补测试：`match-and-machine.test.ts` 加「关键词高分 + LLM 低分 → 综合分封顶上限」用例锁死合同 |
| 硬否「证据不足不拒绝」 | **成立**（`evaluateHardRules` 解析失败放行） | 补边界测试：999999K 超大薪资、JD 无年限、单值薪资 |
| 出站护栏 | **回复路径必过**（`follow-up-flow.ts:384` `screenOutgoingText`） | 补「护栏命中→handoff」的端到端单测（现 `chat-guard.test.ts` 只测纯函数） |
| LLM fail-soft（llm_error 不写假分） | **成立**（`decideJobMatch` llmErrorDecision） | 保持；补充 malformed-JSON 测试分支 |
| balanced/llm_only/keywords_only 决策 | 逻辑闭环 | 补 `llm_only` 与 `keywords_only` 的边界测试（当前覆盖偏 balanced） |

### 3.3 UI 收口（低风险、高感知）

- 数字输入统一校验：日上限/回复上限/会话上限加 clamp+必填提示（`dailyLimit` 现 `parseInt()||undefined` 负数/超大无防护）
- 显式日上限未保存时「开始」按钮的引导文案（已知 R11 合同，检查 UI 是否满足——现依赖 SW 校验回包）
- `visibilitychange` 可见时立即刷新状态轮询（`run/status` 5s 轮询在标签重开后有陈旧窗口）
- handoff 列表 `innerHTML`（`sidepanel/main.ts:895`）与模板区（`:112`）再审计转义覆盖

### 3.4 测试基线升级

- 为 background 层补首个单元测试点：`onAlarm(alarmName)` dispatch、`startRun`/`stopRun` 门闩、`tick` 的 anomaly 分支（当前 background 层 0 测试，README「提升测试覆盖率」与现状不符）
- 新增 `tests/domain/match-hybrid-cap.test.ts`、`tests/risk-timezone-edge.test.ts`（周日夜间/跨零点）

---

## 4. R2 — 功能增强第一波（2-4 周，按 ROI 排序）

> 依据功能层评审 O1–O7 与 Spec 4.4.5 遗留。每项需独立 PRD + Trellis 任务。

### 4.1 匹配反馈闭环（O5，最高 ROI）

- **现状缺口**：开聊后的结果（对方秒拒/已读不回/约面）不回流画像与阈值——调「开聊最低分」没有数据支撑。
- **交付**：
  1. 从 `chat_threads` 追踪开聊后 3 日内的对话结果（`waiting_peer`→`handoff`/`done` 的时间线）
  2. 看板新增「开聊转化」：按 `via`(llm/hybrid/keywords) × 分数段统计「被理/被拒/无响应」率
  3. 侧栏「默认分校准建议」：给出基于近 N 日数据的建议阈值（不改默认，只提示）
- **验收**：跑 7 天后可回答「50 分以上开聊的回复率是多少 / 40-50 分段是否值得投」

### 4.2 意图增强（O6）

- **现状**：`intent.ts` 纯正则主干，`other` 直接 LLM 回；新话术易漏。
- **交付**：正则主干保留 + 低置信 `other` 走 LLM 二分类（复用 `chatCompletion`，加 retry）；置信度阈值在侧栏高级区可调；`handoff` 事件聚合通知（badge 或侧栏红点）
- **验收**：测试夹具覆盖 20 类新话术变体；误拦/漏拦率可观测

### 4.3 看板与复盘补全（Spec 4.4.5 遗留项）

- 事件流分页（`events/list` 现 limit 50 无游标）
- 单职位详情（jobs + 关联 events + 聊天动作时间线）
- 30 日趋势（现 `summaryTodayAndWeek` 仅 7 日）
- 事件/日汇总按来源维度（source 打标已存在，当前只读 current）

### 4.4 消息线增强（P1b 后续）

- `messageAssist/runAll` 进度与「跑到清空」的用户可见状态（py 循环已 alarm 驱动，UI 只有进度数字，无 ETA/剩余预估）
- 导入会话的结果报告（导入 N 更新 M 跳过 K 的明细入口）
- 浮层与侧栏功能对等收口（W8：浮层精简为「处理当前/处理一批/重置错误」，配置与导入只在侧栏）

### 4.5 工程使能

- `open-chat-flow` / `follow-up-flow` 的 scheduleSoonTick 与 alarm 双路径的幂等测试
- KV 读写竞态收敛（`bumpHourlyOpened` 等 read-modify-write 加串行或合并 key）——低风险，顺手做

---

## 5. R3 — 债务收口与方向（季度级）

### 5.1 Spec 债务复审（最重要）

- **R5 多源职位池**（推荐/期望1/期望2）——当前 Spec 债务、产品不宣传。**建议重新评估**：功能层已把「职位池三源」从表面概念弱化为 `JOB_SOURCES=['current']`。开聊漏斗的单列表锁定意味着用户必须手动滚动/切换分类，自动化价值打折扣。若恢复三源：需要（a）多 worker tab 或同 tab 顺序切源，（b）各源独立日配额权重，（c）UI 的源切换开关。**先出 PRD + 灰度设计再动手，不默认恢复**。

### 5.2 权限与隐私收窄

- `manifest` 申请 `<all_urls>` 是为 LLM 任意 baseURL 兜底；Spec §5 明确"不申请与 BOSS 无关的宽泛 <all_urls>，除非后续证明必要"。评估：改为声明式 `optional_host_permissions` + 首次配置 baseURL 时运行时申请，或收窄为 `https://api.*` 常见 OpenAI 兼容域名 + zhipin。降低 Chrome 商店审核与用户信任成本。
- apiKey 存储：维持 chrome.storage.local（扩展私有区），但导出/日志路径一律脱敏（R1-1）。

### 5.3 长期稳定性

- **页面改版抗体**：选择器自检 probe 已交付——补「定期自检提醒」与自检结果版本化（selectors 带 schema 版本，改版 diff 可追踪）
- **e2e 评估**：Playwright 对 zhipin 的可用性评估（功能层评审列为非目标、可重估）；至少给 SPA 导航竞态（SPA route change 时的内容脚本状态残留）补假页测试
- **数据量增长**：desc 截断+hash 已有；评估 jobs 表全文检索必要性（Dexie indexing 不足时再议）

---

## 6. 落地方式（Trellis）

1. 本规划先评审 → 拆父任务 `next-roadmap-r0-r1`（工程）与 `next-roadmap-r2`（功能）
2. R0 建议单任务单分支：`r0-restore-build`（含 R0-1~R0-5），验收=门禁绿+真实冒烟
3. R1 每项独立 `r1-*` 任务（复用 Trellis PRD-only 模式），合并验收 `npm test && npm run build && npm run lint`
4. R2 每项走 brainstorm（至少出 PRD），R3 先出两页决策文档（多源职位池、权限收窄）再立项
5. 本文件与审计报告入库后，`docs/aegis/INDEX.md` 登记

## 7. 依赖关系

```text
R0（恢复基线）
 └─ R1（修正包，依赖 R0 的绿基线跑测试）
     ├─ R2-1 匹配反馈闭环（依赖 R1-6 对账工具，看板要准）
     ├─ R2-2 意图增强（依赖 R1-2 chatCompletion retry）
     └─ R2-3 看板补全（独立）
 └─ R3（季度，逻辑上依赖 R2 走完）
```