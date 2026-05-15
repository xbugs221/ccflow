## 1. 状态路径设计

- [x] 1.1 新增或扩展 ccflow state path helper。
- [x] 1.2 实现 `${XDG_STATE_HOME:-~/.local/state}/ccflow` root 解析。
- [x] 1.3 实现项目 repo-key：`<basename>-<sha1-10>`。
- [x] 1.4 明确无 projectPath 时走全局 state config，有 projectPath 时走 repo state config。

## 2. 配置迁移

- [x] 2.1 将 `server/project-config-store.js` 的读写路径切到 state 目录。
- [x] 2.2 增加旧项目级 `<project>/.ccflow/conf.json` 只读迁移。
- [x] 2.3 增加旧全局 `~/.ccflow/conf.json` 只读迁移。
- [x] 2.4 写入路径只使用新 state config，不再创建项目内 `.ccflow`。
- [x] 2.5 保持原有 normalize/save 原子写逻辑。

## 3. 业务行为保持

- [x] 3.1 验证 manual session draft 创建、启动、绑定 provider session、finalize 仍正常。
- [x] 3.2 验证 `findProjectChatRecord` 仍能通过 provider session id 反查 `cN` route。
- [x] 3.3 验证会话标题、UI state 和 model state 迁移后仍可读写。
- [x] 3.4 验证 `/api/projects` 仍能读取手动添加项目和 display name。
- [x] 3.5 更新 README 或相关运行态文档，说明项目内 `.ccflow` 已弃用。

## 4. 测试代码

- [x] 4.1 在本提案 `tests/` 目录编写真实测试，并在执行阶段同步到根测试套件。
- [x] 4.2 server 测试：`XDG_STATE_HOME` 指向临时目录时，项目级写入进入 state repo config。
- [x] 4.3 server 测试：旧项目内 `.ccflow/conf.json` 首次读取后迁移到 state repo config。
- [x] 4.4 server 测试：旧全局 `~/.ccflow/conf.json` 首次读取后迁移到 state root config。
- [x] 4.5 server 测试：同 basename 不同路径项目生成不同 repo-key，route/session metadata 不混用。
- [x] 4.6 业务回归测试：新建手动会话后刷新项目列表，`/cN` 路由仍能打开同一 provider 会话。

## 5. 验证

- [x] 5.1 运行新增 server 测试。
- [x] 5.2 运行 manual session / project config 相关既有测试。
- [x] 5.3 运行 `pnpm run typecheck`。
- [x] 5.4 运行 `oz validate 2026-05-15-27-迁移ccflow状态到XDG目录 --json`。
