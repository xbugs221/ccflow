## 目标

本次变更把 ccflow 的自动工作流展示改为跟随 `wo` 当前契约。后端只负责把 `wo` 的机器状态转换成适合前端消费的行级 read model，前端只把这些行组件化渲染，不再自行发明阶段名称、未来阶段或产物树。

## 关键决策

### 1. 删除旧兼容层

不保留旧 `mc` / `ox` / `.ccflow/runs` 支持。原因是旧契约和新契约同时存在会让 workflow 列表、路由和诊断文案长期分叉，反而增加误判风险。启动失败时应明确报告缺少 `wo` 或 `oz`，而不是回退到旧命令。

```text
旧路径: .ccflow/runs/<run-id>/state.json   删除
新路径: .wo/runs/<run-id>/state.json       唯一来源
```

### 2. 后端提供 wo 输出行 read model

后端 read model 应保留 `wo` 的可见文本，而不是把阶段重新命名为 ccflow 自己的标题。建议新增类似结构：

```text
workflowDisplay:
  lines:
    - id
      marker        # "✓" | "→" | " "
      text          # wo 输出文本，例如 "start"、"review"、"1 fix review"
      status        # completed | active | pending | blocked
      sessionRef    # 可选，解析出的会话引用
      rawLine       # 原始 wo 风格行，便于诊断
```

`text` 必须直接来自 `wo` 当前输出语义或同等算法结果，前端不得再做阶段名称映射。

### 3. 会话 jsonl 名称转为链接

`wo` 输出中的会话 jsonl 名称用于帮助用户定位 agent 会话。ccflow 前端应把它渲染为可点击链接：

```text
✓ start codex-exec-thread.jsonl
         └─────────────── clickable session link
```

解析规则应由后端完成或由共享工具完成，避免多个前端组件重复猜测。链接目标沿用现有 workflow child session 路由：

```text
/runs/<run-id>/sessions/<address>
```

如果 state 只能提供 session id 而没有 jsonl 名称，则仍显示可点击 session id；如果无法匹配会话，则显示普通文本并在 diagnostics 中给出 warning。

### 4. 前端移除树形流水线

当前 `WorkflowDetailView` 的树形 pipeline 同时展示阶段、子阶段、产物和连接线。新版不再需要：

- 不显示未来阶段。
- 不在主流程中展示各阶段 artifacts。
- 不画阶段连接线和节点树。
- 不再按 `planning/execution/review_1/repair_1` 等内部 key 做标题映射。

主视图只显示 `wo` 输出行组件；日志、诊断和 artifacts 如仍需要，应放在独立的辅助区域，不作为阶段树的一部分。

### 5. 测试优先覆盖真实业务流

测试必须模拟真实迁移后的工作流行为，而不是只检查组件是否存在。最小端到端路径：

```text
fake oz list/status
        │
        ▼
fake wo run 写入 .wo/runs/<id>/state.json
        │
        ▼
ccflow 后端读取 workflowDisplay.lines
        │
        ▼
浏览器打开项目 workflow 详情
        │
        ▼
看到 wo 风格输出行，点击会话链接进入对应会话
```

## 风险和取舍

- `wo` 当前 runner JSON 没有直接输出 terminal checklist lines。ccflow 可以用 `wo` 同等算法从 `state.json` 生成行级 read model，但字段命名必须表达“wo display lines”，避免前端误以为这是旧阶段树。
- 移除历史兼容会让旧 `.ccflow/runs` 不再显示。这是本次明确取舍，README 需要写清楚升级行为。
- 会话 jsonl 名称和 session id 的对应关系可能因 provider 不同而变化，因此测试要覆盖 Codex / OpenCode 至少一种真实路由，另一种保留单元测试或 fake provider 覆盖。
