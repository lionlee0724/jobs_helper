# 全面代码审计报告 — BOSS 求职副驾驶（2026-08-14）

Date: `2026-08-14`  
Scope: `E:\coding\Jobs` 全仓（extension/background · content · domain · data · ui/shared · tests · 构建/依赖/文档）  
Method: 五路并行子代理分层审计 + 主会话逐条验证（基线命令实测 + 源码抽查）  
Baseline: git `main` (2 commits) + 工作树未提交改动（`service-worker.ts` 重写、`.eslintrc.js`/`.prettierrc` 新增、README/package.json 修改）

---

## 1. 执行摘要

| 维度 | 结论 |
|------|------|
| **构建** | ❌ **当前工作树 `npm run build` 失败**（tsc TS2308），不可发布 |
| **运行** | ❌ **当前工作树即使构建通过也不可运行**（事件接线全灭，见 P0-1） |
| **测试** | ✅ vitest **244/244 通过**（29 文件），域层纯函数覆盖扎实 |
| **lint** | ❌ ESLint 未安装（声明的 devDep 不在 node_modules），`npm run lint` 不可用 |
| **架构** | ✅ 分层（content/domain/background/data/ui）清晰，同层内职责边界基本守约 |
| **Spec 符合度** | ✅ R1–R12 主线全部落地（R5 三源为已声明 Spec 债务）；薄切片合同满足 |
| **隐私** | ⚠️ 导出含 LLM apiKey（P1-1）；其余本地存储无外发 |
| **风险控制** | ✅ 硬否/限速/退避/护栏实现扎实且基本可测（有测试锁定的合同） |
| **整体健康度** | 5.5/10——**分层设计优秀、domain/data 质量高，但「接线层」与「工程卫生」当前处于断裂状态** |

**最重要的结论（一句话）**：这个仓库的「肌肉」（纯函数/数据/测试）是健康的，但「神经系统」（service-worker 事件接线）和「骨骼」（构建/依赖）当前是断的——**未提交的一次 SW 重写把扩展掏成了空壳**，`tsc` 报错，且 dist/ 里还留着上一次的旧构建（0.1.15）。所有后续开发必须先跨过 R0 抢救。

---

## 2. 基线实测（可复现）

```text
node node_modules/typescript/bin/tsc --noEmit   → 失败
  extension/background/service-worker.ts(12,1): error TS2308:
  Module './scheduler.js' has already exported a member named 'onAlarm'.

node node_modules/vitest/vitest.mjs run         → 29 files, 244/244 passed

npm run lint                                    → 失败（eslint 未安装）
npm run build                                   → 失败（tsc 报错；vite 阶段未达）
npm test                                        → 通过（vitest 244/244）
```

依赖事实（`package.json` vs `node_modules`）：

| 包 | devDependencies 声明 | node_modules | 被 scripts 引用 |
|----|---------------------|--------------|-----------------|
| `vitest` | ❌ **已被移除**（历史 2.1.8） | ✅ 残留 | ✅ `test`/`test:watch` |
| `prettier` | ❌ **从未声明** | ❌ | ✅ `format`/`lint:fix` |
| `eslint` | ✅ 已声明（^9.10.0） | ❌ 未安装 | ✅ `lint` / `lint:fix` |
| `@typescript-eslint/*` | ✅ 已声明 | ? | 经 eslint |

→ 结论：**`npm test`/`npm run lint`/`npm run build` 三者在「全新 npm install」环境下没有一个是绿色可用的**；当前机器的 node_modules 是历史残留凑巧能跑 vitest。

---

## 3. P0 — 致命（当前工作树不可用）

### P0-1 🔴 未提交的 `service-worker.ts` 重写 = 扩展「被掏空」

`extension/background/service-worker.ts`（工作树版本，24 行）是一个纯 re-export barrel，**删掉了旧版（298 行，git HEAD 可见）的全部事件接线**：

| 事件/入口 | 旧版（HEAD） | 新版（工作树） | 后果 |
|-----------|--------------|----------------|------|
| `chrome.runtime.onMessage` + 11 分支 `handleMessage`（run/kv/msgAssist/handoff/jobs/llm/analytics/export/content-exec…） | ✅ | ❌ 无 | 侧栏(`ui/sidepanel/main.ts:1101`)、看板(`ui/report/main.ts:37`)、消息浮层(`content/message-overlay.ts:162,181,212`) 所有 sendMessage 无应答 |
| `chrome.alarms.onAlarm`（dispatch 到 `scheduler.onAlarm` + `message-assist-loop.onAlarm`） | ✅ | ❌ 无 | alarm 每 1 分钟空转，tick/消息循环永不触发 |
| `chrome.runtime.onInstalled/onStartup` → `ensureAlarms()` + 侧栏行为 | ✅ | ❌ 无 | （`scheduler.ts:173` 模块级调用仍在，但无监听者） |
| `chrome.tabs.onRemoved` → `handleWorkerTabRemoved` | ✅ | ❌ 无 | 工作标签被关不暂停 |
| `chrome.sidePanel.setPanelBehavior` / `chrome.action.onClicked` | ✅ | ❌ 无 | **点击工具栏图标打不开侧栏** |
| `export *`（scheduler.js 与 message-assist-loop.js 均导出 `onAlarm`） | — | ⚠️ 冲突 | **TS2308 编译直接失败** |

影响链（已逐点核实，grep 全仓 `addListener` 仅剩 `content/main.ts:5` 与 `tab-runtime.ts:422` 函数内一处）：

```text
UI 发消息 → chrome.runtime 无人接收 → Promise reject / 无响应（界面"假成功"）
alarm 触发 → 无 onAlarm 监听 → tick 永不执行 → 整机不动
worker tab 关闭 → 无 onRemoved → 状态不暂停
```

**为什么会出现**：意图是「把 298 行入口拆薄」，但拆法错了——`scheduler.ts` 等模块都只导出**函数**，从不自带接线（接线职责本就属于服务工作者入口）。barrel 只 re-export 不会执行任何 `addListener`。README v0.2.0 声称「清理 Service Worker stub」与事实完全相反。

**修复方向**（二选一，推荐②）：
① 回滚：`git checkout HEAD -- extension/background/service-worker.ts`，恢复旧入口；
② 正解：把旧版的接线原样搬入新 barrel（onMessage 路由、alarms/tabs onAlarm 双 dispatch、onInstalled/onStartup、sidePanel/action），并显式 re-export 消歧（例如 `export { onAlarm as schedulerOnAlarm } from './scheduler.js'`；`export { onAlarm as msgAssistOnAlarm } from './message-assist-loop.js'`），最后给 `service-worker` 补一个接线测试。

### P0-2 🟠 依赖声明漂移 → 全新环境三项脚本全瘫

见 §2 表。修复：`vitest` 回归 devDeps、`prettier` 补声明、`eslint`+`@typescript-eslint/*` 安装并锁定（且注意：`.eslintrc.js` 用了 `parserOptions.project` 类型感知规则，ESLint 9 默认 flat config，需 `ESLINT_USE_FLAT_CONFIG=false` 或迁移 `eslint.config.js`，否则 eslintrc 不生效）。

### P0-3 🟠 版本双轨

- `package.json` `0.2.0`（工作树） vs `extension/manifest.config.ts` `0.1.15`。
- README 明确约定「package.json 与 manifest 对齐」，现状违反 → 发版核对会出错。
- `dist/manifest.json` 还是 0.1.15（旧构建，忽略未重建）。

---

## 4. P1 — 重要（审计确认）

### P1-1 🟠 导出含 apiKey（隐私）

`export/all` 的载荷含 `kv.getAllKv()`，其中 `llm` 是完整 `LlmConfig`（含 `apiKey`）。用户一旦导出 JSON 分享/备份，密钥外流。**修复**：导出时 `llm: { ...llm, apiKey: '***' }`，单测锁死。

### P1-2 🟠 聊天回复 LLM 路径无重试（合同不一致）

| 调用方 | retries | 状态 |
|--------|---------|------|
| `open-chat-flow.ts:455`（匹配） | `MATCH_LLM_EXTRA_RETRIES`(=2, `match-display.ts:73`) | ✅ 有重试 |
| `follow-up-flow.ts:362`（聊天回复） | 默认 0 | ❌ 无重试（一次网络抖动就 handoff/失败） |
| `profile-sync.ts:42`（画像归纳） | 默认 0 | ❌ 无重试 |

README/计划宣称 LLM「重试+退避」是全链路合同；回复路径漏了。修复：回复路径传 `retries: 1~2`。

### P1-3 🟠 静默吞错模式

- `scheduler.ts:223` `await pruneIfNeeded().catch(() => undefined)`、`startRun` 分类锁定 catch `return true`、多处 `.catch(() => undefined)`——保留策略/分类恢复失败**无事件、无日志**，用户只会看到「假运行」。修复：失败至少 `appendEvent({type:'error', payload:{op:...}})`。

### P1-4 🟡 死代码/双叙事（已有 W5 评审，未处理）

- `domain/run-state-machine.ts`：测试在用、生产 `scheduler.ts` 自管状态，**死代码**；README 声称的「状态机」与实现是两套。
- `JobSource` recommend/expect 类型残留 vs `JOB_SOURCES=['current']`（功能层评审 W1 已建议正式废弃表面概念）。
- 处置：删或真接入（推荐删 + 收敛类型叙事为 `current` 单一来源）。

### P1-5 🟡 事件保留与看板对账缺口（数据层，理论性）

- `retention.ts` 删老 events 后不重算对应 `daily_stats`（spec 4.4 的「增量写 + 对账」缺了删除侧）；handoff 类事件不在保留策略覆盖说明内。
- `db.ts` 只有 `version(1)` 无迁移脚手架——下次加字段即「老库字段缺失」而无升级路径。
- 影响面小（个人使用规模），但属于「数据合同完整性」缺口，建议 R1 修。

### P1-6 🟡 `isPlausibleSalary` 对「元/天」形态放行过宽

`obfuscated-text.ts:119` 把 `100-150元/天` 判为可信薪资（matches design dimension but 会被 `parseSalaryRange` 当作正常薪资喂给硬否/匹配）。日结岗位月薪概念被污染。建议：`元/天|元/时` 形态单独打标或降级为「薪资缺失」上传到匹配 TODO + 硬否排除。⚠️ 注意：审计子代理曾报「max>999 未校验」——**已证伪**：`isPlausibleSalary:113` 有 `max > 999 → false`。

### P1-7 🟡 UI 表单与状态（侧栏，抽查确认）

- 数字输入校验弱：`dailyLimit`/`replyLimit` 等 `parseInt()||undefined`（`sidepanel/main.ts:974-980`），负数/超大无 clamp 无提示；只有 `msgBatchSize` 与间隔字段有 clamp。
- 状态轮询（`run/status` 5s、`messageAssist/progress`）无 `visibilitychange` 即时刷新，切回侧栏有陈旧窗口。
- 注意：**侧栏/report 的 innerHTML 渲染点均带转义**（`v()` 于 `main.ts:1038`、`escapeHtml` 于 `report/main.ts:230`）——UI 子代理报的「innerHTML XSS」P0 类断言**大部分证伪**；仅 `sidepanel/main.ts:895` handoff 列表与 `:112` 模板区建议复核转义覆盖。

## 5. P2/P3 — 次要 / 债务（按层汇总，均经主会话抽查或注明可信度）

### background
- `tick` 互斥为「粗粒度 inFlight + 协作式 generation 取消」（`run-context.ts:54`）：不致双跑放大（alarm 1min 粒度 + 单 SW），但 stop 后瞬间 start 的竞态无测试锁死 → 补单测。
- `scheduleSoonTick` 用 `setTimeout`（`scheduler.ts:292`）：SW 挂起期间可能不执行，靠 1min alarm 兜底——符合「alarm 为主、setTimeout 为辅」的既定策略，注释即可。
- `llm-client.ts` host 权限 `listGrantedOrigins`：测试环境空数组导致 request 路径必走——仅影响测试，生产按权限 API 正常。

### content
- `probe.ts:216 probeGroup` 无 try/catch：非法/变异选择器字符串（含用户 suggest）会使整个 `probe_selectors` 崩溃 → 加 try/catch（低风险，建议顺手修）。
- `list.ts:188-197`：`querySelectorAll` 快照在 SPA 重渲染后可能含已脱离节点 → 加 `isConnected` 过滤（健壮性，非致命）。
- `chat.ts` `writeInput` 用 `Object.getOwnPropertyDescriptor` 绕过 React value 拦截：典型「黑科技」，React/BOSS 升级即碎 → 记录为持久风险，预留 `InputEvent` 方案（P3）。
- `selectors.ts` `OPEN_CHAT_BTN_SELECTORS` 兜底 `[class*="btn-startchat"]` 过宽；`chat.ts:291 findResumeButton` 排除词（`/上传|制作/`）过严可能漏真实按钮 → 属于**需实页标定**的启发式，按 README 既定「改版先改 selectors」流程处理（P3，不进 R1）。
- `main.ts:22` overlay 轮询 setInterval(1500ms)：SPA 切换挂载有延迟 → 可用 MutationObserver 优化（P3）。

### domain（健康度最高，几乎全是测试补漏）
- **关键词封顶 60：已正确实现**（`keyword-match.ts` `keywordScore` 内部 `ratio*60`，balanced/keywords_only 共用；README 合同一致）——子代理 P0 误报，结论修正；仅补一条「balanced 高分关键词」混合测试锁死。
- 硬否「证据不足不拒绝」成立；补边界测试：999999K、无年限 JD、单值薪资、`元/天`。
- `match-llm.ts:29` desc 硬截断 6000 字符（超大 JD token 超限风险，P3）；`parseMatchResult` 分数/JSON fallback 的 malformed 分支补测试。
- `intent.ts` 正则主干 + `chat-llm.ts` 出站护栏均独立良好；护栏在回复路径是必过的（`follow-up-flow.ts:384` 实测确认）。补「护栏命中→handoff」集成测试；出站 `\d{5,12}` 误报收窄（W9 遗留，P3）。
- `risk.ts` 周末/跨天边界（周日夜间 `msUntilActiveWindow`）**已有 08-08 立项**（`08-08-remove-weekend-delivery-lock`），按 PRD 执行即可，不重复列。

### data/shared
- KV `bumpHourlyOpened` 等 read-modify-write 非原子：扩展为**单一 SW 写者**，实际并发窗口很小（P3）；若未来拆多入口需收敛。
- `csv-export.ts` 转义正确（含 `",\r\n` 与 BOM）——子代理「不转行」误报，证伪。
- `boss-urls.ts` 的 list/recommend 变体判定（P3 观察）。

### 测试覆盖缺口（审计最想强调的短板）
- **background 层：0 测试**。SW 接线、消息协议路由、startRun/stopRun 门闩、tick 异常分支全部裸奔——而正是这一层出了 P0-1。README v0.2.0 声称「提升测试覆盖率」与事实不符。
- content 层仅 `boss-selectors-dom.test.ts`（14 例）；`bridge.ts`/`message-overlay.ts`/`probe.ts` 直接逻辑无测试。
- UI 仅 `ui-theme-shortcuts`/`runtime-response`/`suitable-rate-chart` 四个小工具有测试；侧栏 46KB 主体 0 测试。

---

## 6. Spec 符合度矩阵

| ID | 条款 | 状态 | 备注 |
|----|------|------|------|
| R1 | Chrome MV3 纯扩展 | ✅ | manifest v3，无本机服务 |
| R2 | 限速全自动、默认关、未填不可跑 | ✅ | `canStart` 门闩 + R11 显式上限 |
| R3 | LLM 为主匹配 | ✅ | 综合分 LLM×0.75 + 关键词×0.25 |
| R4 | 简历页同步+可编辑缓存 | ✅ | `profile-sync.ts` + KV |
| R5 | 职位池三源（推荐/期望1/期望2） | 🟡 **Spec 债务（声明不交付）** | `JOB_SOURCES=['current']` 当前列表锁定；重新评估见路线图 R3 |
| R6 | v1 不做本地硬过滤 | ✅→已超规格 | 阶段切片明确交付硬否四项 + 跳过计数（父 spec 细项另案修订） |
| R7 | OpenAI 兼容 baseURL/key/model | ✅ | `llm-client.ts` |
| R8 | 首条默认招呼 | ✅ | 开聊不自定义文案 |
| R9 | 后台执行（非前台标签） | ✅ | worker tab + alarm 持久状态机 |
| R10 | 发简历动作 + LLM 跟进 | ✅ | 单内核 FollowUpKernel + 双入口（ADR-0001） |
| R11 | 限速参数自填、默认不跑 | ✅ | 显式日上限合同（薄切片 §2） |
| R12 | IndexedDB 轻量分析库 | ✅ | Dexie 四表 + daily_stats 增量 |
| 薄切片 | 关键词封顶 60 / 环 B 默认 on / 单内核 / 硬否 UI+计数 / sidepanel 不 import llm-client | ✅（①③④已代码验证；②行为须 R0 后冒烟） | |

→ 结论：**产品能力与已批准 Spec 主线一致，规范与文档（spec/plan/ADR/roadmap）是本仓最大的资产**；工程层破坏与产品层无关。

---

## 7. 风险排序（修复建议的执行顺序）

| 序 | 项 | 证据 | 修复成本 |
|----|----|------|----------|
| 1 | P0-1 SW 接线 + TS2308 | tsc 实测 + grep 全仓 | 0.5–1 天（回滚即 10 分钟） |
| 2 | P0-2 依赖三件套 | package.json vs node_modules | 0.5 天 |
| 3 | P0-3 版本对齐 + README 修正 | manifest vs package.json | 10 分钟 |
| 4 | P1-1 导出脱敏 | export/all 载荷 | 半天 + 测试 |
| 5 | P1-2 回复重试 | follow-up-flow:362 | 半天 |
| 6 | P1-3 错误可见性 | scheduler:223 等 | 半天 |
| 7 | P1-4/P1-5/P1-6 死代码/DB 迁移/元天 | 见上 | 各半天 |
| 8 | P1-7 UI 校验/刷新 | sidepanel 抽查 | 1 天 |
| 9 | background 层首个测试 | 新增 test/bg/* | 1 天 |

**建议先跑 `git diff` 确认 SW 重写的真实意图再决定回滚或修复**——若意图是「把入口拆薄」，就按 R0-1 的②方案补接线。

---

## 8. 审计方法与可信度说明

- 五路并行子代理产出原始发现（background/domain/data 三路质量高且大部分经主会话核实）；content 与 UI 两路在超限后退化重复，**其 P0 级断言均经主会话逐条复核，多数证伪或降级**。
- 复核清单（证伪/修正项）：关键词封顶未生效（证伪）、CSV 不转行（证伪）、innerHTML XSS（大部分证伪，有转义）、`isPlausibleSalary` 无上限（证伪）、prune 未接入 tick（证伪）、`waitTabComplete` 未定义（证伪，tab-runtime.ts:409 已实现）、SW「消息处理搬进模块」假设（证伪，模块只导出函数不接线）。
- 未实机验证项：真实 BOSS 页面交互（选择器命中、发简历流程）——需用户浏览器冒烟（即路线图 R0-5）。