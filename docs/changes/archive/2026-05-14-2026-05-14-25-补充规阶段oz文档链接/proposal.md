## 问题

工作流详情页的角色摘要第一行是 `规` 阶段，但当前只提供规划会话入口，没有直接展示本次 oz change 的四个核心文档：

- `proposal.md`
- `design.md`
- `spec.md`
- `task.md`

用户在查看工作流进度时，需要频繁回到这些文档确认问题、范围、验收场景和任务状态。现在必须手动去文件树查找，且 change 归档后路径会从 `docs/changes/<change>/` 移动到 `docs/changes/archive/.../`，固定路径链接容易失效。

## 目标

本次变更让工作流详情页的 `规` 阶段稳定展示 oz change 的四个 Markdown 文档链接，并保证 active 与 archived 两种状态下都能打开最新文档。

```text
工作流详情页
└─ 角色摘要
   ├─ 规: 会话 proposal.md design.md spec.md task.md
   ├─ 写: 会话 SUMMARY.md
   ├─ 审: 会话 review-N.json
   ├─ 修: 会话 repair-N.md
   └─ 存: 会话 delivery-summary.md
```

## 范围

- 后端 workflow read model 根据 `openspecChangeName` 或 runner `change_name` 解析 oz change 文档。
- 优先读取 active 路径 `docs/changes/<change>/`。
- active 路径不存在时，兼容 archive 下的精确目录和带日期前缀目录。
- 多个 archive 候选目录同时存在时，选择最新的有效目录。
- 前端在 `workflow-role-row-planning` 中渲染四个文档链接。
- 点击文档链接沿用现有文件打开能力，进入代码编辑器/文件预览。

## 非目标

- 不新增 oz/wo CLI 调用。
- 不改变 oz archive 行为。
- 不改变工作流阶段状态机。
- 不重新设计工作流详情页布局。
- 不处理额外自定义文档或非 Markdown 文件。

## 测试意图

执行阶段需要新增真实测试：

- 后端 read model 测试：active change 下返回四个 planning 文档 artifact。
- 后端 read model 测试：同一 change 归档后重新解析到 archive 路径。
- Playwright 验收测试：用户打开工作流详情页后，`规` 行可见四个文档链接并可点击打开。
- Playwright 验收测试：模拟归档移动后刷新详情页，四个链接仍指向最新归档文档。
