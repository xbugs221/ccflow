## 新增需求

### 需求：ccflow 必须从 wo 用户状态目录读取 workflow run

ccflow 后端必须把 `wo` 用户状态目录作为 sealed run 的唯一数据来源。

#### 场景：用户状态目录存在一个 run

- **给定** 项目路径对应的 `repo-key` 已经生成
- **且** `${XDG_STATE_HOME}/wo/repos/<repo-key>/runs/run-a/state.json` 存在
- **当** ccflow 刷新项目 workflow 列表
- **则** workflow 列表必须包含 `run-a`
- **且** workflow 标题、状态、stage、display lines 必须从该 `state.json` 构建

#### 场景：用户状态目录不存在

- **给定** 项目下没有任何新版 `wo` run state
- **当** ccflow 刷新项目 workflow 列表
- **则** workflow 列表必须为空或不包含 `wo` workflow
- **且** 后端不得因为 runs root 不存在而报错

### 需求：ccflow 不得读取项目内 .wo/runs

旧的项目内 `.wo/runs` 不再是受支持的 runner fact 来源。

#### 场景：只存在旧项目内 run state

- **给定** `<project>/.wo/runs/old-run/state.json` 存在
- **且** 用户状态目录下没有 `old-run`
- **当** ccflow 刷新项目 workflow 列表
- **则** workflow 列表不得包含 `old-run`
- **且** 后端不得尝试从 `<project>/.wo/runs` 读取 run

#### 场景：新旧目录同时存在

- **给定** `<project>/.wo/runs/old-run/state.json` 存在
- **且** `${XDG_STATE_HOME}/wo/repos/<repo-key>/runs/new-run/state.json` 存在
- **当** ccflow 刷新项目 workflow 列表
- **则** workflow 列表必须包含 `new-run`
- **且** workflow 列表不得包含 `old-run`

### 需求：启动 wo run 后必须等待用户状态目录 state.json

ccflow 调用 `wo run --change <name> --json` 后，必须在新版路径等待 runner 发布 state。

#### 场景：wo run 返回 run_id 后写入新 state

- **给定** fake `wo run --json` 返回 `{"run_id":"run-a"}`
- **且** fake `wo` 在 `${XDG_STATE_HOME}/wo/repos/<repo-key>/runs/run-a/state.json` 写入状态
- **当** 用户从 ccflow 启动该 active change
- **则** 后端必须等待新路径 state 文件出现后返回成功
- **且** 返回的 workflow 必须绑定 `run-a`
- **且** 项目目录不得创建 `.wo/runs/run-a`

#### 场景：wo run 未发布新 state

- **给定** `wo run --json` 返回了 `run_id`
- **但** 用户状态目录下对应 `state.json` 在等待窗口内没有出现
- **当** ccflow 等待 runner state
- **则** 后端必须返回明确的 runner state 发布失败错误
- **且** 不得回退等待 `.wo/runs`

### 需求：测试和 fixture 必须隔离 wo 用户状态目录

自动化测试不得读写真机用户的真实 `~/.local/state/wo`。

#### 场景：server 测试构造 wo run

- **给定** 测试创建了临时 `HOME` 和临时 `XDG_STATE_HOME`
- **当** 测试构造 fake `wo` run state
- **则** run state 必须写入临时 `XDG_STATE_HOME`
- **且** 测试结束后不得在项目 fixture 内残留 `.wo/runs`

#### 场景：Playwright fixture 启动 workflow

- **给定** Playwright fixture 使用 fake `wo`
- **当** 前端启动一个 active change
- **则** fake `wo` 必须写入临时用户状态目录
- **且** 前端仍然通过 `/runs/<runId>` 产品路由打开 workflow 详情

### 需求：文档必须描述新版 wo 运行态路径

用户文档不得继续把 `.wo/runs` 描述成当前 runner fact 来源。

#### 场景：阅读 README

- **给定** 用户查看 ccflow README
- **当** 文档说明 workflow runner 状态来源
- **则** 文档必须说明 run state 来自 `${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json`
- **且** 文档不得声称 `.wo/runs` 是当前唯一来源
