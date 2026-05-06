## 背景

ccflow 现在有两类状态：

- Web 控制面状态：项目 `conf.json` 中的 workflow、chat、child session、stage status。
- OpenSpec/runner 状态：change artifacts、tasks、review JSON、repair summary、delivery summary、provider session id。

现有 TS/JS 实现同时维护这两类状态，导致多个事实来源并存。Go 版 `mc` 已经把 runner 状态集中到 `.ccflow/runs/<run-id>/state.json`，Go 版 `opsx` 已经把 OpenSpec 状态集中到 state root。集成后的目标是：

```text
opsx            -> OpenSpec artifacts 的唯一规则来源
mc              -> 自动工作流推进的唯一状态机
Node backend    -> Web API、进程管理、read model 适配
React frontend  -> 展示和人工入口
```

## 决策

### 1. 外部二进制是显式前置依赖

不把 `../mc` 和 Go OpenSpec CLI 源码并入仓库，也不在发布包中携带二进制。用户必须先手动下载安装两个 CLI，并确保 `opsx` 与 `mc` 都能从服务进程的 `PATH` 中直接执行。

ccflow 不新增环境变量来覆盖 CLI 路径，也不维护项目内配置项来指定二进制位置。固定命令名能降低部署分支和诊断复杂度：

```text
service startup
|-- require command: opsx
|-- require command: mc
`-- fail fast if either command is missing or not executable
```

如果启动时检测不到任一可执行文件，ccflow 必须直接启动失败，并在错误中说明缺失命令名、需要把二进制安装到 `PATH`、以及当前服务看到的 `PATH` 摘要。诊断接口和设置页只展示实际解析到的路径与版本，不提供路径覆盖入口。ccflow 不自动下载、不自动编译、不静默 fallback 到旧 TS/JS 状态机。

### 2. OpenSpec 文档根统一为 `docs`

`opsx` 已经将 OpenSpec 文档根从 `openspec` 改名为 `docs`。ccflow 不再通过 `.openspec-root.json` 兼容旧目录，而是把当前仓库的 OpenSpec artifacts 迁移到 `docs/`：

```text
docs/
|-- changes/
|-- specs/
|-- config.yaml
`-- docs/
```

Go runner 可以继续按 `docs/changes` 读取 active change，但后端仍应通过 `opsx list/status/instructions/archive` 取得 OpenSpec 规则结果，避免重复实现 OpenSpec 校验和归档语义。

### 3. Node 后端只做进程适配与 read model

`server/workflow-auto-runner.js` 不再自己决定下一阶段、review 是否 repair、tasks 是否完成。新职责是：

- 创建或采用一个 OpenSpec change。
- 调用 Go runner 启动或恢复 run。
- 读取 `.ccflow/runs/<run-id>/state.json` 和稳定 artifact 路径。
- 把 Go 状态映射为现有前端需要的 workflow read model。
- 监听进程退出和日志变化并通过 WebSocket 通知前端。

### 4. Go runner 需要补齐 Web contract

`../mc` 当前适合终端交互，但 Web 后端需要稳定非交互接口。ccflow 集成时要求用户安装的 runner 版本支持：

```text
mc contract --json
mc list-changes --json
mc run --change <name> --json
mc resume --run-id <run-id> --json
mc status --run-id <run-id> --json
mc abort --run-id <run-id> --json
```

`mc contract --json` 用于服务启动检查，输出至少包含 `json: true`、`version` 和 `capabilities` 数组；`capabilities` 必须包含 `list-changes`、`run`、`resume`、`status`、`abort`。run/status 类 JSON 输出至少包含 `runId`、`changeName`、`status`、`stage`、`stages`、`paths`、`sessions`、`error`。已有 `--run`、`--resume` 终端入口可继续作为人工终端入口。

### 5. 第一阶段只支持 Codex 自动 runner

`../mc` 的核心实现是 Codex runner。为了避免把不稳定 TS 状态机继续保留为半套并行实现，新建 Go-backed workflow 的自动阶段先锁定 Codex。现有 Claude/OpenCode 手动聊天能力不受影响。

Web UI 对 Go-backed workflow 必须清楚展示 runner provider 为 Codex；旧的阶段 provider 选择对 Go-backed workflow 禁用或隐藏。后续需要多 provider 时，应在 Go runner 中增加 provider interface，而不是回到 Node 状态机。

### 6. 不保留旧 Node runner 兼容

本变更不考虑旧 TS/JS workflow 自动推进状态的兼容迁移。原因是旧状态中 child session、stage status、artifact 绑定可能不完整，保留旧状态解析会继续保留复杂度。

升级后的规则：

- 删除或停用旧 Node auto-runner。
- Web 创建的新 workflow 必须直接创建 Go run。
- 旧 workflow 不再自动推进；用户需要选择 active OpenSpec change 重新启动 Go runner。
- read model 不再为旧 Node runner 伪造阶段状态。

### 7. 删除重复逻辑要分阶段完成

第一阶段接入 Go runner 后，删除或隔离：

- 手写 `openspec list` fallback 和 `tasks.md` checkbox 解析。
- Node 内部 review/repair/archive 阶段推进。
- `completedKeys`/`inFlightKeys` 这类只服务旧 auto-runner 的内存去重。

## 风险 / 取舍

- `opsx` 与旧 `openspec` 输出字段不完全一致：通过适配层和 contract tests 固定 ccflow 使用字段。
- 当前仓库历史 artifacts 仍在 `openspec/`：本变更必须迁移到 `docs/`，否则 `opsx` 无法看到既有 specs 与归档历史。
- Codex-only runner 会收窄自动 workflow provider 能力：明确在 UI 中锁定，不保留半稳定的 Node 多 provider 自动推进。
- 子进程长时间运行：Node 只保存 pid/runId 并从 state.json 恢复，不以内存作为事实来源。
- 旧工作流不兼容会影响已有未完成流程：接受该取舍，避免继续维护不稳定状态机。
