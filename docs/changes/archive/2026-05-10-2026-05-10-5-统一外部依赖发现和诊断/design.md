## 设计原则

外部二进制是部署输入，不是 ccflow 源码常量。ccflow 只基于当前服务进程环境判断依赖是否可用：

```text
process.env.PATH
  |
  v
resolve executable
  |
  +-- oz --version
  +-- wo contract --json
  +-- co doctor --json
```

诊断信息要帮助用户修复环境，而不是隐藏失败原因。错误信息必须包含缺失命令、执行失败的子命令和当前 `PATH`。

## 统一依赖模型

建议把外部依赖收敛成统一结构：

```json
{
  "name": "co",
  "command_path": "/home/zzl/go/bin/co",
  "version": {
    "ok": true,
    "output": "0.1.0",
    "error": ""
  },
  "contract": {
    "ok": true,
    "name": "co-request-v1",
    "error": ""
  },
  "home": "/home/zzl/.local/state/ccflow/co",
  "providers": {
    "codex": { "available": true },
    "opencode": { "available": true }
  }
}
```

`oz` 和 `wo` 不需要强行拥有 provider 字段。`co` 不需要强行拥有 `wo` 的 capabilities 字段。统一的是发现、执行、错误结构，不是把所有工具能力抹平成同一个协议。

## PATH 发现

`oz`、`wo`、`co` 都必须使用同一套 PATH 查找逻辑。查找规则：

- 读取当前 Node 进程的 `PATH`。
- 按平台处理可执行后缀，Windows 兼容 `PATHEXT`。
- 返回第一个存在且可执行的候选路径。
- 如果找不到，诊断返回 `command_path: ""`，错误中保留 `PATH`。

业务执行可以继续调用命令名或 resolved path，但诊断必须展示实际 resolved path。为避免诊断和执行不一致，优先把 resolved path 传给 `execFile` / `spawn`。

## co doctor 兼容

`co doctor --json` 的 provider schema 已经出现两种形式：

```json
{
  "providers": {
    "codex": true,
    "opencode": true
  }
}
```

```json
{
  "providers": {
    "codex": { "available": true },
    "opencode": { "available": true }
  }
}
```

ccflow 的判断函数应把这两种形式标准化成内部结构：

```json
{
  "codex": { "available": true },
  "opencode": { "available": true }
}
```

这样可以修复 `co provider "opencode" is unavailable` 的误报，同时不要求 co 立即发布新协议。

## 发送门禁

聊天发送必须按顺序执行：

```text
resolve co from PATH
  -> co doctor --json
  -> contract == co-request-v1
  -> provider available
  -> write request file
  -> send message-accepted
```

如果 provider 不可用：

- 不创建 manual session draft。
- 不写入 `CCFLOW_CO_HOME/requests/pending/*.json`。
- 不发送 `message-accepted`。
- 通过 WebSocket 返回可展示错误，至少包含 provider、doctor 错误摘要和当前 `PATH` 诊断入口。

## 测试策略

执行阶段需要新增或更新真实测试代码：

- server 测试：临时 PATH 中只放 fake `oz`、`wo`、`co`，断言诊断使用 PATH 发现到的路径。
- server 测试：`co doctor --json` 返回 boolean provider 时，OpenCode 可用性判断为 true。
- server 测试：OpenCode provider false 时，发送路径在写 request 前失败。
- browser 测试：Playwright fake `co` 只通过 PATH 暴露，doctor 返回 boolean provider，用户选择 OpenCode 并发送消息后，页面展示 fake co 写出的 `opencode-response`。
- browser 测试：OpenCode provider false 时，浏览器发送失败且 pending request 目录没有对应消息。

这些测试覆盖的是部署真实风险：PATH、doctor schema、发送门禁和浏览器到文件协议的完整链路。

## 风险

- 如果 resolved path 缓存过久，用户修复 PATH 后可能需要重启 ccflow。可以先接受重启要求，并在诊断页明确显示当前进程 PATH。
- 如果 `co doctor` 输出继续变化，标准化函数要保留严格的 contract 检查，只对 provider 字段做有限兼容。
- 如果 `wo` 或 `oz` 的子命令输出非 JSON，诊断应失败清楚，不能吞掉 stderr。
