## 1. 后端 read model

- [x] 1.1 新增 oz change 文档目录解析函数。
- [x] 1.2 支持 active 路径 `docs/changes/<change>/`。
- [x] 1.3 支持 archive 精确目录和 `-<change>` 后缀目录。
- [x] 1.4 多 archive 候选时选择最新 mtime 目录。
- [x] 1.5 将 `proposal.md`、`design.md`、`spec.md`、`task.md` 注入 planning artifacts。
- [x] 1.6 确保 artifact 缺失时保留 `exists: false`，避免前端打开坏路径。

## 2. 前端详情页

- [x] 2.1 扩展 `WorkflowDetailView` 的 planning 行产物选择逻辑。
- [x] 2.2 在 `workflow-role-row-planning` 中展示四个文档链接。
- [x] 2.3 保持规划会话按钮和缺失占位逻辑。
- [x] 2.4 不改变 `写`、`审`、`修`、`存` 行的单产物展示策略。

## 3. 测试代码

- [x] 3.1 在本提案 `tests/` 目录编写后端 read model 测试草稿，并在执行阶段同步到根测试套件。
- [x] 3.2 覆盖 active change 返回四个 planning 文档。
- [x] 3.3 覆盖 archived change 刷新后返回 archive 文档路径。
- [x] 3.4 覆盖 archive 多候选选择最新目录。
- [x] 3.5 更新 Playwright 工作流详情页验收测试，覆盖 `规` 行四个文档链接可见且可打开。
- [x] 3.6 覆盖归档移动后刷新详情页仍能打开文档。

## 4. 验证

- [x] 4.1 运行后端 read model 相关 Node 测试。
- [x] 4.2 运行工作流详情页 Playwright spec。
- [x] 4.3 运行 `pnpm run typecheck`。
- [x] 4.4 运行 `oz validate 2026-05-14-25-补充规阶段oz文档链接 --json`。
