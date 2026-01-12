# 架构设计文档

本文档旨在阐述 `Universal_Job_Helper.js` 的核心架构设计，以便于快速理解代码结构和设计思想。

## 核心设计：策略模式 (Strategy Pattern)

为了在同一份代码中优雅地处理两个不同的招聘平台（BOSS直聘、猎聘），项目采用了经典的**策略模式**。

- **目标**: 将不同平台的特定逻辑（如DOM操作、投递流程）与通用的主流程分离开来，实现“一套主干，多套算法”。

### 主要构成角色

1.  **`JobStrategy` (策略基类)**:
    - 这是一个抽象基类（在JavaScript中通过类实现），定义了所有平台策略都必须遵守的“接口”。
    - 它提供了所有策略共享的通用功能，例如：
        - 状态管理 (`isRunning`, `settings`, `stats`)
        - `start()` / `stop()` 方法的通用逻辑
        - 设置的加载/保存 (`loadSettings`, `saveSettings`)
        - 按钮状态更新 (`updateButtonState`)
    - 子类必须实现 `renderSettings` 等抽象方法。

2.  **`BossStrategy` & `LiepinStrategy` (具体策略类)**:
    - 这两个类继承自 `JobStrategy`。
    - 它们各自封装了针对特定平台的**全部**业务逻辑，包括：
        - **DOM选择器**: 如何在页面上找到职位列表、按钮等元素。
        - **执行流程**: “投递”或“沟通”的具体步骤是什么。例如，BOSS是点击“沟通”，而猎聘是进入详情页再点击“立即沟通”或“申请职位”。
        - **UI渲染**: 如何渲染自己平台专属的设置选项。

3.  **`main` (上下文/Context)**:
    - 在脚本的 `main` 函数中，代码会检测当前页面的 `hostname`，以判断处于哪个平台。
    - 根据检测结果，它会**实例化**一个对应的策略对象（`new BossStrategy()` 或 `new LiepinStrategy()`)。
    - 之后，所有的业务操作都**委托**给这个实例化的策略对象来执行 (`strategy.start()`, `strategy.stop()`)。主流程不关心具体是哪个平台的策略在运行。

## 其他核心模块

- **`UIManager`**: 一个独立的UI管理器，负责创建、管理和销毁所有与DOM相关的界面元素（如悬浮面板、按钮、日志区域）。策略类通过调用 `UIManager` 的方法来渲染界面，实现了业务逻辑和UI展现的分离。

- **`Core`**: 提供了与业务完全无关的通用工具函数，如 `log` (日志)、`delay` (延时)、`waitForElement` (等待DOM元素)、`handleError` (错误处理) 等。

- **`StorageManager`**: 抽象了存储层，统一处理 `GM_setValue` 和 `localStorage` 的读写，并提供了数据序列化/反序列化、带上限的列表存储等功能。

## 数据流

1.  脚本启动，`main` 函数检测平台，创建对应的 **Strategy** 实例。
2.  **Strategy** 调用 **UIManager** 来渲染平台专属的设置和按钮。
3.  用户点击“开始”按钮，触发 **Strategy** 实例的 `start()` 方法。
4.  **Strategy** 开始执行其内部封装的自动化流程（查找职位、筛选、点击），并调用 **Core** 中的工具函数。
5.  在流程中，**Strategy** 通过 `Core.log` 输出日志，日志被 **UIManager** 捕获并显示在面板上。
6.  用户的配置更改通过 **UIManager** 捕获，调用 **Strategy** 的方法更新 `settings` 对象，并由 **StorageManager** 持久化。
