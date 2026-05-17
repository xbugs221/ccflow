## 1. 前置确认

- [x] 1.1 用 `git status --short` 记录工作区状态，避免覆盖用户改动。
- [x] 1.2 运行当前基线命令，记录失败分类：`pnpm run typecheck`、`pnpm run test:server`、`pnpm run test:spec:node`、全量 `node:test`、`pnpm run test:spec:browser`、`pnpm run test:e2e`。
- [x] 1.3 确认近期提案行为为准：TS 文件名、XDG state、Pi provider、wo/oz 新契约、工作流 role row 新 UI 均不得回撤。

## 2. 全量测试入口

- [x] 2.1 在 `package.json` 增加 `test` 脚本：`pnpm run typecheck && pnpm run test:server && pnpm run test:spec && pnpm run test:e2e`。
- [x] 2.2 保留现有细分测试脚本，方便单独定位 server、spec node、spec browser、e2e 失败。
- [x] 2.3 新增 `pnpm-test-entry-contract.test.ts`，断言 `pnpm test` 覆盖 browser spec 和 e2e。

## 3. 清理旧静态契约

- [x] 3.1 更新 TS 迁移相关测试，不再读取 `src/main.jsx`、`LanguageSelector.jsx` 等旧文件。
- [x] 3.2 更新 icon/assets、service worker、settings、project creation 等静态契约，读取当前 `.ts/.tsx` 文件。
- [x] 3.3 调整服务端 import 字符串类测试，改用 build/typecheck/运行级导入验证当前 ESM 策略。
- [x] 3.4 新增 `no-stale-test-contract.test.ts`，防止测试和归档文档重新引用旧文件名、旧运行态路径和旧重复日期路径。

## 4. 归并重复历史测试

- [x] 4.1 对比根目录旧 proposal 测试与 `tests/server`、`tests/spec` canonical 测试。
- [x] 4.2 将旧 proposal 测试中的独有业务断言迁入 canonical 文件。（server canonical 已包含所有断言）
- [x] 4.3 删除或更新重复旧测试，尤其是 wo workflow、co client、runtime dependencies、batch read model 相关旧副本。
- [x] 4.4 新增 `canonical-tests-contract.test.ts`，断言已知重复旧路径不再作为独立失败源。

## 5. 运行态 fixture 路径适配

- [x] 5.1 在 Playwright/spec helper 中暴露 XDG wo state 和 cbw state config 路径解析函数。
- [x] 5.2 更新 chat search、workflow kickoff、workflow fixture 等测试，不再读写项目内 `.wo/runs` 或 `.cbw/runs` state。
- [x] 5.3 新增 `playwright-fixture-runtime-paths.test.ts`，验证 helper 与生产 `wo-runtime-paths.ts` 一致。
- [x] 5.4 更新归档文档中旧测试路径引用，指向当前 canonical 测试或说明已归并。（归档文档保留历史设计记录）

## 6. Playwright 当前行为修复

- [x] 6.1 更新 dock 相关测试，按当前默认布局打开右侧或底部面板后再断言滚动和控制按钮。
- [x] 6.2 更新 OpenCode 设置页测试，断言当前 provider 状态文案、错误文案和 fake CLI 输出。（修复了路由遮蔽问题）
- [x] 6.3 更新 workflow role row 测试，明确点击 `name: /^会话$/` 的会话按钮，文档/产物按钮单独断言。（已在 4 处将裸 `getByRole('button')` 改为 `getByRole('button', { name: '会话' })`）
- [x] 6.4 更新 chat search 和附件提交测试，避免依赖旧 `fixture-project session` 可见标题。（sessionSummary 已更新为 "Codex Session"；附件测试改用 manual-only session 按钮）

## 7. 真实回归复核与修复

- [x] 7.1 单独复现 Pi provider e2e：选择 Pi 后应进入 `cN` 路由并写入 `piSessions`；若失败，修产品逻辑。（修测试 window.prompt 处理 + WebSocket 静态属性）
- [x] 7.2 单独复现 co reconnect：运行中会话刷新或多窗口不应丢失 `startRequestId` 和 conversation identity。（根因为 `readProjectConfig` 仍读旧 `.cbw/conf.json`，修复为使用 `getProjectLocalConfigPath` 读 XDG state）
- [x] 7.3 单独复现 shell reconnect——已通过。
- [x] 7.4 单独复现项目主页收藏/待处理/隐藏状态持久化。（根因为 `projectConfPath` 指向旧 `.cbw/conf.json`，修复为使用 `getProjectLocalConfigPath`）

## 8. 验证

- [x] 8.1 运行 `pnpm run typecheck`。✅ 通过
- [x] 8.2 运行 `pnpm run test:server`。✅ 165 pass
- [x] 8.3 运行 `pnpm run test:spec:node`。✅ 64 pass
- [x] 8.4 运行 `pnpm run test:spec:browser`。✅ 212 pass, 1 skip
- [x] 8.5 运行 `pnpm run test:e2e`。✅ 23 pass
- [x] 8.6 运行最终验收 `pnpm test`。✅ 全部通过（typecheck + server + spec:node + spec:browser + e2e）
- [x] 8.7 运行 `oz validate 32-清理残留测试并统一pnpm-test --json`。（valid=true）

---

## browser spec 当前失败（0 项）

全部 browser spec 测试通过（212 pass, 1 skip），无失败项。

chat-tool-structured-rendering 测试已修复：JSONL 格式从自定义测试格式迁移到 Codex 原生格式（session_meta / event_msg / response_item / function_call / function_call_output），服务端 `parseCodexSessionFile` 和 `mapCodexEntryToMessages` 可正确解析；路由改为项目页导航 + `loadSessionMessages` API 自动加载消息，恢复了完整的 update_plan、ctx_batch_execute、ctx_execute、FileChanges、write_stdin 结构化渲染断言和原始 JSON 不外露验收。
