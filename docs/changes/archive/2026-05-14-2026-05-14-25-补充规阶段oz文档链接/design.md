## 设计原则

前端只负责展示 read model，路径解析必须放在后端。这样归档前后路径变化只影响一个后端解析函数，不让前端理解 oz 的目录规则。

```text
wo state.json
  |
  | change_name
  v
workflow read model
  |
  +-- resolve active docs/changes/<change>/
  |
  +-- fallback resolve docs/changes/archive/<candidate>/
  |
  v
planning artifacts
  - proposal.md
  - design.md
  - spec.md
  - task.md
```

## 后端路径解析

新增一个小型解析逻辑，输入为 `projectPath` 和 `changeName`，输出当前可用的四个文档 artifact。

解析顺序：

1. 检查 `docs/changes/<changeName>/`。
2. 检查 `docs/changes/archive/<changeName>/`。
3. 扫描 `docs/changes/archive/*`，匹配目录名等于 `<changeName>` 或以 `-<changeName>` 结尾的候选。
4. 候选多于一个时选择最新 mtime 的目录。

只把真实存在的文档标记为可打开；如果目录存在但个别文档缺失，应保留 artifact 并标记 `exists: false`，便于详情页表达缺失状态。

## Read Model 集成

将四个文档作为 `planning` 阶段 artifacts 加入工作流 read model：

```text
artifact
├─ stage: planning
├─ type: oz-change-doc
├─ semanticType: oz-change-doc
├─ label: proposal.md | design.md | spec.md | task.md
├─ relativePath: docs/changes/.../proposal.md
└─ exists: true | false
```

这些 artifacts 可以同时出现在：

- `workflow.artifacts`
- `stageInspections` 中 planning substage 的 `files`
- `workflowRoleSummary.rows` 的 planning 行渲染来源

## 前端展示

`WorkflowDetailView` 已有角色行产物按钮逻辑。执行阶段应扩展 `planning` 行，使它展示四个文档按钮，而不是只取一个 artifact。

```text
规  会话  proposal.md  design.md  spec.md  task.md
```

若规划会话不存在，仍展示文档链接；若文档不存在，按钮不应可点击，并沿用现有缺失提示或 muted 文本。

## 风险

- archive 目录历史上可能存在带重复日期前缀的异常名称，因此解析不能只拼固定路径。
- 同名候选目录可能来自历史清理或手动移动，需要通过 mtime 选择最新目录。
- 前端角色行现在对多数阶段只显示一个 artifact，planning 行需要支持多 artifact，但不能影响 `写`、`审`、`修`、`存` 行的紧凑展示。

## 测试策略

后端测试证明路径解析逻辑可靠：

- active change：创建 `docs/changes/<change>/proposal.md` 等四个文件，构造 wo state，断言 planning artifacts 指向 active 路径。
- archived change：移动到 `docs/changes/archive/<date>-<change>/` 后重新构造 read model，断言路径更新到 archive。
- archive 多候选：准备两个匹配目录，断言选择 mtime 最新的目录。

前端验收测试证明用户路径可用：

- 打开 fixture 项目的工作流详情页。
- 断言 `workflow-role-row-planning` 中存在四个文档链接。
- 点击 `proposal.md` 后编辑器标题和内容来自对应文件。
- 将 active change 移到 archive 后刷新详情页，再次点击同名链接能打开归档后的文件。
