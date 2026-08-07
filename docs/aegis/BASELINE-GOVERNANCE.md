# Baseline Governance

## Purpose

定义本项目 Aegis 工作区的权威边界：什么算需求真相、什么算架构边界、如何避免口头约定漂移。

## Authority Order

1. 用户在对话中明确批准的 Design Spec / Spec Brief
2. 已接受的 ADR（若有）
3. 本文件与 `docs/aegis/specs/*`
4. 代码实现（不得反向默默改写已批准规格）

## Product vs Architecture

- **Product / Requirement Baseline**：要解决什么、成功证据、非目标
- **Architecture / Runtime Boundary Baseline**：模块 owner、依赖方向、运行时约束

两者冲突时先报告 `Baseline Role Alignment`，再改规格或实现，禁止静默双写。

## Change Rule

- 行为/合同变更：先改 Spec，再改代码
- 仅实现细节：可不改 Spec，但不得突破 Spec 的 non-goals 与 invariants