## 总体设计

本变更把 `wo` 运行态路径从“项目内相对路径”改为“用户状态目录下的仓库隔离路径”。

```text
旧路径
  <project>/.wo/runs/<run-id>/state.json

新路径
  ${XDG_STATE_HOME:-~/.local/state}/wo/repos/<repo-key>/runs/<run-id>/state.json
```

ccflow 后端仍然从 `state.json` 构建 `ProjectWorkflow` read model，只替换 state file 的发现和等待位置。前端 `ProjectWorkflow` 数据结构和路由保持不变。

## 关键决策

### 统一路径 helper

执行阶段应新增一个后端 helper，集中实现：

- 解析用户状态根目录；
- 根据 `projectPath` 生成 `repo-key`；
- 返回指定项目的 `runsRoot`、`runDir`、`statePath`；
- 将绝对状态路径转为诊断可读路径。

`wo-read-model` 和 `go-runner-client` 必须共享该 helper，避免启动等待路径和列表扫描路径再次分叉。

```text
resolveWoRunsRoot(projectPath)
  -> resolveWoStateRoot()
  -> resolveWoRepoKey(projectPath)
  -> <stateRoot>/repos/<repoKey>/runs
```

### repo-key 复制当前 wo 规则

当前 `wo` 规则是：

```text
repoKey = sanitize(lowercase(basename(clean(abs(projectPath)))))
          + "-"
          + sha1(clean(abs(projectPath)))[0:10]
```

sanitize 只保留 `a-z`、`0-9`，其它连续字符折叠为单个 `-`，最后 trim `-`。空 basename 使用 `repo`。

ccflow 必须按这个规则推导目录，原因是 `wo contract --json` 当前只暴露能力列表和版本，没有暴露 state root 或 repo key。

### 用户状态目录规则

Linux 和当前开发环境遵循：

```text
XDG_STATE_HOME 存在:
  <XDG_STATE_HOME>/wo

XDG_STATE_HOME 不存在:
  <home>/.local/state/wo
```

执行阶段可同时实现 Windows `LOCALAPPDATA/wo` 后备，与 `wo` 本体保持一致；但当前验收重点放在 XDG 和 Unix 默认路径。

### 不做 .wo/runs 兼容

本次不是迁移历史数据，而是对新版 `wo` 的读取路径适配。旧 `.wo/runs` 如果存在，ccflow 必须忽略它，避免用户看到过期 run 或误以为仓库内运行态仍被支持。

```text
project/.wo/runs/old-run/state.json
  -> ignored

XDG_STATE_HOME/wo/repos/<repo-key>/runs/new-run/state.json
  -> rendered
```

### runner paths 字段保持原样解析

`state.paths` 中的 artifact/log 路径可能由新版 `wo` 写成绝对路径，也可能在测试夹具中写成相对路径。ccflow read model 现有 `normalizeRelativePath(projectPath, value)` 已能处理绝对路径到项目相对路径的转换，但对于用户状态目录下的 artifact，转成项目相对路径会出现 `../../...`。

执行阶段应确认 UI 是否只用于展示和 sessionRef label。如果需要打开日志文件，应保留绝对路径或新增安全的状态目录路径打开逻辑。最小实现先保持 read model 可展示 run 和 stage，避免扩大文件打开能力。

## 风险与处理

- **repo-key 算法漂移**：ccflow 复制了 `wo` 算法，后续 `wo` 改规则会再次失配。短期用 contract/version 测试固定，长期推动 `wo contract --json` 暴露路径。
- **测试污染真实 HOME**：所有测试必须设置临时 `HOME` 和 `XDG_STATE_HOME`，不得读写开发者真实 `~/.local/state/wo`。
- **旧 fixture 混用路径**：现有测试中大量 fake `wo` 写 `.wo/runs`。执行阶段必须集中更新 helper，避免只修一部分测试。
- **空 runsRoot**：新路径不存在时 workflow 列表应返回空数组，不应报错。
- **诊断路径可读性**：`runnerDiagnostics.statePath` 从项目相对路径变为用户状态目录路径后，前端不应把它当作项目文件路径打开。

## 测试策略

执行阶段应新增或更新真实测试代码，并先放入本提案 `tests/`，完成后同步到根 `tests/`。

- server read model 测试：设置临时 `XDG_STATE_HOME`，按 `repo-key` 规则写入 `wo/repos/<repo-key>/runs/run-a/state.json`，断言 workflow 列表展示 `run-a`。
- 无兼容测试：同时创建项目内 `.wo/runs/old-run/state.json`，断言 `old-run` 不出现在 workflow 列表。
- runner client 测试：fake `wo run --json` 返回 `run_id` 并把 state 写入新目录，断言 `startGoWorkflowRun` 能等待成功。
- fixture 测试：Playwright 和 spec fixture 的 fake `wo` 均写入临时 `XDG_STATE_HOME`，并断言项目目录不创建 `.wo/runs`。
- README 或契约测试：确认文档不再描述 `.wo/runs` 是 runner fact 来源。
