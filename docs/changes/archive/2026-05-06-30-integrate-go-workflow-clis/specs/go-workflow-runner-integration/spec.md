## 新增需求

### 需求：ccflow 必须使用 Go runner 推进自动工作流

系统必须将新建 OpenSpec 工作流的 execution、review、repair 和 archive 自动推进委托给用户已安装且服务进程 `PATH` 可见的 Go workflow runner `mc`，并以 `.ccflow/runs/<run-id>/state.json` 作为 runner 状态事实来源。

#### 场景：启动新工作流 run
- **当** 用户在 Web UI 中为某个 OpenSpec change 启动自动工作流
- **则** 后端调用 Go runner 的非交互启动命令
- **则** runner 返回 `runId`、`changeName`、`status` 和当前 `stage`
- **则** 后端把 `runId` 写入 workflow 控制面配置

#### 场景：服务重启后恢复状态
- **当** ccflow 服务重启
- **且** 某 workflow 记录了 Go runner `runId`
- **则** 后端读取 `.ccflow/runs/<run-id>/state.json`
- **则** 工作流详情页展示该 run 的真实阶段和状态
- **则** 后端不得依赖重启前的内存 action key 判断阶段是否已启动

#### 场景：恢复未完成 run
- **当** 用户或自动恢复逻辑要求继续一个未完成 run
- **则** 后端调用 Go runner 的 resume 命令并传入 `runId`
- **则** runner 负责锁检查、artifact 检查和 Codex thread resume
- **则** 后端只展示 runner 返回的结果和错误

### 需求：Go runner 必须提供 Web 适配 JSON contract

Go runner 必须提供稳定的非交互 JSON 命令，供 Node 后端启动、恢复、查询、中止和列出可执行 change。

#### 场景：启动时校验 runner contract
- **当** 服务启动
- **且** PATH 中存在可执行的 `mc`
- **则** 后端调用 `mc contract --json`
- **则** 输出包含 `json: true`、`version` 和 `capabilities`
- **则** `capabilities` 至少包含 `list-changes`、`run`、`resume`、`status`、`abort`
- **则** 缺少任一能力时服务启动失败并返回明确错误

#### 场景：runner 未安装
- **当** 服务启动
- **且** PATH 中不存在可执行的 `mc`
- **则** 服务启动失败并返回明确错误
- **则** 错误信息说明需要手动安装 `mc` 并确保服务进程 PATH 可见
- **则** 系统不得启动旧 TS auto-runner 作为隐式 fallback

#### 场景：runner 已安装
- **当** 服务启动
- **且** PATH 中存在可执行的 `mc`
- **则** 后端记录实际解析到的 `mc` 路径
- **则** 诊断接口返回该文件路径和版本或 contract 检查结果
- **则** 设置页不提供 runner 路径覆盖入口

#### 场景：查询 run 状态
- **当** 后端调用 `status --run-id <run-id> --json`
- **则** 输出包含 `runId`、`changeName`、`status`、`stage`、`stages`、`paths` 和 `sessions`
- **则** `paths` 中的文件路径为仓库相对 slash path

#### 场景：中止 run
- **当** 用户在 Web UI 中中止一个 running run
- **则** 后端调用 Go runner 的 abort 命令
- **则** runner 更新 `state.json.status`
- **则** 工作流详情页展示已中止状态和中止原因

### 需求：Go-backed workflow 首期自动阶段只支持 Codex

系统必须明确区分 Go runner 自动阶段支持范围。首期 Go-backed workflow 的自动推进只能使用 Codex，不得继续用旧 TS 状态机补齐其他 provider。

#### 场景：创建 Go-backed workflow
- **当** 用户创建新 workflow
- **则** 系统把 runner provider 设置为 `codex`
- **则** UI 不展示可用于自动阶段的 Claude/OpenCode provider 切换控件

#### 场景：Go-backed workflow 提交非 Codex provider
- **当** 创建 workflow 的请求包含非 Codex 自动阶段 provider
- **则** 系统拒绝该请求或忽略该 provider 配置
- **则** 系统不会启动旧 Node auto-runner 补齐非 Codex 自动阶段
