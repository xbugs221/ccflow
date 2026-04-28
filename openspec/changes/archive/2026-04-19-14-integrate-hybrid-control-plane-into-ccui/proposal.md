## Why

当前 CCUI 只把项目视为若干手动发起的会话集合，无法把“用户需求从 intake 推进到验收”的长流程作为一等对象管理。这导致自动调度链路只能以外部控制面的形式存在，用户需要在多个界面之间跳转，项目导航也会因为按更新时间重排而破坏稳定定位。

本次变更要把 hybrid-agent-control-plane 的核心业务逻辑整体迁入 CCUI，让“项目”同时承载两类对象：

- 手动发起的普通 session
- 由用户需求驱动、内部派生多个子会话的需求工作流

同时将项目排序固定为字母序，用未读绿点表达新活动，避免列表因为后台调度不断跳动。

## What Changes

- 在项目侧边栏中为每个项目展示两类内容：手动 session 与需求工作流
- 需求工作流详情页在正文区展示 intake、planning、execution、verification、acceptance 等控制面状态，并允许继续进入子会话
- 将 hybrid-agent-control-plane 的调度、状态持久化、artifact 回链、验收门禁语义迁入 CCUI，而不是仅迁移展示页
- 将项目排序改为稳定的字母序，并用未读绿点提示项目内有未查看的新活动

## Capabilities

### New Capabilities

- `project-workflow-control-plane`: 在项目内管理用户需求工作流、控制面状态和子会话入口

### Modified Capabilities

- 无

## Impact

- workspace: /path/to/project
- tasks: 4
- acceptance: 5
