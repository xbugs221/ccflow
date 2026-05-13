## 1. 契约梳理

- [x] 1.1 列出 `shared/`、`src/utils`、聊天 utils、i18n、session activity 的导入方。
- [x] 1.2 区分前端独占、server 运行时依赖、Node 测试直接依赖三类文件。
- [x] 1.3 为 WebSocket、API response、session/provider read model 补齐 TS 类型。

## 2. 迁移前端独占工具

- [x] 2.1 迁移 `src/utils/api.js` 到 TypeScript（含完整类型注解、接口定义）。
- [x] 2.2 聊天消息去重工具（messageDedup/sessionMessageDedup）保留 `.js` + 补 `.d.ts`（Node 测试直接依赖）。
- [x] 2.3 `sessionActivityState.js` 保留 `.js` + 补 `.d.ts`（Node spec 测试直接依赖）。
- [x] 2.4 迁移 i18n `config.js`/`languages.js` 到 TypeScript（含 Language 接口）。
- [x] 2.5 更新所有 import 和静态测试路径。

## 3. 处理 shared 运行时契约

- [x] 3.1 `shared/socket-message-utils.js`：保留 `.js` + 补 `.d.ts`（前端和 Node 测试均导入）。
- [x] 3.2 `shared/modelConstants.js`：保留 `.js` + 补 `.d.ts`（server 和前端均导入）。
- [x] 3.3 `shared/codex-message-normalizer.js`：保留 JS runtime + 补 `.d.ts`（仅 server 导入，无前端使用方）。
- [x] 3.4 确保 server 生产路径不直接 import `.ts`（server/projects.js → .js, server/codex-models.js → .js）。

## 4. 测试代码

- [x] 4.1 在本提案 `tests/` 目录编写真实测试（14 用例），并同步到根测试套件。
- [x] 4.2 更新 server 测试，确认 Node 仍能导入共享 runtime（149/149 pass）。
- [x] 4.3 更新前端/spec 测试，覆盖消息去重、语言列表和 API helper 行为（37/37 spec:node pass）。
- [x] 4.4 新增静态测试，防止为本提案引入 server TS runtime（package.json scripts 无 ts-node/tsx）。

## 5. 验证

- [x] 5.1 运行 `pnpm run typecheck`（0 错误通过，修复了 .d.ts 声明中 timestamp/attachments/sequence 及 AUTH_STATUS_ENDPOINTS 的类型对齐问题）。
- [x] 5.2 运行受影响的 server 测试（149/149 pass）。
- [x] 5.3 运行受影响的 browser/spec 测试（37/37 spec:node pass）。
- [x] 5.4 运行 `oz validate 2026-05-13-23-迁移前端共享契约到TS --json`（valid=true，无错误无警告）。
