# 实施与重构计划

本文档用于追踪项目的开发进度。它分为两个部分：
1.  **活跃计划 (Active Plan)**: 当前正在进行的重构和升级任务。
2.  **历史归档 (Historical Archives)**: 过去的功能开发和实施记录。

**详细实施指南**: 请参阅 [06_PHASE_2_3_4_PLAN.md](./06_PHASE_2_3_4_PLAN.md) 获取阶段 2-4 的详细技术方案。

---

## 一、活跃计划：架构重构与稳定性升级 (v3.1)

**目标**: 修复线上 Bug，统一代码架构，建立自动化测试体系。

### [x] 阶段 1: 代码健康检查 (Completed)
- [x] **统一配置源**: 合并 `CONSTANTS` 和 `CONFIG`，消除冗余配置。
- [x] **文档重构**: 建立 `docs/` 目录，规范化文档结构。

### [ ] 阶段 2: 核心问题修复 - DOM 选择器 (Planned)
- [ ] **审查 BOSS 选择器**: 验证 `li.job-card-box`, `.job-name` 等核心选择器是否失效。
- [x] **审查 猎聘 选择器**: 验证 `.job-list-item`, `.btn-chat` 等核心选择器是否失效。
- [ ] **增强选择器健壮性**: 添加多重 fallback 机制。

### [ ] 阶段 3: 异步流程与状态管理 (Planned)
- [x] **竞态条件分析**: 检查翻页和点击操作中的时序问题。
- [ ] **重构 waitForElement**: 增加重试 (Retry) 和轮询 (Polling) 机制。
- [ ] **通用重试工具**: 实现 `Core.retry`。
- [x] **修复 UI 初始化竞态**: 解决面板不显示的问题。

### [ ] 阶段 4: 工程化升级 (Planned)
- [ ] **核心工具单元测试**: 为 `Core` 模块编写 Jest 测试。
- [ ] **日志标准化**: 全局替换 `console.log` 为 `Core.log`。

---

## 二、历史归档 (Historical Archives)

<details>
<summary>点击展开：v3.0 实施计划 (Implementation Plan)</summary>

### 1. 核心架构升级
- 引入策略模式 (Strategy Pattern) 分离平台逻辑。
- 创建统一的 UI 管理器 (UIManager)。

### 2. 功能开发
- 实现 BOSS 直聘的基础投递。
- 实现 猎聘 的基础投递。
- 添加跨域存储支持 (StorageManager)。

### 3. 性能优化
- 引入性能监控模块 (Core.performance)。
- 优化 DOM 操作频率。
</details>

<details>
<summary>点击展开：v2.0 任务清单 (Task Implementation)</summary>

- [x] 基础框架搭建
- [x] 关键词筛选功能
- [x] 日志面板开发
- [x] Tampermonkey 适配
</details>
