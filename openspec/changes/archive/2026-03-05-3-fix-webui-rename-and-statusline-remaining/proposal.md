## Why

WebUI 中“重命名项目”在部分项目类型（尤其 Codex-only 项目）刷新后不生效，导致用户无法稳定识别项目。与此同时，输入区 mode 按钮旁的百分比仅反映上下文 token 占用，对真实配额决策帮助有限，用户更需要与 CLI statusline 对齐的“5 小时/7 天剩余额度”信息。

## What Changes

- 修复项目重命名持久化链路，确保重命名后刷新仍生效。
- 将项目自定义名称的匹配键从“仅项目名”扩展为“规范化项目路径优先（兼容旧键）”，覆盖 Claude、手工项目和 Codex-only 项目。
- 替换聊天输入区 mode 按钮旁的百分比组件，改为展示 `5hours/7days remaining`。
- 为 Claude 与 Codex 分别实现剩余额度数据适配，按 provider 返回统一前端展示模型（而非共用单一 token 百分比）。
- 保留降级行为：当某 provider 无可用额度数据时显示占位态，不影响对话发送与会话流程。

## Capabilities

### New Capabilities
- `project-display-name-persistence`: 项目展示名在重命名后可跨刷新、跨项目来源稳定生效。
- `provider-usage-remaining-indicator`: 聊天输入区展示 provider 维度的 5h/7d 剩余额度信息。

### Modified Capabilities
- （无）

## Impact

- 后端项目聚合与配置读写：`server/projects.js`、`/api/projects/:projectName/rename` 对应逻辑。
- 前端侧边栏重命名结果回显与刷新后的名称映射逻辑。
- 聊天输入控制区组件：`src/components/chat/view/subcomponents/ChatInputControls.tsx`（替换 `TokenUsagePie`）。
- provider 额度数据来源适配：
  - Claude：沿用现有 statusline 命令/脚本数据来源（`~/.claude/settings.json` 中 `statusLine.command`）。
  - Codex：沿用 `~/.codex/config.toml` 的 status line 配置语义（`five-hour-limit` / `weekly-limit`）并对齐到统一展示字段。
