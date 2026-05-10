## 1. 统一依赖发现

- [x] 1.1 提取或改造统一的 PATH executable resolver，覆盖 `oz`、`wo`、`co`。
- [x] 1.2 支持 Windows `PATHEXT` 和 Unix 可执行权限检查。
- [x] 1.3 诊断结构统一使用 `command_path` 表示命令路径。
- [x] 1.4 保留工具运行目录字段，例如 `co.home`，避免和命令路径混淆。

## 2. 运行依赖诊断

- [x] 2.1 `oz` 诊断继续校验 `oz --version`。
- [x] 2.2 `wo` 诊断继续校验 `wo contract --json` 和必需 capabilities。
- [x] 2.3 `co` 诊断执行 resolved `co doctor --json`。
- [x] 2.4 `/api/diagnostics/runtime-dependencies` 返回 `oz`、`wo`、`co` 的 resolved path、版本、contract 和错误摘要。
- [x] 2.5 依赖缺失或 contract 不兼容时，错误信息包含命令名、失败子命令和当前 `PATH`。

## 3. co provider 兼容

- [x] 3.1 标准化 `co doctor` 的 providers 字段，兼容 boolean 和 `{ available }` 两种格式。
- [x] 3.2 修复 `isCoProviderAvailable(status, 'opencode')` 对 boolean true 的误判。
- [x] 3.3 OpenCode provider 不可用时，在写 request 前失败并返回可展示错误。
- [x] 3.4 确认失败路径不创建 manual session draft，不发送 `message-accepted`。

## 4. 真实测试代码

- [x] 4.1 在本提案 `tests/` 目录编写真实 server 测试，执行阶段同步到仓库根测试套件。
- [x] 4.2 server 测试：`oz`、`wo`、`co` 都只通过临时 PATH 暴露时诊断成功。
- [x] 4.3 server 测试：`co doctor` 返回 `providers.opencode: true` 时 OpenCode 可用。
- [x] 4.4 server 测试：`providers.opencode: false` 时发送路径不写 pending request。
- [x] 4.5 browser 测试：fake `co` 只通过 PATH 暴露，boolean provider schema 下 OpenCode 消息能展示 `opencode-response`。
- [x] 4.6 browser 测试：OpenCode provider unavailable 时页面展示失败，pending request 中没有该消息。

## 5. 验证

- [x] 5.1 运行 `oz validate 2026-05-10-5-统一外部依赖发现和诊断 --json`。
- [x] 5.2 运行相关 server 测试。
- [x] 5.3 运行相关 Playwright browser 测试。
- [x] 5.4 手动检查本机 `command -v co`、`co doctor --json` 和诊断接口展示一致。
