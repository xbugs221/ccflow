## 1. 项目重命名持久化（后端）

- [x] 1.1 在 `server/projects.js` 增加路径级展示名索引读写（`displayNameByPath`）与规范化路径 helper。
- [x] 1.2 扩展 `renameProject(projectName, newDisplayName, projectPath?)`，写入/删除时同时维护路径键与旧 `projectName` 键兼容。
- [x] 1.3 在项目聚合三条分支（Claude、manual、Codex-only）统一接入 `resolveDisplayName` 解析，确保路径键优先。
- [x] 1.4 增加后端测试覆盖：Codex-only 重命名后刷新仍生效、空名称回退自动名、路径键与旧键冲突时路径优先。

## 2. 重命名调用链路（前端）

- [x] 2.1 在侧边栏重命名提交时附带 `projectPath/fullPath`，并保持对旧接口参数的兼容。
- [x] 2.2 校验重命名后刷新流程（`refreshProjects`）能正确回显新名称，不依赖整页 reload。

## 3. Provider 额度剩余读取层

- [x] 3.1 新增统一的 usage-remaining 接口与响应模型（`fiveHourRemaining`、`sevenDayRemaining`、`source`、`updatedAt`）。
- [x] 3.2 实现 Claude 适配器：对齐 `~/.claude/settings.json` statusLine 语义，读取并转换 5h/7d 指标为 remaining 值。
- [x] 3.3 实现 Codex 适配器：对齐 `~/.codex/config.toml` status line（`five-hour-limit`/`weekly-limit`）并输出统一 remaining 字段。
- [x] 3.4 增加适配器异常与无数据场景测试，确保返回 `unavailable` 时不抛错。

## 4. 聊天输入区 UI 替换

- [x] 4.1 用新的 `5hours/7days remaining` 展示组件替换 `TokenUsagePie`，保留 mode 按钮旁布局稳定。
- [x] 4.2 组件按当前 provider 动态取数并在 provider 切换时刷新，避免复用错误来源。
- [x] 4.3 增加前端降级显示（如 `-- / -- remaining`）与必要 i18n 文案。

## 5. 联调与回归验证

- [x] 5.1 回归验证：Claude/manual/Codex-only 三类项目重命名均可跨刷新保持。
- [x] 5.2 回归验证：聊天区不再展示 token 百分比饼图，且 Claude/Codex 分别显示各自 5h/7d remaining。
- [x] 5.3 补充变更说明与测试记录，确认 `/opsx:apply` 阶段可按任务顺序实现。
