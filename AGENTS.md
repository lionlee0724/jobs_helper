# Agent 编码指南 (AGENTS.md)

本仓库包含用于自动化 "BOSS 直聘" 和 "猎聘" 求职投递的 UserScripts (油猴脚本)。

## 1. 项目背景与环境
*   **类型**: 基于浏览器的 UserScripts (`.js`)。
*   **环境**: 浏览器 (Chrome/Edge) + Tampermonkey (油猴)。
*   **API**: 使用 `GM_` 系列 API (`GM_xmlhttpRequest`, `GM_setValue`, `GM_openInTab` 等)。
*   **关键文件**:
    *   `Boss_helper.js`: BOSS 直聘脚本。
    *   `liepin_helper.js`: 猎聘脚本。
    *   `FUNCTION_CHECKLIST.md`: 功能对比清单。
    *   `TASK_IMPLEMENTATION.md`: 当前任务列表与技术规格。

## 2. 构建、测试与代码检查
*   **构建**: 无。直接编辑源码文件。
*   **代码检查 (Lint)**: 无自动 Linter。依赖人工代码审查并遵守本指南。
*   **测试**:
    *   **手动测试**: 将代码复制到 Tampermonkey/Violentmonkey 并在目标网站 (`zhipin.com`, `liepin.com`) 运行。
    *   **验证**: 检查控制台日志 (Console Logs) 和 UI 面板以确认行为符合预期。
    *   **诊断**: 使用 `Core.log()` 进行调试。

## 3. 代码风格与规范

### 通用规范
*   **语言**: JavaScript (ES6+)。
*   **注释**: **必须使用简体中文**。函数/类使用 JSDoc 格式。
*   **命名**:
    *   变量/函数: `camelCase` (小驼峰，如 `processJobCard`, `lastAiDate`)。
    *   常量: `UPPER_SNAKE_CASE` (大写蛇形，如 `BASIC_INTERVAL`, `STORAGE_KEYS`)。
    *   类: `PascalCase` (大驼峰)。
    *   **严禁使用拼音**，必须使用英文单词。

### 文件特定风格 (重要)
请严格遵守当前编辑文件的既有风格：

| 特性 | `Boss_helper.js` | `liepin_helper.js` |
| :--- | :--- | :--- |
| **缩进** | **2 空格** | **4 空格** |
| **引号** | 双引号 (`"`) | 单引号 (`'`) |
| **状态管理** | `CONFIG` 对象, `state` 对象 | `CONFIG` 对象, `state` 对象 |

### 错误处理与日志
*   **日志系统**: **禁止**直接使用 `console.log` 反馈给用户。必须使用自定义的 `Core.log` 系统。
*   **日志级别**:
    *   `DEBUG`: 调试信息 (`🔍`)。
    *   `INFO`: 一般信息 (`ℹ️`)。
    *   `SUCCESS`: 成功操作 (`✅`)。
    *   `WARNING`: 警告 (`⚠️`)。
    *   `ERROR`: 错误 (`❌`)。
    *   `SKIP`: 跳过操作 (`⏭️`)。
*   **格式**: `Core.log("消息内容", "LEVEL")`。

## 4. 架构与模式
*   **UI 覆盖层**: 脚本会创建悬浮 UI 面板。修改 UI 需更新 `UI.createPanel` 或类似方法。
*   **状态管理**:
    *   持久化: 通过 `localStorage` 或 `GM_setValue` 保存。
    *   运行时: 使用全局 `state` 对象。
*   **异步操作**:
    *   使用 `await/async`。
    *   严格遵守 `CONFIG` 中的延迟设置 (`BASIC_INTERVAL`, `OPERATION_INTERVAL`) 以避免被反爬虫检测。

## 5. 工作流规则
1.  **阅读上下文**: 编辑前，务必阅读 `TASK_IMPLEMENTATION.md` 了解当前需求。
2.  **保持一致性**: 检查 `FUNCTION_CHECKLIST.md`，尽可能保持 BOSS 直聘和猎聘脚本的功能对齐。
3.  **安全性**: 严禁删除 `GM_` 头部信息或许可证声明。
4.  **无外部依赖**: 除非必要并通过 `@require` 添加，否则不引入外部库。

## 6. 上下文特定指令
*   **日志增强**: 增强日志的可见性。明确显示 成功/失败/跳过 的状态。
*   **兼容性**: 确保向后兼容。
*   **语言规范**: 代码标识符使用英文，注释使用中文。
