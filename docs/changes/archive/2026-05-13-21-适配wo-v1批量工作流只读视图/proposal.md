## 问题

`wo` 已升级到 v1.0，`wo status` 的用户可见输出变为五阶段摘要：

```text
规 / 写 / 审 / 修 / 存
```

批量工作流还会在外层展示 batch 进度：

```text
批量任务 b1 running 2/2
- 47-重设Skill运行规则契约
  - 规 工作流开始之前就已完成 ✓
  - 写 工作流开始之前就已完成 ✓
  - 审 <session> ✓✓✓✓✓
  - 修 <session> ✓✓✓✓
  - 存 <session> ✓
- 48-空token启用Gateway免登录
  - 规 工作流开始之前就已完成 ✓
  - 写 <session> →
```

当前 ccflow 前端仍偏向旧的 run 展示模型，存在几个问题：

- 工作流详情没有完整表达五阶段摘要，尤其 `修` 阶段和 fixer 会话容易被混到 executor。
- `review-N.json`、`fix-N.json` 等固定审核/修正产物位于 `~/.local/state/wo/repos/<repo>/runs/<run>/`，但现有 artifact 主要按项目内路径解析，用户无法直接点击查看这些 JSON 产物。
- 批量工作流的 batch 上下文没有展示，用户看不到多个 run 是同一次批量任务的一部分，也看不到 `2/2` 进度。
- 手动会话区域仍可能出现 wo 自动工作流发起的 provider 会话卡片，造成“手动会话”和“工作流子会话”混杂。

## 目标

本次变更把自动工作流区域改造成只读工作流总览：

- 以单个提案 run 为详情和跳转单位。
- 以 batch 作为只读分组和进度上下文。
- 在 run 详情中展示 v1.0.1 五阶段摘要、3-5 个可用会话链接、当前轮次产物链接。
- 从手动会话区域过滤所有工作流发起的会话卡片。

## 范围

- 后端读取 `batches/<batchId>/state.json`，建立 batch 与 run 的只读关联。
- 后端读取 `runs/<runId>/state.json` 和同目录固定 JSON 产物，输出稳定 read model。
- 前端自动工作流区域按 batch 分组展示；未归属 batch 的 run 放入“单独运行”区域。
- 前端 run 详情页显示 batch breadcrumb / `bN` / `batchIndex/batchTotal` 上下文。
- 前端 run 详情页显示 `规 / 写 / 审 / 修 / 存` 五阶段，只读展示状态、会话和产物。
- 后端和前端共同确保手动会话列表过滤工作流发起的会话。

## 非目标

- 不允许前端修改 batch 或 run state 文件。
- 不提供跳过、重排、批量 resume、批量 retry、批量 abort 等干预能力。
- 不启动新的 wo run，不恢复或修复已有 wo run。
- 不把 `~/.local/state/wo` 暴露为通用文件浏览器；只展示 read model 明确识别的产物。
- 不移除旧 run 的兼容展示，历史工作流仍应尽量可读。

## 测试意图

执行阶段需要新增真实业务测试，覆盖：

- 五阶段详情展示。
- batch 只读分组和 `2/2` 进度展示。
- `review-N.json` / `fix-N.json` 等 run 目录产物可点击打开。
- 手动会话区域不展示工作流发起的会话卡片。
