## Context

本变更把 `../hybrid-agent-control-plane` 中已经定义清楚的控制面语义迁入 CCUI，但不保留其独立产品边界。CCUI 继续是唯一前端入口，项目侧边栏保持现有心智模型，只是在每个项目下新增“需求工作流”这一类对象。

现有 CCUI 已具备：

- 稳定的项目/会话侧边栏骨架
- 基于服务端 API 与 WebSocket 的项目状态同步
- Playwright 驱动的 spec 验收测试

现有 hybrid-agent-control-plane 已具备：

- intake -> planning -> execution -> verification -> acceptance/finalize 的阶段语义
- execution、attempt、artifact、gate decision 等标准化对象
- 需求详情工作台与子会话 inspection 视图

## Goals / Non-Goals

**Goals:**

- 在不破坏现有手动 session 工作流的前提下，引入项目内第二类实体“需求工作流”
- 保留 hybrid 控制面的核心状态机、调度闭环和 artifact 回链
- 让项目导航顺序稳定，不再因为新消息或后台执行而重排
- 为实现阶段提供可执行的 Playwright 验收测试

**Non-Goals:**

- 本次不要求完整迁移 hybrid 仓库的独立 dashboard 外观
- 本次不要求在一个变更里实现所有控制面高级能力，例如多 runtime adapter 扩展或复杂恢复策略 UI
- 本次不修改现有 tests/e2e 的基础设施

## Decisions

1. 采用“双类型项目内容”而不是“双主页”
   - 左侧仍是项目清单
   - 项目展开后固定出现两个分组：`手动会话` 与 `需求工作流`
   - 手动会话继续复用现有 session 列表；需求工作流单独折叠展示

2. 采用“控制面工作流是一等资源，子会话是其 inspection surface”
   - 工作流拥有独立 ID、阶段、run state、artifact、gate decision、未读状态
   - 子会话只是工作流执行过程中的可打开节点，不与工作流主状态混为一个 session

3. 项目排序固定为字母序
   - 不再依据最近消息或最近更新时间重排项目
   - 若项目内有未查看新活动，仅显示绿点，不改变顺序

4. 调度逻辑进入 CCUI 服务端
   - 在 CCUI 服务端增加控制面 session store、orchestrator、inspection API
   - 前端详情页只消费标准化读模型，不直接耦合调度内部实现

## Architecture

### 前端

- 复用现有 Sidebar 容器
- 在项目项下新增需求工作流分组与未读指示
- 新增需求工作流详情主视图，展示：
  - 需求目标与当前阶段
  - stage/substage 状态
  - artifact 与验收结论
  - 子会话列表与跳转入口

### 服务端

- 迁入控制面领域模型：
  - workflow session
  - orchestration step
  - execution snapshot
  - attempt / artifact / gate decision
- 通过独立 API 暴露项目内工作流列表、工作流详情、inspection links、恢复/继续动作
- 将现有手动 session API 与控制面 workflow API 保持分离，再在前端按项目聚合

### 数据边界

- `Project` 继续表示 git/workspace 上下文
- `ManualSession` 表示用户直接发起的对话/编码会话
- `Workflow` 表示用户需求的控制面实例
- `WorkflowChildSession` 表示由 workflow 派生的可打开子会话

## Risks / Trade-offs

- 侧边栏信息密度变高，需要清楚区分两类对象，避免误把 workflow 当 session
- 如果直接复用现有 `ProjectSession` 类型，会把 execution/gate/artifact 状态塞进错误的数据模型，后续难以维护
- 排序逻辑从“活跃优先”改为“字母序稳定”后，需要补未读提示，否则新活动容易被忽略
- 控制面迁入后，CCUI 服务端职责增加，需要保持 API 和读模型边界稳定
