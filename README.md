---
url: https://github.com/xbugs221/cbw
origin: https://github.com/siteboon/claudecodeui
---

# cbw

cbw 是基于 [ccui](https://github.com/siteboon/claudecodeui) 和 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 改造的本地 Web 工作台，主要用于把 OpenAI Codex CLI 和自定义 OpenSpec 工作流放在同一个项目界面里使用。

## 当前能力

- 项目级聊天：支持 Codex / Pi 会话、历史读取、附件、文件链接、工具调用展示和会话路由。
- OpenSpec 工作流：支持规划、执行、多轮审核/修复、归档等阶段，自动阶段由 Go runner 通过 Codex 推进。
- Go 工作流运行器：Web 后端依赖用户已安装的 `oz` 与 `wo`，自动 workflow 由 wo runner 推进。
- 工作区工具：文件树、代码编辑器、Git 面板、Shell 面板、设置页和 PWA 静态资源。
- 模型与用量：维护 Codex/Pi 模型列表，并显示 provider 的剩余额度信息。

## 组件结构

```text
src/            React/Vite 前端，按 components 下的功能域组织
server/         Express/WebSocket 后端、CLI 入口、API routes 和工作流服务
shared/         前后端共享的消息归一化、socket 消息和模型常量
scripts/        开发 watcher、node-pty 修复和项目历史校验脚本
tests/          server 单测、spec 回归测试、Playwright e2e/manual 测试
docs/           OpenSpec 配置、当前 specs、设计文档和已归档 changes
public/         PWA、图标、截图和公开静态页面
```

`dist/`、`node_modules/`、`.wo/`、测试输出、数据库、缓存和本地环境文件都是生成物或运行时状态，不应提交到仓库。cbw 运行时项目状态和 UI 配置现在写入 `${XDG_STATE_HOME:-~/.local/state}/cbw/`，之前版本的 `.cbw/` 目录不再产生新写入但也不会被自动删除。

内置斜杠命令放在 `server/commands/aliases/`，当前包含 OpenSpec 工作流和仓库维护常用提示词。用户仍可在 `~/.config/cbw-alias/` 放自己的 Markdown 命令，两类命令会一起出现在命令菜单里。

## 快速开始

先手动安装 Go oz CLI `oz` 和 workflow runner `wo`，并确保启动 cbw 的服务进程能直接从 `PATH` 执行它们。cbw 不提供环境变量或设置项覆盖这两个路径；缺少任一命令、`oz --version` 失败或 `wo` contract 不兼容时，后端会启动失败。

`wo` 必须支持 Web 后端使用的非交互 JSON 命令：

```sh
wo contract --json
wo list-changes --json
wo run --change <name> --json
wo resume --run-id <run-id> --json
wo status --run-id <run-id> --json
wo abort --run-id <run-id> --json
```

`wo contract --json` 必须返回 JSON 对象，至少包含 `json: true`、`version` 和 `capabilities`；`capabilities` 必须包含 `list-changes`、`run`、`resume`、`status`、`abort`。active change 列表由 `oz list --json` 提供。

```sh
pnpm install
pnpm start
```

开发时可使用：

```sh
pnpm dev
```

需要同时观察类型检查、后端重启和前端构建时，使用：

```sh
pnpm dev:watch
```

## 常用校验

```sh
pnpm typecheck
pnpm test:server
pnpm test:spec
pnpm test:e2e
```

## 备注

项目仍偏自用，未做完整产品化。oz 文档根是 `docs/`，active changes 位于 `docs/changes`，归档目录保留历史变更依据。wo runner 的运行状态保存在 `${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json`，这是 workflow 列表和详情的唯一 runner fact 来源；项目内旧运行态目录不再读取。workflow 主路由使用 `/runs/<runId>`，runner child session 使用后端 read model 提供的 `/runs/<runId>/sessions/...` 地址，手动会话仍使用 `cN`。主流程展示只渲染 wo 风格输出行，例如 `✓ start`、`→ review` 和 `1 fix review`，日志和诊断放在辅助区域。
