# 任务清单 - 添加岗位信息和城市关键字筛选功能

## 📋 需求概述

为 **Boss直聘** 和 **猎聘** 两个平台的海投助手脚本增加以下功能:

1. **岗位信息关键字设定**
   - Boss直聘: 匹配"职责描述"字段
   - 猎聘: 匹配"职位介绍"字段
   - 只有匹配成功才符合投递前提

2. **城市关键字设定**
   - 两个平台都需要支持

3. **脚本运行日志监控增强** ⭐ 新增
   - 在脚本界面中加强运行日志的可视化
   - 提供详细的执行过程反馈
   - 便于获取日志信息进行问题定位

---

## ✅ 任务列表

### 阶段一:需求分析与设计
- [ ] 分析 Boss 直聘当前筛选逻辑
  - [ ] 查看 `Boss_helper.js` 中现有关键字筛选实现
  - [ ] 确认职责描述字段的获取方式
  - [ ] 了解现有 UI 面板结构
- [ ] 分析猎聘当前筛选逻辑
  - [ ] 查看 `liepin_helper.js` 中现有关键字筛选实现  
  - [ ] 确认职位介绍字段的获取方式
  - [ ] 了解现有 UI 面板结构
- [ ] 设计新增功能的实现方案
  - [ ] 确定数据存储方式 (localStorage)
  - [ ] 设计 UI 输入控件
  - [ ] 设计筛选逻辑流程

---

### 阶段二:Boss 直聘脚本改造
- [ ] 状态管理修改
  - [ ] 在 `state` 对象中添加 `jobDescKeywords` 字段
  - [ ] 在 `state` 对象中添加 `cityKeywords` 字段
- [ ] 存储管理修改
  - [ ] 在 `StatePersistence.saveState()` 中保存新增字段
  - [ ] 在 `StatePersistence.loadState()` 中加载新增字段
- [ ] **日志监控增强** ⭐
  - [ ] 增强 `Core.log()` 方法,添加日志级别(INFO/WARNING/ERROR/DEBUG)
  - [ ] 为关键操作添加详细日志输出
  - [ ] 在 UI 日志区域添加颜色标识(成功/失败/跳过)
  - [ ] 添加日志导出功能(复制到剪贴板)
  - [ ] 添加日志过滤功能(按级别筛选)
- [ ] UI 面板修改
  - [ ] 添加"职责描述关键字"输入框
  - [ ] 添加"城市关键字"输入框
  - [ ] 添加输入框的事件监听
  - [ ] 优化日志显示区域(增加高度、滚动性能)
- [ ] 详情页数据抓取
  - [ ] 实现获取职责描述内容的函数
  - [ ] 确保城市信息获取准确
  - [ ] 添加数据抓取失败的日志提示
- [ ] 筛选逻辑实现
  - [ ] 在投递前检查职责描述是否包含关键字
  - [ ] 在投递前检查城市是否匹配
  - [ ] 添加详细的筛选日志输出(匹配/不匹配原因)


---

### 阶段三:猎聘脚本改造
- [ ] 状态管理修改
  - [ ] 在 `state.settings` 中添加 `jobDescKeywords` 字段
  - [ ] 在 `state.settings` 中添加 `cityKeywords` 字段  
- [ ] 存储管理修改
  - [ ] 在 `StorageManager.saveSettings()` 中保存新增字段
  - [ ] 在 `StorageManager.loadState()` 中加载新增字段
- [ ] **日志监控增强** ⭐
  - [ ] 增强 `Core.log()` 方法,添加日志级别(INFO/WARNING/ERROR/DEBUG)
  - [ ] 为关键操作添加详细日志输出
  - [ ] 在 UI 日志区域添加颜色标识(成功/失败/跳过)
  - [ ] 添加日志导出功能(复制到剪贴板)
  - [ ] 添加日志清空按钮
  - [ ] 添加实时统计信息显示(成功/失败/跳过计数)
- [ ] UI 面板修改
  - [ ] 在 `UI.createPanel()` 中添加"职位介绍关键字"输入框
  - [ ] 添加"城市关键字"输入框
  - [ ] 在 `UI.setupListeners()` 中添加事件监听
  - [ ] 优化日志显示区域(增加高度、滚动性能)
  - [ ] 添加日志操作按钮区(导出/清空/筛选)
- [ ] 详情页数据抓取
  - [ ] 在 `DetailManager` 中实现获取职位介绍内容的函数
  - [ ] 优化城市信息提取逻辑
  - [ ] 添加数据抓取失败的日志提示
  - [ ] 添加详情页加载状态的日志反馈
- [ ] 筛选逻辑实现
  - [ ] 在 `JobManager.shouldSkip()` 中添加职位介绍关键字检查
  - [ ] 在 `JobManager.shouldSkip()` 中添加城市关键字检查
  - [ ] 添加详细的筛选日志输出(匹配/不匹配原因)
  - [ ] 为详情页投递流程添加步骤日志


---

### 阶段四:测试与验证
- [ ] Boss 直聘功能测试
  - [ ] 测试职责描述关键字筛选
  - [ ] 测试城市关键字筛选
  - [ ] 测试关键字保存与加载
  - [ ] 测试边界情况(空关键字、多关键字等)
- [ ] 猎聘功能测试
  - [ ] 测试职位介绍关键字筛选
  - [ ] 测试城市关键字筛选  
  - [ ] 测试关键字保存与加载
  - [ ] 测试边界情况(空关键字、多关键字等)

---

### 阶段五:文档更新
- [ ] 更新 `FUNCTION_CHECKLIST.md`
  - [ ] 添加新增功能说明
  - [ ] 更新功能对比表格
- [ ] 添加代码注释
  - [ ] 确保所有新增代码都有中文注释
  - [ ] 说明设计思路和实现逻辑

---

## 📝 技术要点

### 日志监控增强实现 ⭐
```javascript
// 日志级别定义
const LOG_LEVEL = {
  DEBUG: { name: 'DEBUG', color: '#999', icon: '🔍' },
  INFO: { name: 'INFO', color: '#2196F3', icon: 'ℹ️' },
  SUCCESS: { name: 'SUCCESS', color: '#4CAF50', icon: '✅' },
  WARNING: { name: 'WARNING', color: '#FF9800', icon: '⚠️' },
  ERROR: { name: 'ERROR', color: '#F44336', icon: '❌' },
  SKIP: { name: 'SKIP', color: '#9E9E9E', icon: '⏭️' }
};

// 增强的日志方法
Core.log(msg, level = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const levelInfo = LOG_LEVEL[level] || LOG_LEVEL.INFO;
  const formattedMsg = `[${time}] ${levelInfo.icon} ${msg}`;
  
  console.log(`[脚本] ${msg}`);
  
  // UI 日志显示
  if (UI && UI.logContainer) {
    const div = document.createElement('div');
    div.style.color = levelInfo.color;
    div.textContent = formattedMsg;
    UI.logContainer.appendChild(div);
    UI.logContainer.scrollTop = UI.logContainer.scrollHeight;
  }
}

// 日志导出功能
function exportLogs() {
  const logs = UI.logContainer.innerText;
  navigator.clipboard.writeText(logs).then(() => {
    Core.log('日志已复制到剪贴板', 'SUCCESS');
  });
}
```

### 关键操作日志示例
```javascript
// 筛选日志
Core.log(`开始筛选职位: ${jobInfo.title}`, 'DEBUG');
Core.log(`职责描述关键字匹配: ${matched ? '通过✓' : '未通过✗'}`, matched ? 'SUCCESS' : 'SKIP');
Core.log(`城市关键字匹配: ${cityMatched ? '通过✓' : '未通过✗'}`, cityMatched ? 'SUCCESS' : 'SKIP');

// 错误日志
Core.log(`无法获取职责描述内容: ${error.message}`, 'ERROR');

// 投递流程日志
Core.log(`准备投递职位: ${jobTitle}`, 'INFO');
Core.log(`点击投递按钮...`, 'DEBUG');
Core.log(`投递成功!`, 'SUCCESS');
```

### 关键字匹配逻辑
```javascript
// 支持逗号或顿号分隔的多个关键字
const keywords = input.split(/[,，]+/).map(k => k.trim()).filter(k => k);
// 任一关键字匹配即通过
const match = keywords.some(keyword => content.includes(keyword));
```

### 城市关键字筛选
- 从职位卡片或详情页提取城市信息
- 支持多城市匹配(如:北京、上海、深圳)
- 为空时不进行城市筛选

### 职位描述关键字筛选  
- **Boss 直聘**: 需要进入详情页或聊天窗口提取"职责描述"
- **猎聘**: 需要在详情页提取"职位介绍/职位描述"
- 关键字为空时不进行描述筛选

---

## ⚠️ 注意事项

1. 所有代码注释使用**简体中文**
2. 变量命名使用**英文 camelCase**
3. 保持与现有代码风格一致
4. 确保向后兼容,不影响现有功能
5. **日志要求** ⭐
   - 为所有关键操作添加详细日志
   - 使用合适的日志级别(DEBUG/INFO/SUCCESS/WARNING/ERROR/SKIP)
   - 筛选不匹配时要记录具体原因
   - 错误发生时要记录完整的错误信息和上下文
   - 日志信息要清晰易懂,便于问题定位
6. UI日志区域要有良好的用户体验
   - 不同级别用不同颜色区分
   - 自动滚动到最新日志
   - 提供日志导出/清空功能

