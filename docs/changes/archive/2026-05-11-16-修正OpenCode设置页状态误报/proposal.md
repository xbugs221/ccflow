## 背景

设置页 `智能体 > OpenCode` 现在会把 OpenCode 显示为 `已断开`，但同一台机器上 OpenCode 实际可用，并且 `opencode auth list` 能列出已经绑定的内部 provider。

当前误报来自状态探测口径不一致：

- 设置页调用 `/api/cli/opencode/status`。
- 后端执行 `opencode auth list --json`。
- 当前本机 OpenCode CLI 不支持该 `--json` 参数，命令退出失败。
- 前端把状态接口失败映射成 `authenticated=false`，最终显示 `已断开`。

实际业务期望不是让 OpenCode 像 Codex 一样展示“登录/断开”，而是让用户能在设置页确认：

- OpenCode CLI 是否可用。
- OpenCode 内部绑定了哪些 provider。
- 每个 provider 对应的非敏感 API 信息，例如认证类型、来源、base URL 或已脱敏 key 摘要。

```text
当前状态路径

设置页
  |
  v
/api/cli/opencode/status
  |
  v
opencode auth list --json
  |
  v
命令失败
  |
  v
显示已断开

目标状态路径

设置页
  |
  v
/api/cli/opencode/status
  |
  +-- opencode CLI 可用性
  +-- opencode auth list 输出解析
  +-- 可选 co doctor provider 可用性
  |
  v
显示 provider + API 元数据
```

## 变更内容

- 修正 OpenCode 状态接口，不再只依赖 `opencode auth list --json`。
- 兼容当前 OpenCode CLI 的 `opencode auth list` 文本输出，解析内部绑定的 provider 和认证类型。
- 状态接口返回结构化 provider 列表，包含非敏感 API 信息。
- 前端在设置页 OpenCode 面板展示 provider 名称和 API 信息。
- 前端区分 `OpenCode CLI 可用`、`已绑定 provider`、`未绑定 provider`、`状态探测失败`，避免把可用状态误报为 `已断开`。
- 补充端到端测试，覆盖真实浏览器打开设置页并看到 fake OpenCode CLI 输出的 provider 和 API 信息。

## 非目标

- 不重构 OpenCode 聊天执行链路。
- 不修改 `co-request-v1` 文件协议。
- 不改变消息发送前 `co doctor` provider gate。
- 不展示完整 API key、token 或 secret。
- 不引入新的路径配置项。
- 不创建 `.wo/runs/` 运行态文件。
- 不启动 sealed run。

## 开放问题

无阻塞开放问题。执行阶段需要以当前 OpenCode CLI 输出为主，同时保留对未来 JSON 输出的兼容分支。
