# 功能移植实施计划

## 目标
将 `Boss_helper.js` 和 `liepin_helper.js` 中的高级功能（职位描述筛选、城市筛选、自动聊天、简历选择）移植到统一的 `Universal_Job_Helper.js` 中，并遵循新的策略模式架构。

## 建议变更

### 1. `Universal_Job_Helper.js`

#### [修改] [结构]
- **StorageManager**: 增强以支持 `addRecordWithLimit`（来自 Boss）和统一的键前缀。
- **JobStrategy**: 添加抽象方法 `recoverState`, `exportLogs`。

#### [修改] [BossStrategy]
移植 `Boss_helper.js` 的逻辑：
- **职位处理**: 添加 `handleChatPage` 逻辑，包含“打招呼”和“发送简历”流程。
- **筛选**: 实现 `jobDescKeywords`（职位描述关键词）和 `cityKeywords`（城市关键词）的提取与匹配。
- **简历**: 移植 `sendResume` 和 `sendImageResume` 逻辑（包括 Canvas 生成或简化版）。
- **自动回复**: 移植 `handleNewMessage` 和 `keywordReplies`。

#### [修改] [LiepinStrategy]
移植 `liepin_helper.js` 的逻辑：
- **深度提取**: 增强 `extractJobInfo`，使用旧脚本中的多选择器鲁棒性。
- **详情页**: 优化 `handleDetailPage` 以更可靠地处理“投递”按钮状态和页面关闭。
- **日志**: 确保保留使用 `GM_setValue` 的跨标签页日志同步。

## 验证
- **静态分析**: 确保旧脚本的所有方法都已适配新脚本的 `this.settings` 和 `Core` 工具。
- **浏览器模拟**: 使用 `browser_subagent` 模拟页面结构并验证选择器逻辑。

## 验证计划
### 自动化测试
- 使用 `browser_subagent` 访问 `https://www.liepin.com/zhaopin/`。
- 注入 `Universal_Job_Helper.js` 代码。
- 检查 `#ujh-panel` 是否存在。
- 检查控制台是否有 `>>> [JobHelper]` 日志及任何错误。

### 手动验证
- 用户需要在浏览器（Tampermonkey/ScriptCat）中重新安装脚本并访问站点。
