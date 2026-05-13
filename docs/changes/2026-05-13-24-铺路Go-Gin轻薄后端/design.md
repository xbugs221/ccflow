## 设计原则

Go/Gin 迁移必须先证明兼容性，再替换运行时。

```text
阶段 0: 清理旧 provider 残留，固定 TS 契约
阶段 1: Go shadow backend 只实现只读低风险端点
阶段 2: contract tests 同时跑 Node 和 Go
阶段 3: 迁移 file/shell/git 等高风险能力
阶段 4: 切换生产入口并删除 Express
```

本提案只覆盖阶段 1 和 contract test 铺路。

## 目标架构

```text
React/Vite
  |
  | REST / WS
  v
ccflow thin backend
  - auth/session cookie or token
  - static dist
  - project/read model
  - file tree/read/write
  - shell websocket/pty
  - git helper
  - co request/state/events
  - wo state/artifacts
  |
  +-- co daemon -> Codex/OpenCode
  +-- wo runner -> workflow
```

Go/Gin 影子服务初期只实现：

```text
Go shadow backend
  |
  +-- GET /api/health
  +-- GET /api/runtime-dependencies 或等价只读诊断
  +-- GET /api/workflows/read-model 的只读子集
  +-- static dist fallback smoke
```

## 目录建议

```text
backend-go/
  cmd/ccflowd/main.go
  internal/httpserver/
  internal/contracts/
  internal/cowire/
  internal/wowire/
  internal/static/
```

先不把 Go 服务加入生产 `start` 脚本。新增独立命令，例如：

```bash
go run ./backend-go/cmd/ccflowd --listen 127.0.0.1:4301 --shadow
```

## Contract tests

测试应以请求/响应合约为中心，而不是实现细节：

```text
contract fixture
  |
  +-- start Node backend
  +-- run request matrix
  +-- start Go shadow backend
  +-- run same request matrix
  +-- compare stable response fields
```

第一批不要覆盖高风险 mutation。适合先覆盖：

- health/status
- runtime dependency diagnostics shape
- co doctor/status read model
- wo read model 的只读摘要
- SPA fallback 基础行为

## Gin 选择

Gin 可作为 HTTP router，但不要把业务逻辑绑死在 Gin context。内部模块应接受普通 request context 和显式参数，便于测试：

```text
Gin handler -> adapter -> service -> co/wo/file read model
```

## 风险

- Shell PTY、file mutation 和 WebSocket 是高风险能力，过早迁移会拖慢主线。
- co/wo 状态文件路径有用户态目录和项目路径解析逻辑，必须先用 contract tests 固化。
- 如果 Go shadow 过早接入生产端口，会出现 Node/Go 双后端行为不一致的问题。
