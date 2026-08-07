# BOSS 求职副驾驶 全盘分析补充

**日期**：2026-08-01  
**来源**：`E:\coding\jobs` 目录全盘代码分析（结构、领域、数据流、UI、测试、Trellis 规范交叉验证）

## 1. 项目核心定位

- **产品**：本地 Chrome MV3 扩展「BOSS 求职副驾驶」
- **核心价值**：LLM 职位匹配 + 风控限速开聊 + 分级聊天跟进 + 本地统计导出
- **非目标**：桌面端、Python 海投、多招聘站点、系统级后台

## 2. 架构与分层（核心规范）

### 分层原则（必须遵守）

- **content**：仅 DOM 适配 + 行为拟真（humanize），不持有策略
- **domain**：纯函数（可独立单测），无 DOM/无 chrome.*
- **background**：唯一策略 owner（policy、LLM、alarm、队列）
- **data**：存储读写（KV + Dexie）
- **ui**：只读显示（不重新实现匹配/限速）

**依赖方向**（硬规则）：
content → domain → background → data → ui

### 技术栈

- 构建：Vite 5 + @crxjs/vite-plugin
- 语言：TypeScript（strict）
- 存储：chrome.storage.local + Dexie IndexedDB
- LLM：OpenAI 兼容（用户配置）
- 测试：Vitest（domain 为主）

## 3. 领域模型

### 核心实体

- **Job**：职位信息（title、company、salary、city、desc、source）
- **Profile**：用户简历画像（summary、skills、rawText 等）
- **Policy**：限速、风险档位、硬否字段、matchMode
- **MatchDecision**：匹配结果（suitable、score、tier、via、reasons）
- **ChatIntent**：意图分类（resume_request → 自动发简历；salary/interview/contact → 转人工）
- **RunState**：运行态（idle / running / paused）

### 关键不变量

1. 硬否规则**优先、确定性**；证据不足**不拒绝**
2. LLM 分档 0-100；综合分 = LLM×0.75 + 关键词×0.25（关键词封顶 60）
3. 默认开聊阈值 **50**

4. LLM 失败 **fail-soft**（via=llm_error，不写 score，不降分冒充语义结论）
5. 连续匹配 LLM 失败 ≥3 → 本轮 pause

## 4. 端到端数据流

### 环 A — 职位开聊
1. 启动 RunState
2. 硬否检查
3. LLM 匹配（+retry）
4. 综合分决策
5. 合适则限速开聊 + 拟真动作

### 环 B — 聊天跟进
1. 队列排序（未读优先）
2. classifyIntent
3. 对应处置（自动动作 / LLM 回复 / 转人工 / 忽略）

## 5. 关键模块（维护地图）

- **background/scheduler.ts**：主编排面（复杂度最高）
- **content/adapter/boss/**：改版热点（selectors.ts、font-calibration.ts）
- **domain/**：纯函数（match-decision.ts、intent.ts、policy.ts）
- **data/**：KV + Dexie（jobs/events/chat_threads/daily_stats）
- **ui/**：侧栏 4 Tab + Report 看板

## 6. 测试与质量

- Vitest 覆盖 domain 合同
- 选择器自检 probe 工具
- 质量要求：domain 纯函数必须测试；content 适配灰测

## 7. 风险与维护建议

- BOSS 限流/封号风险（保守默认 + 退避）
- 页面改版（优先 selectors.ts）
- LLM 合同（重试 + fail-soft 语义）
- MV3 生命周期（alarm 持久化状态机）

## 8. Trellis 任务信号

- 父任务：07-28-product-match-msg-assist
- 归档主题：match LLM retry fail-soft、sidepanel-tabs、match score exclude UX

---

**本文档作为 Aegis 补充，供后续会话复用。**

## 9. 后续分析

- 2026-08-07 功能层（短板 / 可优化 / 可弱化）：`docs/aegis/functional-layer-review-2026-08-07.md`