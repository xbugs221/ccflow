# ccflow

ccflow 是基于 [ccui](https://github.com/siteboon/claudecodeui) 和 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 改造的本地 Web 工作台，主要用于把 Claude Code、OpenAI Codex CLI 和自定义 OpenSpec 工作流放在同一个项目界面里使用。

## 当前能力

- 项目级聊天：支持 Claude / Codex 会话、历史读取、附件、文件链接、工具调用展示和会话路由。
- OpenSpec 工作流：支持规划、执行、多轮审核/修复、归档等阶段，并可为阶段选择不同 provider。
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
docs/           长期设计文档
openspec/       OpenSpec 配置、当前 specs、设计文档和已归档 changes
public/         PWA、图标、截图和公开静态页面
```

`dist/`、`node_modules/`、`.ccflow/`、测试输出、数据库、缓存和本地环境文件都是生成物或运行时状态，不应提交到仓库。

内置斜杠命令放在 `server/commands/aliases/`，当前包含 OpenSpec 工作流和仓库维护常用提示词。用户仍可在 `~/.config/ccflow-alias/` 放自己的 Markdown 命令，两类命令会一起出现在命令菜单里。

## 快速开始

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

项目仍偏自用，未做完整产品化。OpenSpec 归档目录保留历史变更依据；根目录只保留当前开发、构建、发布和运行必须的文件。
