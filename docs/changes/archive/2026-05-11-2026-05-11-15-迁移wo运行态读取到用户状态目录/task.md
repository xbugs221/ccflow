## 1. 路径 helper

- [x] 1.1 新增后端 `wo` 运行态路径 helper，包含 state root、repo key、runs root、run state path 解析。
- [x] 1.2 按当前 `wo` 规则实现 repo key：清理绝对路径、basename sanitize、sha1 前 10 位。
- [x] 1.3 支持 `XDG_STATE_HOME`，未设置时使用 `~/.local/state/wo`，必要时补 Windows `LOCALAPPDATA/wo` 后备。
- [x] 1.4 给 helper 增加单元测试，覆盖同名不同路径仓库隔离、特殊字符 basename、临时 `XDG_STATE_HOME`。

## 2. 后端读取路径迁移

- [x] 2.1 修改 `wo-read-model`，只从 helper 返回的新 `runsRoot` 扫描 run state。
- [x] 2.2 修改 `go-runner-client`，启动和恢复后等待新路径 `state.json`。
- [x] 2.3 修改 `readGoWorkflowState`，只读取用户状态目录。
- [x] 2.4 确认新 `runsRoot` 不存在时返回空 workflow 列表，不抛错。
- [x] 2.5 确认项目内 `.wo/runs` 即使存在也不会被读取或展示。

## 3. 测试夹具迁移

- [x] 3.1 更新 server fake `wo`，让 run state 写入临时 `XDG_STATE_HOME`。
- [x] 3.2 更新 spec fixture fake `wo`，避免写入项目内 `.wo/runs`。
- [x] 3.3 更新 Playwright fixture fake `wo`，为每次测试设置临时用户状态目录。
- [x] 3.4 更新所有读取 run 数量的测试断言，改为检查用户状态目录或检查项目内 `.wo/runs` 不存在。
- [x] 3.5 清理测试中残留的 `.ccflow/runs` 和 `.wo/runs` 路径假设。

## 4. 文档和诊断

- [x] 4.1 更新 README，将 runner fact 来源改为用户状态目录。
- [x] 4.2 更新相关测试文案和诊断文案，避免继续提示 `.wo/runs`。
- [x] 4.3 检查 `runnerDiagnostics.statePath` 在用户状态目录下的展示是否合理，不把它误当项目内文件路径。

## 5. 真实测试代码

- [x] 5.1 在本提案 `tests/` 目录编写真实 server 测试，执行阶段同步到根测试套件。
- [x] 5.2 覆盖用户状态目录存在 run 时 workflow 列表可发现并渲染。
- [x] 5.3 覆盖只存在项目内 `.wo/runs` 时 workflow 列表不展示旧 run。
- [x] 5.4 覆盖新旧目录同时存在时只展示用户状态目录 run。
- [x] 5.5 覆盖 fake `wo run --json` 写入新路径后，ccflow 启动 workflow 成功。
- [x] 5.6 覆盖 fake `wo run --json` 不写新 state 时，ccflow 不回退 `.wo/runs` 并返回明确错误。
- [x] 5.7 更新 Playwright 启动 workflow 测试，确认产品路由仍为 `/runs/<runId>`，文件系统运行态在临时用户状态目录。

## 6. 验证

- [x] 6.1 运行 `oz validate 2026-05-11-15-迁移wo运行态读取到用户状态目录 --json`。
- [x] 6.2 运行新增或更新的 server workflow 测试。
- [x] 6.3 运行相关 spec/Playwright workflow 启动和路由测试。
- [x] 6.4 运行 `rg -n "\\.wo/runs|wo/runs|\\.ccflow/runs" README.md server tests`，确认剩余命中只存在于明确的“不兼容旧路径”测试或历史归档。
