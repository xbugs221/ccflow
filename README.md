---
url: https://github.com/xbugs221/ccflow
origin: https://github.com/siteboon/claudecodeui
---

# ccflow

ccflow 是基于 [ccui](https://github.com/siteboon/claudecodeui) 和 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 改造的本地 Web 工作台，主要用于把 Claude Code、OpenAI Codex CLI 和自定义 OpenSpec 工作流放在同一个项目界面里使用。

## 当前能力

- 项目级聊天：支持 Claude / Codex 会话、历史读取、附件、文件链接、工具调用展示和会话路由。
- OpenSpec 工作流：支持规划、执行、多轮审核/修复、归档等阶段，自动阶段由 Go runner 通过 Codex 推进。
- Go 工作流运行器：Web 后端依赖用户已安装的 `ox` 与 `mc`，自动 workflow 由 Go runner 推进。
- 工作区工具：文件树、代码编辑器、Git 面板、Shell 面板、设置页和 PWA 静态资源。
- 模型与用量：维护 Claude/Codex 模型列表，并显示 provider 的剩余额度信息。
- 自用模型接入：保留通过 Claude Code 接入 kimi-k2.6 的配置路径。

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

`dist/`、`node_modules/`、`.ccflow/`、测试输出、数据库、缓存和本地环境文件都是生成物或运行时状态，不应提交到仓库。

内置斜杠命令放在 `server/commands/aliases/`，当前包含 OpenSpec 工作流和仓库维护常用提示词。用户仍可在 `~/.config/ccflow-alias/` 放自己的 Markdown 命令，两类命令会一起出现在命令菜单里。

## 快速开始

先手动安装 Go OpenSpec CLI `ox` 和 Go workflow runner `mc`，并确保启动 ccflow 的服务进程能直接从 `PATH` 执行它们。ccflow 不提供环境变量或设置项覆盖这两个路径；缺少任一命令、`ox --version` 失败或 `mc` contract 不兼容时，后端会启动失败。

`mc` 必须支持 Web 后端使用的非交互 JSON 命令：

```sh
mc contract --json
mc list-changes --json
mc run --change <name> --json
mc resume --run-id <run-id> --json
mc status --run-id <run-id> --json
mc abort --run-id <run-id> --json
```

`mc contract --json` 必须返回 JSON 对象，至少包含 `json: true`、`version` 和 `capabilities`；`capabilities` 必须包含 `list-changes`、`run`、`resume`、`status`、`abort`。

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

项目仍偏自用，未做完整产品化。OpenSpec 文档根是 `docs/`，active changes 位于 `docs/changes`，归档目录保留历史变更依据。Go runner 的运行状态保存在 `.ccflow/runs/<run-id>/state.json`，日志和 review/repair/archive artifacts 使用同一 run 目录下的稳定相对路径。升级后旧 Node workflow 自动推进状态不再兼容，需要基于 active OpenSpec change 重新启动 Go runner
