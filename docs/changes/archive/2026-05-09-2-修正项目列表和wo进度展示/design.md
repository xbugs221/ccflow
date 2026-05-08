## 设计原则

本次修复把 `wo` 输出视为 workflow 主进度的唯一语义来源。ccflow 可以做结构化解析、排序和链接绑定，但不能把 `wo` 的阶段文案改写成另一套前端语言。

```
.wo/runs/<run-id>/state.json
        |
        v
wo read model
  - workflow_display.lines 优先
  - stage fallback 仅模拟 wo 文本
  - diagnostics 只报告真实异常
        |
        v
WorkflowDetailView
  - 渲染后端行级模型
  - 不重新解释阶段语义
```

## wo 阶段顺序

阶段排序应按 `wo` 的循环语义构造，而不是固定枚举：

```
execution
review_1
repair_1
review_2
repair_2
review_3
repair_3
...
review_N
repair_N
archive
done/status metadata
```

展示文本必须保留 `wo` 语义：

```
execution -> start
review_1  -> review
repair_N  -> N fix
review_N  -> (N - 1) fix review, when N > 1
archive   -> archive
```

其中 `N fix review` 表示第 N 轮修复后的复审。它不是重复的 `N fix`，也不是前端可自由改名的阶段。

## workflow_display 优先级

如果 `state.workflow_display.lines` 存在，后端应直接使用其中的 `marker`、`text`、`stage_key`、`raw_line` 等字段，只补充会话链接引用。这样 ccflow 与 `wo` CLI 的人类可读输出保持一致。

只有在旧状态或异常状态缺少 `workflow_display.lines` 时，后端才基于 `stages` fallback 生成行。fallback 生成规则要集中在 read model 内部，并通过测试覆盖，避免前端组件再推断阶段名称。

## done 处理

`stage=done` 或 `status=done` 表示 run 已结束。它应影响顶部状态和 `runState`，但不是一个新的 workflow step。除非 `wo` 在 `workflow_display.lines` 中显式输出 `done` 行，否则 ccflow 不应自行添加 `done` 进主进度。

## 项目列表

项目发现应避免把工具测试残留暴露成普通项目：

```
Codex config projects
        |
        +-- /home/zzl/projects/ccflow        -> 显示 ccflow
        +-- /tmp/Test.../001                 -> 测试临时项目，过滤或降级隐藏
        +-- /tmp/real-user-worktree/foo      -> 若保留，显示可区分短路径
```

推荐实现顺序：

1. 后端过滤明显的 Go 测试临时目录，例如 `/tmp/Test*/...` 下没有真实会话、没有 workflow、没有用户显式手工添加痕迹的项目。
2. 前端或后端为剩余同名项目提供 disambiguation label，例如 `001 - /tmp/Test...3832776911`，避免多个同名行不可区分。

过滤规则要保守，不能隐藏仍有真实会话或 workflow 的项目。

## 风险

- 如果 `wo` 未来调整 `workflow_display.lines` 结构，ccflow 应优先透传未知字段并只在 diagnostics 中提示，不应阻断详情页展示。
- 临时项目过滤过激会隐藏用户真实 `/tmp` 工作区，因此过滤必须结合路径模式和“无业务数据”条件。
