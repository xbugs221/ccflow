## 新增需求

### 需求：ccflow 必须使用 Go OpenSpec CLI 作为 OpenSpec 规则来源

系统必须通过用户已安装且服务进程 `PATH` 可见的 `ox` 执行 OpenSpec change 创建、发现、状态查询、apply 指令、校验和归档，不得在 Node 后端重复实现 OpenSpec 目录扫描和 artifact 完成规则。

#### 场景：读取当前仓库的 OpenSpec 文档根
- **当** 当前仓库使用 `docs/` 作为 OpenSpec 文档根
- **则** `ox list --json` 从 `docs/changes` 读取 active change
- **则** `ox validate --type spec --json` 从 `docs/specs` 读取当前 specs
- **则** 系统不会再依赖旧 `openspec/` 目录

#### 场景：后端获取 apply 指令
- **当** Web 工作流进入 execution
- **则** 后端调用 `ox instructions apply --change <change> --json`
- **则** 后端把返回的 `contextFiles`、`tasks` 和 `instruction` 传给 runner 或展示层
- **则** 后端不得依赖硬编码的 proposal/design/tasks/specs 路径作为唯一来源

#### 场景：归档变更
- **当** Go runner 或 Web 后端需要归档已完成 change
- **则** 系统调用 `ox archive <change> --yes`
- **则** archive 目标目录由 `ox` 写入 `docs/changes/archive`

### 需求：OpenSpec CLI 必须在服务启动时检测

系统必须要求用户预先安装 OpenSpec CLI，并在服务启动时从 `PATH` 解析固定命令名 `ox`。系统不得新增环境变量或项目配置来覆盖 `ox` 路径，并能在诊断信息中看到实际解析到的 binary 与版本。

#### 场景：服务启动时找到 OpenSpec CLI
- **当** 服务启动
- **且** PATH 中存在可执行的 `ox`
- **则** 后端记录实际解析到的 `ox` 路径
- **则** 诊断接口返回该文件路径和 `--version` 输出
- **则** 设置页不提供 `ox` 路径覆盖入口

#### 场景：未安装 OpenSpec CLI
- **当** 服务启动
- **且** PATH 中不存在可执行的 `ox`
- **则** 服务启动失败并返回明确错误
- **则** 错误信息说明需要手动安装 `ox` 并确保服务进程 PATH 可见
- **则** 系统不得静默 fallback 到旧实现
