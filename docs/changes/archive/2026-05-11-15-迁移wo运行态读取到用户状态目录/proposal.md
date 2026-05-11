## 背景

`wo` 已经把 sealed run 和 batch 的运行态从业务仓库内迁出。新的 run state 不再写入：

```text
<project>/.wo/runs/<run-id>/state.json
```

而是写入用户状态目录：

```text
${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json
```

其中 `repo-key` 由仓库绝对路径生成，避免同名仓库共享运行态。

ccflow 当前仍把 `.wo/runs` 当作唯一 runner fact 来源：workflow read model 扫描项目内 `.wo/runs`，启动 `wo run` 后也等待项目内 `.wo/runs/<run-id>/state.json`。这会导致新版 `wo` 启动成功但 ccflow 读不到 workflow 列表和详情。

## 目标

- ccflow 只从 `wo` 的用户状态目录读取 run state。
- 启动、恢复、状态读取和 workflow 列表都使用同一个新路径解析逻辑。
- 测试和 fixture 使用临时 `XDG_STATE_HOME` 构造真实业务运行态，不再向项目内 `.wo/runs` 写数据。
- README 和相关契约描述同步为新路径。
- 不考虑 `.wo/runs` 兼容性。

## 变更内容

- 新增 `wo` 运行态路径 helper，按当前 `wo` 规则解析：

```text
projectPath
  -> absolute clean path
  -> repoKey = sanitized basename + "-" + sha1(absPath)[0:10]
  -> stateRoot = XDG_STATE_HOME/wo 或 ~/.local/state/wo
  -> runsRoot = stateRoot/repos/<repo-key>/runs
```

- `server/domains/workflows/wo-read-model.js` 从新 `runsRoot` 扫描 run 目录并读取 `state.json`。
- `server/domains/workflows/go-runner-client.js` 在启动后等待新路径下的 `state.json`，直接读取状态时也使用新路径。
- 更新 server、spec、Playwright fixture 中 fake `wo` 写入路径。
- 更新测试中“没有创建运行态”的断言，从检查 `.wo/runs` 改成检查用户状态目录的 run 数量变化或检查项目内 `.wo/runs` 不存在。
- 更新 README 中 runner fact 来源说明。

## 范围

```text
server/domains/workflows/
  +-- wo runtime path helper
  +-- wo-read-model.js
  `-- go-runner-client.js

tests/server/
  +-- wo workflow read model contract
  `-- go runner integration

tests/spec/
  +-- fixture fake wo
  +-- route and search workflow tests
  `-- no legacy .wo/runs assertions

tests/e2e/
  +-- Playwright fixture fake wo
  `-- workflow kickoff/action dialog assertions

README.md
  `-- wo runtime state path description
```

## 非目标

- 不读取、不迁移、不展示旧 `.wo/runs`。
- 不恢复旧 `.ccflow/runs`。
- 不改变 `/runs/<runId>` 前端路由；这是产品路由，不是文件系统路径。
- 不改变 workflow stage 展示、sessionRef、control plane read model 和 UI 布局。
- 不修改 `wo` 本体；ccflow 只适配当前公开路径规则。
- 不处理 batch UI，因为 ccflow 当前只展示 sealed run。

## 开放问题

无阻塞开放问题。

后续可建议 `wo contract --json` 暴露 `runs_root` 或 `state_root`，让 ccflow 不必长期复制 `repo-key` 算法。但本次执行阶段按当前 `wo` 已落地规则实现。
