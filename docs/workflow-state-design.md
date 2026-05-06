# Workflow State Design

## 1. 目标

把 workflow 从“UI 临时推导的一组状态”整理成“store 自身就自洽的状态机”。

约束：

- 每个子阶段都要有明确输入、输出、推进条件
- 后续阶段不能越过缺失的前置证据
- 异常要能落在具体子阶段，而不是只剩一个含糊的 stage 状态
- 写入侧优先保证完整性，读侧只做兼容和修复，不承担主要业务语义

## 2. Canonical Workflow Schema

### 2.1 Workflow

- `id`
- `title`
- `objective`
- `stage`
- `runState`
- `updatedAt`
- `hasUnreadActivity`
- `stageStatuses[]`
- `artifacts[]`
- `childSessions[]`
- `executionSnapshot`
- `gateDecision`
- `finalReadiness`
- `failureReason`

### 2.2 Stage Status

- `key`
- `label`
- `status`: `pending | active | blocked | failed | completed`

### 2.3 Artifact

- `id`
- `label`
- `stage`
- `substageKey`
- `status`: `pending | ready | missing | failed`
- `type`: `file | directory | note`
- `path` 可选

规则：

- store 内 artifact 必须带 `stage + substageKey`
- `exists / relativePath` 只属于 read model，不写回 store

### 2.4 Child Session

- `id`
- `title`
- `summary`
- `provider`
- `stageKey`
- `substageKey`
- `url`

规则：

- child session 必须落到明确的 `stageKey + substageKey`
- 不允许“手动普通会话”自动混入 workflow child session

## 3. 子阶段 IO

### 3.1 `planning.planner_output`

- 阶段名：`规划提案`
- 输入：
  - 用户提交的 `title/objective`
  - 用户在规划会话里的自由讨论结论
- 输出：
  - 规划子会话
  - 或 OpenSpec proposal/design/tasks/specs
- 推进条件：
  - `title/objective` 非空
  - 用户已手动触发提案生成，且系统检测到规划子会话或 OpenSpec 变更
- 异常：
- `title/objective` 为空 -> `blocked`
- 已创建规划会话但尚未检测到 OpenSpec 变更 -> `active`

### 3.2 `execution.node_execution`

- 阶段名：`提案落地`
- 输入：
  - 已确认的 OpenSpec proposal
- 输出：
  - `execution` 子会话
  - OpenSpec task 完成状态
- 推进条件：
  - 存在 `execution.node_execution` 子会话
  - OpenSpec tasks 全部完成
- 异常：
  - 无执行会话 -> `blocked`
  - 执行会话已结束但 tasks 未完成 -> 保持 `active`

### 3.3 `verification.review_1`

- 阶段名：`三轮评审`
- 标题：`需求与范围覆盖`
- 输入：提案落地完成
- 输出：第 1 轮 reviewer 子会话
- 推进条件：存在 `review_1` 会话

### 3.4 `verification.review_2`

- 标题：`实现风险与回归`
- 输入：第 1 轮评审完成
- 输出：第 2 轮 reviewer 子会话
- 推进条件：存在 `review_2` 会话

### 3.5 `verification.review_3`

- 标题：`验收与交付闭环`
- 输入：第 2 轮评审完成
- 输出：第 3 轮 reviewer 子会话
- 推进条件：存在 `review_3` 会话

### 3.6 `ready_for_acceptance.delivery_package`

- 输入：三轮评审完成
- 输出：store 内 artifact `delivery-summary`；不要依赖根目录 ignored 文件 `delivery-summary.md`
- 可附带交付类 child session
- 异常：
  - 无交付总结 -> `blocked`

### 3.7 `ready_for_acceptance.handoff_confirmation`

- 输入：delivery package 完整
- 输出：`finalReadiness = true`
- 这是 workflow 真正完成的唯一完成信号
- 异常：
  - `finalReadiness` 缺失 -> `ready_for_acceptance` 仍是 `blocked` 或 `active`

## 4. 推进规则

1. 从前往后逐 stage 校验
2. 第一个缺失前置证据的 stage 记为当前 stage
3. 当前 stage 之前为 `completed`
4. 当前 stage 根据异常性质标成 `active / blocked / failed`
5. 当前 stage 之后一律 `pending`

结论：后续阶段的证据只能作为“旁证”，不能覆盖前置阶段缺失

## 5. 异常处理

### 5.1 数据缺字段

- artifact 缺 `stage/substageKey`：
  - 允许按 `id/path` 用 hint 修复
  - 修复后写回 store

- child session 缺 `stageKey/substageKey`：
  - 只允许在当前 active stage 下推断
  - 否则视为不可信，不参与推进

### 5.2 数据矛盾

- 后续阶段 completed，但前置输入缺失：
  - workflow 标记为 `blocked`
  - 停在最早缺失的 stage
  - 保留后续 artifact/session，但不让它们推进当前 stage

## 6. 写入责任

### 必须由 workflow 写入侧保证

- `createProjectWorkflow`
  - 初始化 `stageStatuses`

- artifact 写入
  - 必须写 `stage/substageKey/status`

- child session 写入
  - 必须写 `stageKey/substageKey`

- gate / readiness 写入
  - `gateDecision`
  - `finalReadiness`

### 读侧允许做的事

- 补 label/path/type 默认值
- 修复老记录并回写
- 生成 `exists / relativePath / stageInspections / recommendedActions`

## 7. 后续实现顺序

1. 固化 canonical artifact/session helper
2. 为 `planning.planner_output` 增加“用户手动触发提案生成”的显式入口
3. 增加 gateDecision / finalReadiness 更新入口
4. 为每个关键子阶段补单测
5. 用一个真实 workflow 从创建到交付完整走一遍

## 8. 真实案例验证清单

- 创建 workflow 后是否直接进入 `planning`
- 创建 workflow 后是否只打开空白规划会话，而不会自动发送 proposal/apply prompt
- 只创建规划会话但未生成 OpenSpec change 时，是否停在 `planning`
- 执行会话结束但 OpenSpec tasks 未完成时，是否停在 `execution`
- 三轮 reviewer 会话是否严格按 `review_1 -> review_2 -> review_3` 推进
- `gateDecision = pass` 但无 `finalReadiness` 时，是否停在 `ready_for_acceptance`
- 补齐 `finalReadiness = true` 后，是否整体进入 `completed`
