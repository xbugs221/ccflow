## 1. 后端状态接口

- [x] 1.1 审计 `/api/cli/opencode/status` 当前调用链和错误映射。
- [x] 1.2 将 OpenCode CLI 可执行性和 provider 认证列表读取拆成独立状态字段。
- [x] 1.3 保留 `opencode auth list --json` 兼容分支，失败时回退到 `opencode auth list` 文本解析。
- [x] 1.4 新增文本输出解析函数，支持 provider 名称包含空格和认证类型在行尾的格式。
- [x] 1.5 状态接口返回 `available`、`authenticated`、`providers[].name`、`providers[].authType`、`providers[].api` 等结构化字段。
- [x] 1.6 确保完整 API key、token 或 secret 不会从后端返回。

## 2. 前端设置页展示

- [x] 2.1 扩展设置页 `AuthStatus` 类型，接收 OpenCode provider 和 API 元数据。
- [x] 2.2 调整 OpenCode 连接状态文案，不再把 CLI 可用但认证列表异常显示成 `已断开`。
- [x] 2.3 在 `OpenCode` 详情面板展示已绑定 provider 列表。
- [x] 2.4 在 provider 行展示非敏感 API 信息，例如 `API`、来源、base URL 或脱敏摘要。
- [x] 2.5 更新中文和英文 i18n 文案。

## 3. 真实测试代码

- [x] 3.1 在本提案 `tests/` 目录编写真实 server 测试，执行阶段同步到仓库根测试套件。
- [x] 3.2 server 测试覆盖 `auth list --json` 失败但文本 `auth list` 成功时返回 provider 和 API 信息。
- [x] 3.3 server 测试覆盖 provider 名称包含空格时解析正确。
- [x] 3.4 server 测试覆盖 OpenCode CLI 不存在时返回明确错误且不返回 provider。
- [x] 3.5 在本提案 `tests/` 目录编写真实 Playwright 端到端测试，执行阶段同步到仓库根测试套件。
- [x] 3.6 Playwright 端到端测试必须使用服务进程 PATH 中的 fake `opencode`，不得 mock `/api/cli/opencode/status`。
- [x] 3.7 Playwright 端到端测试覆盖设置页展示 `DeepSeek`、`Kimi For Coding` 和 `API`，且不显示 `已断开`。
- [x] 3.8 Playwright 端到端测试覆盖 OpenCode 可用但无 provider 时显示尚未绑定 provider。
- [x] 3.9 Playwright 端到端测试覆盖 provider 列表读取失败但 CLI 可用时不误报断开。

## 4. 验证

- [x] 4.1 运行 `oz validate 2026-05-11-16-修正OpenCode设置页状态误报 --json`。
- [x] 4.2 运行 OpenCode 状态接口相关 server 测试。
- [x] 4.3 运行设置页 OpenCode 端到端测试。
- [x] 4.4 手动打开设置页，确认本机 OpenCode provider 和 API 信息展示正确。
