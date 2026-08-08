# Design Spec 补丁草稿 — 2026-08-08 阶段薄切片

Date: `2026-08-08`  
Status: `draft`（阶段评审后写入；落地实现时与代码一并视为本切片合同）  
Parent: `docs/aegis/specs/2026-07-20-boss-job-assistant-design.md`（approved）  
Authority: 仍以 approved Design Spec 为准；本文件记录 **本切片交付边界** 与 **Spec 债务**，不静默废止父 Spec 条款。

## 1. 本切片使命

薄切片混合包：

- 合同对齐（关键词封顶、R11 显式日上限）
- 跟进单内核 + 按 Spec 恢复环 B 交错（默认 on）
- UI→background LLM 分层封口
- 硬否 UI 接通 + 跳过计数

## 2. 相对父 Spec 的澄清 / 加细

| 主题 | 父 Spec | 本切片合同 |
|------|---------|------------|
| R5 职位池三源 | 推荐+期望1+期望2 | **Spec 债务**：本切片不实现、产品不宣传；运行时保持 **当前列表锁定** |
| 环 B | 与开聊交错跟进 | **交付**：`followUpInJobRun` 默认 **true**；tick 内与开聊交错；用户可关 |
| 跟进实现 | 聊天跟进能力 | **交付**：唯一 **FollowUpKernel**；环 B 与 **消息助手** 双入口均只调内核（见 ADR-0001） |
| R11 日上限 | 用户自填；未填不可跑 | **交付**：「显式日上限」= 策略中已保存的数字；选风控档可预填，**必须保存** 后才可 start；不得仅靠档位隐式补齐绕过 |
| R6 硬否 | 父 Spec 曾写 v1 不做独立本地硬过滤 | 实现已有硬否域；**本切片交付侧栏**：城/最低薪K/最大年限差/排除词；空=不启用；证据不足不拒绝。父 Spec R6 与现状张力另案修订，不在本切片废止硬否 |
| 关键词综合分 | README/分析约定封顶 60 | **交付**：实现与文档均为封顶 **60**，测试锁死 |
| LLM 测试入口 | background 为策略/LLM owner | **交付**：sidepanel 不得 import `background/llm-client`；经 SW 消息 |

## 3. 硬否跳过计数（本切片新增 UI 合同）

- 指标：**本 Run** 硬否跳过数 + **今日** 硬否跳过数  
- 展示：**运行 Tab** 与 **策略 Tab** 均显示  

## 4. 本切片非目标（冻结）

- 多源自动轮询（债务）
- Handoff 工作台、事件分页、看板 30 日/按源/单职位详情
- 意图 LLM 回退、匹配反馈学习
- 整包拆 sidepanel、OpenChatPipeline/ContentPort 大重构
- 删除 `run-state-machine` / 收敛 `JobSource` 类型叙事（与多源债务一并另案）
- 多招聘站、桌面端

## 5. 完成定义（验收）

1. 关键词封顶 60 + 测试  
2. sidepanel 不 import `llm-client`  
3. `runFollowUpBatch` 无第二套 disposition，只调 FollowUpKernel  
4. 环 B 默认 on + 与开聊交错  
5. 消息助手可用且同 kernel  
6. 日上限未显式保存不可 start  
7. 硬否四项可编可存  
8. 运行 Tab + 策略 Tab 显示本 Run + 今日硬否跳过  
9. 多源不实现、不宣传  
10. `npm test` + `npm run build` 通过  
11. 本补丁草稿 + ADR-0001 已入库  

## 6. 术语

见仓库根目录 `CONTEXT.md`。
