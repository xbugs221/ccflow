## 背景

ccflow 当前已经把工作流执行交给 `wo`，把聊天会话生命周期交给 `co`，并继续依赖 `oz` 管理变更提案。外部二进制变成 ccflow 的核心运行依赖后，发现机制和诊断输出必须一致、可解释、可测试。

现在的实现存在几个落差：

- `oz`、`wo`、`co` 的发现和诊断逻辑分散在不同模块中，展示语义不统一。
- `co` 可执行程序不应依赖固定路径；只要服务进程的 `PATH` 能找到 `co`，ccflow 就应使用它。
- 本机 `co doctor --json` 可能返回 `providers: { "opencode": true }`，但 ccflow 只接受 `providers.opencode.available === true`，导致误报 `co provider "opencode" is unavailable`。
- 缺少覆盖“fake 二进制只通过 PATH 暴露”的真实端到端测试，无法证明部署时的 PATH 配置、provider 可用性判断和浏览器发送路径一起工作。

## 变更内容

- 统一外部依赖发现能力，覆盖 `oz`、`wo`、`co`。
- 所有运行依赖都从服务进程 `PATH` 查找，不在业务代码中写死用户机器路径。
- 诊断接口明确区分：
  - `command_path`：实际执行到的二进制路径。
  - `home` 或运行目录：工具自己的状态目录，例如 `CCFLOW_CO_HOME`。
  - `version`、`contract`、`providers`：工具报告的能力。
- `co` provider 可用性判断兼容两种 doctor 输出：
  - `providers.opencode === true`
  - `providers.opencode.available === true`
- OpenCode provider 不可用时，ccflow 必须在发送前给出明确错误，不写 request 文件，也不回退到 Node 侧 provider runner。
- 补充真实业务路径测试，证明浏览器选择 OpenCode、发送消息、`co doctor` provider 判断、request 写入和事件展示都经过外部 `co` 文件协议。

## 能力范围

```text
ccflow server
  |
  +-- dependency resolver
  |     +-- oz from PATH
  |     +-- wo from PATH
  |     +-- co from PATH
  |
  +-- diagnostics API
  |     +-- command_path
  |     +-- version / contract / provider status
  |     +-- actionable error with PATH
  |
  +-- chat send gate
        +-- co doctor ok
        +-- provider available
        +-- write co request only after gate passes
```

## 非目标

- 不实现或修改 `co`、`wo`、`oz` 的 Go 源码。
- 不恢复 ccflow 内置 Codex/OpenCode runner。
- 不重做 `co-request-v1` 文件协议。
- 不改变 `.wo/runs/` 运行态协议，也不在本提案创建运行态文件。
- 不把用户机器上的具体绝对路径写入仓库配置。
