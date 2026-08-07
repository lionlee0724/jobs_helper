# 功能层梳理：短板 / 可优化 / 可弱化

**日期**：2026-08-07  
**来源**：代码与协议对照审查（`extension/**`、侧栏/浮层入口、SW 消息面）  
**性质**：产品与架构 backlog 输入；**不**改变已批准 Design Spec 的强制条款，落地前需单独立项与评审  
**关联**：`analysis-supplement.md`（结构/领域）· 审查会话 P0 工程门禁（另任务）

---

## 0. 能力地图（现状）

```text
                    ┌──────────── 侧栏 4 Tab ────────────┐
                    │ 运行 │ 消息 │ 策略 │ 设置(LLM/画像) │
                    └───────────────┬────────────────────┘
                                    │ chrome.runtime
                                    ▼
┌─────────────── Service Worker（策略 owner）────────────────┐
│ 环 A 职位线：startRun → tick → openChatBatch               │
│ 环 B 跟进线：tick 内 preferFollowUp → runFollowUpBatch     │
│ 消息助手：run / runCurrent / runAll(alarm) / import        │
│ 画像：sync + LLM 归纳                                      │
│ 分析：summary / events / export                            │
└───────────────┬────────────────────┬───────────────────────┘
                │ content/exec       │
                ▼                    ▼
         BOSS DOM 适配          消息页浮层
         (list/detail/chat/     (处理一轮/当前/
          profile/probe)         重置错误)
```

| 功能域 | 领域能力 | 编排落地 | UI 暴露 | 健康度 |
|--------|----------|----------|---------|--------|
| 限速启停 + 风控档 | 强 | 强 | 中（档位有，细项残） | ★★★★ |
| 硬否（城/薪/年限/词） | 强 | 强 | **弱**（几乎只有排除词） | ★★☆ |
| LLM 匹配 + 综合分 | 强 | 强 | 中（分/模式有，权重无） | ★★★★ |
| 当前列表锁定开聊 | 强 | 强 | 隐式（靠当前页） | ★★★★ |
| 多列表源 recommend/expect | 类型残留 | **已弱化** `JOB_SOURCES=['current']` | 无 | ★☆ |
| 环 B 自动跟进 | 强 | 有（与职位线耦合） | 无独立开关 | ★★★ |
| 消息助手批次/当前会话 | 强 | 强 | 中（入口有，配置残） | ★★★ |
| 导入会话 / 跑到清空 | 有 | SW 有 | **侧栏/浮层几乎未接** | ★★ |
| 意图分级 + handoff | 强（规则） | 强 | 弱（无 handoff 工作台） | ★★★ |
| 出站隐私护栏 | 强 | 强 | 无感知展示 | ★★★★ |
| 画像同步+LLM | 强 | 强 | 有 | ★★★★ |
| 统计/导出/看板 | 中 | 中 | 有 | ★★★ |
| 选择器 probe | 强 | content 有 | **侧栏未接按钮** | ★★ |
| 纯状态机 `run-state-machine` | 有 | **死代码**（scheduler 自管） | — | ★ |

**主路径合同（建议心智）**：

```text
配置：LLM + 画像 + 风险档 + 硬否 + 最低分
  → 当前职位列表「开始」→ 匹配 → 限速开聊
  → 消息页：导入/处理队列（graded）→ 简历/寒暄自动 · 敏感 handoff
  → 看板与导出复盘
```

---

## 1. 短板（能力在、闭环断）

### S1. 策略能力 ≫ 策略 UI（最大产品短板）

领域/KV 已支持，侧栏无入口或残缺：

| 已实现后端 | 侧栏现状 |
|------------|----------|
| `expectCities` / `minSalaryK` / `maxYearsGap` | 无表单项 → 硬否大半睡死 |
| `hourlyOpenChatLimit` / `activeHour*` / `activeWeekdays` | 仅靠 risk 档默认，难微调 |
| `humanize` | 无 |
| `matchLlmWeight` | 无 |
| `MessageAssist.autonomy` | 逻辑有，**UI 未配** |
| `batchSize`、处理到清空、导入会话 | SW 有 `runAll`/`import`；侧栏仅「处理一轮/当前」 |
| `probe_selectors` | 协议有，侧栏无按钮 |
| handoff 会话 | 事件有，**无待人工队列** |

README 中「硬否城市/薪资/年限」「导入会话」「处理到清空」在真实用户路径上半残或不可达。

### S2. 消息线双路径

| 路径 | 触发 | 特点 |
|------|------|------|
| 环 B | 职位线 `tick` 交替 | 临时 chat tab、与开聊抢拍 |
| 消息助手 | 手动 / `runAll` | 用户消息页、可独立于职位线 |

`processFollowUpOnTab` 为内核，但 `runFollowUpBatch` 仍内嵌意图处理，重复与漂移风险。用户难分清：「开始」会否回消息、只开消息助手会否投递。

### S3. 列表耗尽 / 分类锁失败语义弱

列表空则 `tick` 直接 return 等 alarm（防刷正确），UI 缺少「当前列表已扫完，请换筛选/滚动」明确态；分类锁 soft_fail 侧栏不易读。

### S4. 意图纯正则天花板

高危优先设计正确，新话术易漏；`other` 直接 LLM 回，安全靠出站护栏；handoff 无通知聚合。

### S5. 匹配缺反馈闭环

开聊后秒拒/已读不回不回流画像或阈值；无假阳性标注；默认分调整缺转化数据支撑。

### S6. 死代码与过时合同

- `domain/run-state-machine.ts`：测试在用，生产 scheduler 不用  
- `JobSource` recommend/expect 与 `JOB_SOURCES=['current']` 叙事分裂  
- 文案/placeholder 与默认分等现行值易漂移（另见工程 P0）

### S7. 工程门禁（正交）

`npm run build` / 默认分合同不一致等见任务 `08-07-p0-quality-gate`，不在本文展开实现。

---

## 2. 可优化（加码，按 ROI）

| ID | 项 | ROI 要点 |
|----|----|----------|
| O1 | **硬否 UI 接通**（城/薪/年限 + 已有排除词） | 能力已在；零算法成本降误投 |
| O2 | **消息线收口**：职位线默认只开聊；跟进唯一 owner=消息助手；环 B 可选默认 off | 消灭双路径 |
| O3 | **Handoff 工作台**（待人工列表、打开会话、已处理、可选通知） | 分级意图闭环 |
| O4 | **运行态可读**：phase 中文、ETA、列表空/冷却/分类锁独立原因 | 降低「假运行」 |
| O5 | **匹配可解释**：via/分拆解、跳过原因 TopN；用数据校准默认分 | 信任与调参 |
| O6 | **意图**：正则主干 + 仅 `other`/低置信走 LLM 分类 | 降乱回 |
| O7 | **scheduler 模块拆分** | 功能演进使能项，非功能本身 |

技术收口示意（O2）：

```text
职位线 = 发现 + 开聊（环 B 可关或极低频）
消息线 = 唯一跟进 owner（批 / 当前 / 可选跑到清空）
跟进实现只走 processFollowUpOnTab
```

---

## 3. 可弱化 / 可砍（减负）

| ID | 项 | 建议 |
|----|----|------|
| W1 | 多列表源自动轮询 | **正式废弃表面概念**；source 仅作分析标签 |
| W2 | 职位线内环 B | **默认 off**；跟进归消息助手 |
| W3 | `keywords_only` / `full_auto` | 藏高级；`full_auto` 二次确认 |
| W4 | `aggressive` 档 | 保留但强警告或首次确认 |
| W5 | `run-state-machine.ts` | **删或真接入**，禁止半吊子 |
| W6 | 策略区堆砌 ms 手填 | 主路径：档位+本轮顶+硬否+最低分；`custom` 才展开 |
| W7 | 图表/主题/快捷键 | 保持不加码 |
| W8 | 浮层与侧栏功能对等 | 浮层精简；配置/导入/跑清空只侧栏 |
| W9 | 出站 `\d{5,12}` | **收窄误报**，非再堆规则 |

---

## 4. 优先级矩阵（功能 backlog）

| 优先级 | 项 | 类型 |
|--------|----|------|
| P0（工程，另任务） | 构建 + 默认分合同门禁 | 发布可信 |
| P1a | 硬否 UI 接通 | 补短板 |
| P1b | 消息线产品收口（导入/autonomy/弱化环 B） | 结构 |
| P1c | 运行态/异常/列表空可读 | 体验 |
| P2 | Handoff 工作台 | 增值 |
| P2 | scheduler 拆分 | 使能 |
| P3 | 意图 LLM 辅助 / 反馈学习 | 增强 |
| 砍/藏 | 多源叙事、keywords_only 主路径、full_auto 裸奔、死状态机 | 减负 |

**建议落地顺序**：工程 P0 关门 → P1a 硬否 UI → P1b 消息收口（可与 scheduler 拆分穿插）→ P1c → P2。

---

## 5. 非目标（本文不要求立刻做）

- 多招聘站点、桌面端、系统级后台  
- Playwright e2e 必选  
- 改匹配权重公式或重做 LLM prompt 架构（除非单独立项）  
- 静默扩大自动化（与 graded 默认、隐私护栏相悖）

---

## 6. 后续立项提示

可拆父任务示例（名称仅建议）：

1. `func-hard-rules-ui` — 城/薪/年限/排除词侧栏与保存归一  
2. `func-message-line-unify` — 导入、autonomy、runAll 进度、环 B 默认 off  
3. `func-run-status-ux` — 运行态与 anomaly/列表空文案  
4. `func-handoff-queue` — 待人工队列  
5. 工程：`p0-quality-gate`、`scheduler-module-split`（已有规划线）

每项需独立 PRD/验收；**本文不是实现批准**。

---

## 7. 关键路径（代码锚点）

| 主题 | 路径 |
|------|------|
| 策略/硬否字段 | `extension/shared/types.ts` → `Policy` |
| 硬否求值 | `extension/domain/match-rules.ts` |
| 匹配决策 | `extension/domain/match-decision.ts` |
| 意图 | `extension/domain/intent.ts` |
| 出站护栏 | `extension/domain/chat-llm.ts` → `screenOutgoingText` |
| 主编排 | `extension/background/scheduler.ts` |
| 消息清空循环 | `extension/background/message-assist-loop.ts` |
| UI 入口 | `extension/ui/sidepanel/main.ts`、`content/message-overlay.ts` |
| 列表源 | `JOB_SOURCES` in `shared/types.ts` |
| 死状态机 | `extension/domain/run-state-machine.ts` |
