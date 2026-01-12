# Agent 编码指南 (AGENTS.md)

本仓库包含用于自动化 "BOSS 直聘" 和 "猎聘" 求职投递的 UserScripts (油猴脚本)。

## 1. 项目背景与环境
*   **类型**: 基于浏览器的 UserScripts (`.js`)。
*   **环境**: 浏览器 (Chrome/Edge) + Tampermonkey/ScriptCat/Greasemonkey。
*   **API**: 使用 `GM_` 系列 API (`GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `GM_openInTab` 等)。
*   **关键文件**:
    *   `Boss_helper.js`: BOSS 直聘脚本 (Legacy/Deprecated - use Universal instead)。
    *   `liepin_helper.js`: 猎聘脚本 (4空格缩进，单引号)。
    *   `Universal_Job_Helper.js`: 通用求职助手 (Primary - Supports BOSS & Liepin)。
    *   `FUNCTION_CHECKLIST.md`: 功能对比清单。
    *   `TASK_IMPLEMENTATION.md`: 当前任务列表与技术规格。
    *   `IMPLEMENTATION_PLAN_CN.md`: 实施计划文档。

## 2. 构建、测试与代码检查

### 构建命令
*   **构建**: 无独立的构建步骤。`npm run build` 命令仅输出提示信息，因为油猴脚本是直接在浏览器中运行的。
*   **打包**: 无。
*   **依赖管理**:
    *   **开发依赖**: 通过 `npm install` 管理 `jest`, `eslint` 等开发工具。
    *   **外部库**: 通过 UserScript 的 `@require` 指令在运行时加载 (如 `crypto-js`)。

### 测试命令
项目使用 **Jest** 进行自动化测试。

*   **运行所有测试**:
    ```bash
    npm test
    ```
*   **监视模式 (Watch Mode)**:
    ```bash
    npm run test:watch
    ```
*   **单元测试**:
    ```bash
    npm run test:unit
    ```
*   **端到端 (E2E) 测试**:
    ```bash
    npm run test:e2e
    ```
*   **生成测试覆盖率报告**:
    ```bash
    npm run test:coverage
    ```
*   **手动集成测试**:
    1.  将脚本代码复制到 Tampermonkey/Violentmonkey。
    2.  在目标网站 (`zhipin.com` 或 `liepin.com`) 上运行。
    3.  验证 UI 面板和各项功能是否按预期工作。

### 代码检查 (Lint)
项目使用 **ESLint** 进行代码规范和质量检查。

*   **运行 Lint 检查**:
    ```bash
    npm run lint
    ```
*   **手动检查补充**:
    *   使用浏览器开发者工具的 Console 检查运行时语法错误。
    *   验证 JSDoc 注释是否完整、清晰。

## 3. 代码风格与规范

### 语言与语法
*   **语言版本**: JavaScript ES6+ (支持 `async/await`, 箭头函数, 模板字符串, `const/let`)。
*   **模块化**: 使用 IIFE (立即执行函数表达式) 包装，避免全局污染。
*   **严格模式**: 必须使用 `"use strict"` 指令。

### 命名约定
*   **变量/函数**: `camelCase` (小驼峰)
    *   正确: `processJobCard`, `sendGreetingMessage`
*   **常量**: `UPPER_SNAKE_CASE` (大写蛇形)
    *   正确: `BASIC_INTERVAL`, `STORAGE_KEYS`
*   **类/构造函数**: `PascalCase` (大驼峰)
    *   正确: `JobProcessor`, `UIManager`
*   **禁止**: 拼音命名，必须使用英文单词。

### 注释规范
*   **语言**: 必须使用简体中文。
*   **格式**: 使用 JSDoc 标准格式。
*   **位置**: 函数前必须有 JSDoc 注释，复杂逻辑要有行内注释。
```javascript
/**
 * 处理职位卡片
 * @param {Object} jobCard - 职位卡片DOM元素
 * @param {Object} options - 处理选项
 * @returns {boolean} 处理是否成功
 */
function processJobCard(jobCard, options) {
  // 检查职位是否符合筛选条件
  if (!matchesFilters(jobCard)) {
    return false;
  }
  // ...
}
```

### 格式化规范

#### 缩进与引号
| 文件 | 缩进 | 引号 | 分号 | 换行 |
|---|---|---|---|---|
| `Boss_helper.js` | **2 空格** | 双引号 `"` | 必需 | Unix (LF) |
| `liepin_helper.js`| **4 空格** | 单引号 `'` | 必需 | Unix (LF) |

#### 代码结构
*   **对象字面量**: 属性间换行，保持清晰。
```javascript
const CONFIG = {
  BASIC_INTERVAL: 1000,
  COLORS: {
    primary: '#4285f4',
  }
};
```

### 错误处理
*   **异常捕获**: 使用 `try/catch`，避免空 `catch` 块。
*   **日志系统**: **禁止**直接使用 `console.log`。必须使用 `Core.log()` 进行分级日志记录。
```javascript
try {
  await riskyOperation();
  Core.log("操作成功完成", "SUCCESS");
} catch (error) {
  Core.log(`操作失败: ${error.message}`, "ERROR");
}
```

### 异步编程
*   **语法**: 优先使用 `async/await`。
*   **延迟控制**: 严格遵守 `CONFIG` 中的延迟设置，模拟人类行为。

## 4. 架构模式与设计原则

*   **UI 架构**: 创建悬浮 UI 面板，不破坏原网站布局。UI 逻辑应封装在专用模块中。
*   **数据流**: 遵循单向数据流（用户输入 → 状态更新 → UI 重新渲染）。
*   **状态管理**: 使用 `CONFIG` 存储常量，`state` 对象管理运行时状态，并通过 `GM_setValue` / `localStorage` 持久化。
*   **安全考虑**: 模拟人类行为模式以反检测，仅请求必要的 `GM_` 权限。

## 5. 工作流规则

1.  **需求分析**: 阅读 `TASK_IMPLEMENTATION.md`。
2.  **功能对齐**: 参考 `FUNCTION_CHECKLIST.md` 保持平台一致性。
3.  **编码**: 遵循本文档的代码规范和风格。
4.  **测试**: 运行 `npm test` 并进行手动集成测试。
5.  **文档**: 更新相关文档和 JSDoc 注释。

---
